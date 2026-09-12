BEGIN;

CREATE TABLE public.weather_schedules (
  farm_id uuid PRIMARY KEY REFERENCES public.farms(id) ON DELETE CASCADE,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE INDEX weather_schedules_due ON public.weather_schedules(next_run_at);
ALTER TABLE public.weather_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weather_schedules FROM PUBLIC, anon, authenticated, service_role;

-- A committed publication is also the scheduler acknowledgement. A crash between
-- the database commit and the HTTP response cannot cause the same run to repeat.
CREATE FUNCTION public.schedule_farm_weather() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.data_mode = 'live' THEN
    INSERT INTO public.weather_schedules(farm_id) VALUES (NEW.id)
      ON CONFLICT (farm_id) DO NOTHING;
    IF TG_OP = 'UPDATE' AND NEW.last_success_at IS DISTINCT FROM OLD.last_success_at THEN
      UPDATE public.weather_schedules SET
        next_run_at = NEW.last_success_at + interval '30 minutes',
        failures = 0, lease_token = NULL, lease_until = NULL
      WHERE farm_id = NEW.id;
    END IF;
  ELSE
    DELETE FROM public.weather_schedules WHERE farm_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.schedule_farm_weather() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER farm_weather_schedule AFTER INSERT OR UPDATE OF data_mode, last_success_at
  ON public.farms FOR EACH ROW EXECUTE FUNCTION public.schedule_farm_weather();
INSERT INTO public.weather_schedules(farm_id, next_run_at)
  SELECT id, coalesce(last_success_at + interval '30 minutes', now())
  FROM public.farms WHERE data_mode = 'live';

CREATE FUNCTION public.claim_weather_farm(p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE claimed public.weather_schedules%ROWTYPE; owner uuid;
BEGIN
  IF p_now IS NULL OR NOT isfinite(p_now) THEN RAISE EXCEPTION 'INVALID_TIME'; END IF;
  SELECT s.* INTO claimed FROM public.weather_schedules s
    JOIN public.farms f ON f.id = s.farm_id
    WHERE f.data_mode = 'live' AND s.next_run_at <= p_now
      AND (s.lease_until IS NULL OR s.lease_until <= p_now)
      AND EXISTS (SELECT 1 FROM public.plots p WHERE p.farm_id = f.id)
    ORDER BY s.next_run_at, s.farm_id
    LIMIT 1 FOR UPDATE OF s SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT owner_id INTO owner FROM public.farms WHERE id = claimed.farm_id;
  UPDATE public.weather_schedules SET lease_token = gen_random_uuid(),
    lease_until = p_now + interval '2 minutes'
    WHERE farm_id = claimed.farm_id RETURNING * INTO claimed;
  RETURN jsonb_build_object('farmId', claimed.farm_id, 'ownerId', owner, 'token', claimed.lease_token);
END;
$$;

CREATE FUNCTION public.fail_weather_schedule(p_farm_id uuid, p_token uuid, p_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_now IS NULL OR NOT isfinite(p_now) THEN RAISE EXCEPTION 'INVALID_TIME'; END IF;
  UPDATE public.weather_schedules SET next_run_at = p_now + interval '5 minutes',
    failures = least(failures + 1, 1000000), lease_token = NULL, lease_until = NULL
    WHERE farm_id = p_farm_id AND lease_token = p_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_weather_farm(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_weather_schedule(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_weather_farm(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_weather_schedule(uuid, uuid, timestamptz) TO service_role;

COMMIT;
