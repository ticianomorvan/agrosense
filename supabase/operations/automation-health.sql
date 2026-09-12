-- Read-only operational checks. Cron success means the HTTP request was queued;
-- automation_runs records actual Worker completion. Inspect both.
SELECT jobid, jobname, schedule, active FROM cron.job
  WHERE jobname LIKE 'agrosense-%';
SELECT task, status, started_at, completed_at, result
  FROM public.automation_runs ORDER BY started_at DESC LIMIT 30;
SELECT count(*) AS overdue_farms, min(next_run_at) AS oldest_due
  FROM public.weather_schedules WHERE next_run_at < now() - interval '5 minutes';
SELECT status, count(*), min(created_at) AS oldest
  FROM public.notification_outbox GROUP BY status ORDER BY status;
SELECT count(*) AS awaiting_contact FROM public.notification_outbox n
  LEFT JOIN public.notification_contacts c ON c.owner_id = n.owner_id AND c.enabled
  WHERE n.status = 'pending' AND n.expires_at > now() AND c.owner_id IS NULL;
SELECT id, status_code, timed_out, error_msg, created
  FROM net._http_response WHERE status_code >= 400 OR timed_out OR error_msg IS NOT NULL
  ORDER BY created DESC LIMIT 20;
