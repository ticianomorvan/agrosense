BEGIN;

CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task text NOT NULL CHECK (task IN ('weather','notifications')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  result jsonb,
  CHECK ((status = 'running') = (completed_at IS NULL))
);
CREATE INDEX automation_runs_recent ON public.automation_runs(started_at DESC);
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_runs FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.start_automation_run(p_task text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE run_id uuid;
BEGIN
  INSERT INTO public.automation_runs(task) VALUES (p_task) RETURNING id INTO run_id;
  RETURN run_id;
END;
$$;
CREATE FUNCTION public.finish_automation_run(p_id uuid, p_succeeded boolean, p_result jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_succeeded IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
    OR octet_length(p_result::text) > 16384 THEN RAISE EXCEPTION 'INVALID_RUN_RESULT'; END IF;
  UPDATE public.automation_runs SET status = CASE WHEN p_succeeded THEN 'completed' ELSE 'failed' END,
    completed_at = clock_timestamp(), result = p_result WHERE id = p_id AND status = 'running';
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.prune_automation_history() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.automation_runs SET status = 'failed', completed_at = clock_timestamp(),
    result = '{"errorCode":"WORKER_INTERRUPTED"}' WHERE status = 'running' AND started_at < now() - interval '10 minutes';
  DELETE FROM public.automation_runs WHERE started_at < now() - interval '7 days';
  DELETE FROM public.notification_receipts WHERE received_at < now() - interval '30 days';
  -- Unknown outcomes remain visible until an operator resolves them.
  DELETE FROM public.notification_outbox WHERE updated_at < now() - interval '30 days'
    AND status IN ('accepted','sent','delivered','read','failed','cancelled','expired');
END;
$$;

REVOKE ALL ON FUNCTION public.start_automation_run(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_automation_run(uuid,boolean,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_automation_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_automation_run(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_automation_run(uuid,boolean,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_automation_history() TO service_role;

COMMIT;
