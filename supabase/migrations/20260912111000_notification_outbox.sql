BEGIN;

CREATE TABLE public.notification_contacts (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  phone_number text NOT NULL CHECK (phone_number ~ '^[1-9][0-9]{6,14}$'),
  consented_at timestamptz NOT NULL CHECK (isfinite(consented_at)),
  enabled boolean NOT NULL DEFAULT true,
  version uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_contacts FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE RESTRICT,
  plot_id uuid NOT NULL REFERENCES public.plots(id) ON DELETE RESTRICT,
  alert_id uuid REFERENCES public.plot_alerts(id) ON DELETE SET NULL,
  source_event_key text NOT NULL CHECK (length(source_event_key) BETWEEN 1 AND 200),
  -- -1 is a withdrawal, 0 is weather-only, 1..4 are the crop-risk ranks.
  risk_rank smallint NOT NULL CHECK (risk_rank BETWEEN -1 AND 4),
  kind text NOT NULL CHECK (kind IN ('hazard','escalation','withdrawal')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  rules_snapshot jsonb NOT NULL CHECK (jsonb_typeof(rules_snapshot) = 'array'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','leased','sending','unknown','accepted','sent','delivered','read','failed','cancelled','expired')),
  recipient text CHECK (recipient ~ '^[1-9][0-9]{6,14}$'),
  contact_version uuid,
  phone_number_id text,
  provider_message_id text UNIQUE CHECK (length(provider_message_id) BETWEEN 1 AND 1024),
  lease_token uuid,
  lease_until timestamptz,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  send_started_at timestamptz,
  expires_at timestamptz NOT NULL,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, plot_id, source_event_key, risk_rank)
);
CREATE INDEX notification_outbox_due ON public.notification_outbox(next_attempt_at, id)
  WHERE status IN ('pending','leased','sending');
CREATE INDEX notification_outbox_farm ON public.notification_outbox(farm_id, created_at DESC);
CREATE INDEX notification_outbox_alert ON public.notification_outbox(alert_id);
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_outbox FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id, farm_id, plot_id, kind, status, attempts, last_error_code, created_at, updated_at)
  ON public.notification_outbox TO authenticated;
CREATE POLICY notification_owner_read ON public.notification_outbox FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.farms f WHERE f.id = farm_id AND f.owner_id = (SELECT auth.uid())
  ));

