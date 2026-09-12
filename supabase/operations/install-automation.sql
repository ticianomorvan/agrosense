-- Run as the Supabase database administrator after migrations and Worker deploy.
-- In Supabase Vault, first create:
--   agrosense_worker_url   = https://<your-worker-origin> (no trailing slash)
--   agrosense_cron_secret  = the same random 64 lowercase hex characters stored
--                           in the Worker's AUTOMATION_CRON_SECRET secret.
-- Secrets are looked up at runtime; never paste their values into cron commands.
-- This file activates the two jobs and retention maintenance.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_agrosense_automation(p_task text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE worker_url text; cron_secret text; endpoint text;
BEGIN
  endpoint := CASE p_task WHEN 'weather' THEN '/api/internal/weather/refresh'
    WHEN 'notifications' THEN '/api/internal/notifications/dispatch' ELSE NULL END;
  IF endpoint IS NULL THEN RAISE EXCEPTION 'INVALID_AUTOMATION_TASK'; END IF;
  SELECT decrypted_secret INTO STRICT worker_url FROM vault.decrypted_secrets WHERE name = 'agrosense_worker_url';
  SELECT decrypted_secret INTO STRICT cron_secret FROM vault.decrypted_secrets WHERE name = 'agrosense_cron_secret';
  IF worker_url IS NULL OR cron_secret IS NULL OR worker_url !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' OR cron_secret !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_AUTOMATION_CONFIG';
  END IF;
  RETURN net.http_post(
    url := worker_url || endpoint,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 95000
  );
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_agrosense_automation(text) FROM PUBLIC, anon, authenticated, service_role;

-- Fail installation before scheduling if the Vault entries are absent.
DO $$
BEGIN
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name IN ('agrosense_worker_url','agrosense_cron_secret')) <> 2
    THEN RAISE EXCEPTION 'Configure the two AgroSense Vault secrets before activation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'agrosense_worker_url' AND decrypted_secret ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$')
    OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'agrosense_cron_secret' AND decrypted_secret ~ '^[a-f0-9]{64}$')
    THEN RAISE EXCEPTION 'Invalid AgroSense Vault configuration'; END IF;
END;
$$;

SELECT cron.schedule('agrosense-weather', '* * * * *',
  $$ SELECT public.invoke_agrosense_automation('weather'); $$);
SELECT cron.schedule('agrosense-notifications', '* * * * *',
  $$ SELECT public.invoke_agrosense_automation('notifications'); $$);
SELECT cron.schedule('agrosense-automation-retention', '17 3 * * *',
  $$ SELECT public.prune_automation_history();
     DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'
       AND jobid IN (SELECT jobid FROM cron.job WHERE jobname IN
         ('agrosense-weather','agrosense-notifications','agrosense-automation-retention')); $$);
COMMIT;