CREATE FUNCTION public.configure_notification_contact(
  p_owner_id uuid, p_phone_number text, p_consented_at timestamptz, p_enabled boolean
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_consented_at IS NULL OR NOT isfinite(p_consented_at) OR p_consented_at > clock_timestamp()
     OR p_phone_number IS NULL OR p_phone_number !~ '^[1-9][0-9]{6,14}$'
     OR p_enabled IS NULL THEN RAISE EXCEPTION 'INVALID_CONTACT'; END IF;
  INSERT INTO public.notification_contacts(owner_id, phone_number, consented_at, enabled)
    VALUES (p_owner_id, p_phone_number, p_consented_at, p_enabled)
    ON CONFLICT (owner_id) DO UPDATE SET phone_number = excluded.phone_number,
      consented_at = excluded.consented_at, enabled = excluded.enabled,
      version = gen_random_uuid(), updated_at = clock_timestamp();
  RETURN true;
END;
$$;

-- Runs inside the existing publication transaction, after the event upsert.
-- Only the validated publication boundary may write plot_alerts.
CREATE FUNCTION public.enqueue_plot_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.farms%ROWTYPE; e public.events%ROWTYPE; plot_name text;
  rank_value integer; previous_rank integer; notice_kind text; notice_payload jsonb;
BEGIN
  SELECT * INTO STRICT f FROM public.farms WHERE id = NEW.farm_id;
  SELECT * INTO STRICT e FROM public.events WHERE id = NEW.event_id;
  IF f.data_mode <> 'live' OR e.is_demo OR e.source_code <> 'open_meteo'
     OR e.ends_at <= NEW.generated_at THEN RETURN NEW; END IF;
  SELECT name INTO STRICT plot_name FROM public.plots WHERE id = NEW.plot_id AND farm_id = NEW.farm_id;
  rank_value := CASE NEW.risk_level WHEN 'low' THEN 1 WHEN 'moderate' THEN 2
    WHEN 'high' THEN 3 WHEN 'critical' THEN 4 ELSE 0 END;
  SELECT max(risk_rank) INTO previous_rank FROM public.notification_outbox
    WHERE owner_id = f.owner_id AND plot_id = NEW.plot_id AND source_event_key = e.source_event_key
      AND risk_rank >= 0 AND send_started_at IS NOT NULL;
  IF e.status = 'cancelled' THEN
    UPDATE public.notification_outbox SET status = 'cancelled', lease_until = NULL,
      updated_at = clock_timestamp(), last_error_code = 'FORECAST_WITHDRAWN'
      WHERE alert_id = NEW.id AND risk_rank >= 0 AND status IN ('pending','leased');
    IF NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE alert_id = NEW.id
      AND risk_rank >= 0 AND status IN ('sending','unknown','accepted','sent','delivered','read')) THEN
      RETURN NEW;
    END IF;
    rank_value := -1;
    notice_kind := 'withdrawal';
  ELSE
    IF previous_rank IS NOT NULL AND previous_rank >= rank_value THEN RETURN NEW; END IF;
    notice_kind := CASE WHEN previous_rank IS NULL THEN 'hazard' ELSE 'escalation' END;
    -- Replace a queued assessment when risk changes before a send begins.
    UPDATE public.notification_outbox SET status = 'cancelled', lease_until = NULL,
      updated_at = clock_timestamp(), last_error_code = 'SUPERSEDED'
      WHERE alert_id = NEW.id AND risk_rank <> rank_value AND status IN ('pending','leased');
  END IF;
  notice_payload := jsonb_build_object(
    'farmName', f.name, 'plotName', plot_name, 'title', e.title, 'hazardKind', e.kind,
    'startsAt', e.starts_at, 'endsAt', e.ends_at, 'assessmentState', NEW.assessment_state,
    'riskLevel', NEW.risk_level, 'reason', NEW.reason, 'recommendedActions', NEW.recommended_actions,
    'generatedAt', NEW.generated_at
  );
  INSERT INTO public.notification_outbox(owner_id, farm_id, plot_id, alert_id,
    source_event_key, risk_rank, kind, payload, rules_snapshot, expires_at, next_attempt_at)
    VALUES (f.owner_id, f.id, NEW.plot_id, NEW.id, e.source_event_key, rank_value,
      notice_kind, notice_payload, f.custom_rules, least(NEW.valid_until, e.ends_at), NEW.generated_at)
    ON CONFLICT (owner_id, plot_id, source_event_key, risk_rank) DO UPDATE
      SET payload = excluded.payload, rules_snapshot = excluded.rules_snapshot, expires_at = excluded.expires_at,
        alert_id = excluded.alert_id, status = 'pending', lease_token = NULL, lease_until = NULL,
        updated_at = clock_timestamp(), last_error_code = NULL
      WHERE notification_outbox.status IN ('pending','leased','cancelled','expired')
        AND notification_outbox.send_started_at IS NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER plot_notification_outbox AFTER INSERT OR UPDATE ON public.plot_alerts
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_plot_notification();

-- Check current ownership, contact and evidence again immediately before sending.
CREATE FUNCTION public.notification_is_current(p_id uuid, p_now timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notification_outbox n
    JOIN public.farms f ON f.id = n.farm_id AND f.owner_id = n.owner_id AND f.data_mode = 'live'
    JOIN public.notification_contacts c ON c.owner_id = n.owner_id AND c.enabled
    JOIN public.plot_alerts a ON a.id = n.alert_id
    JOIN public.events e ON e.id = a.event_id
    LEFT JOIN public.crop_cycles cycle ON cycle.plot_id = n.plot_id AND cycle.ended_on IS NULL
    WHERE n.id = p_id AND n.expires_at > p_now AND a.valid_until > p_now AND e.ends_at > p_now
      AND n.rules_snapshot = f.custom_rules
      AND NOT e.is_demo AND e.source_code = 'open_meteo'
      AND ((n.kind = 'withdrawal' AND e.status = 'cancelled') OR (n.kind <> 'withdrawal' AND e.status = 'active'))
      AND (n.payload->>'generatedAt')::timestamptz = a.generated_at
      AND (a.input_snapshot->'cropCycle'->>'id')::uuid IS NOT DISTINCT FROM cycle.id
      AND (a.input_snapshot->'cropCycle'->>'updatedAt')::timestamptz IS NOT DISTINCT FROM cycle.updated_at
  );
$$;

CREATE FUNCTION public.claim_notification(p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n public.notification_outbox%ROWTYPE; contact public.notification_contacts%ROWTYPE;
BEGIN
  IF p_now IS NULL OR NOT isfinite(p_now) THEN RAISE EXCEPTION 'INVALID_TIME'; END IF;
  -- A sending lease is deliberately not a retry lease: the HTTP result may be lost.
  UPDATE public.notification_outbox SET status = 'unknown', last_error_code = 'SEND_OUTCOME_UNKNOWN',
    lease_until = NULL, updated_at = p_now WHERE status = 'sending' AND lease_until <= p_now;
  UPDATE public.notification_outbox SET status = 'expired', lease_until = NULL, updated_at = p_now,
    last_error_code = 'EVIDENCE_EXPIRED' WHERE status IN ('pending','leased') AND expires_at <= p_now;
  SELECT o.* INTO n FROM public.notification_outbox o
    WHERE (o.status = 'pending' OR (o.status = 'leased' AND o.lease_until <= p_now))
      AND o.next_attempt_at <= p_now AND o.attempts < 5
      AND public.notification_is_current(o.id, p_now)
    ORDER BY o.next_attempt_at, o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO STRICT contact FROM public.notification_contacts WHERE owner_id = n.owner_id;
  UPDATE public.notification_outbox SET status = 'leased', lease_token = gen_random_uuid(),
    lease_until = p_now + interval '2 minutes', recipient = contact.phone_number,
    contact_version = contact.version, updated_at = p_now WHERE id = n.id RETURNING * INTO n;
  RETURN jsonb_build_object('id', n.id, 'token', n.lease_token, 'ownerId', n.owner_id,
    'recipient', n.recipient, 'kind', n.kind, 'payload', n.payload, 'attempts', n.attempts);
END;
$$;

CREATE FUNCTION public.begin_notification_send(p_id uuid, p_token uuid, p_phone_number_id text, p_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_now IS NULL OR NOT isfinite(p_now) OR p_phone_number_id IS NULL
     OR p_phone_number_id !~ '^[1-9][0-9]{0,29}$' THEN RAISE EXCEPTION 'INVALID_SEND'; END IF;
  UPDATE public.notification_outbox n SET status = 'sending', attempts = attempts + 1,
    send_started_at = p_now, phone_number_id = p_phone_number_id,
    lease_until = p_now + interval '2 minutes', updated_at = p_now
    WHERE n.id = p_id AND n.lease_token = p_token AND n.status = 'leased' AND n.lease_until > p_now
      AND n.attempts < 5 AND public.notification_is_current(n.id, p_now)
      AND EXISTS (SELECT 1 FROM public.notification_contacts c WHERE c.owner_id = n.owner_id
        AND c.enabled AND c.version = n.contact_version AND c.phone_number = n.recipient);
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_notification_contact(uuid,text,timestamptz,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_plot_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_is_current(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_notification(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_notification_send(uuid,uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_notification_contact(uuid,text,timestamptz,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_notification_send(uuid,uuid,text,timestamptz) TO service_role;

COMMIT;
