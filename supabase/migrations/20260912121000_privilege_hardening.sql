-- Make Data API access explicit even when hosted project defaults auto-grant new objects.
BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
-- PostgreSQL's built-in function default is global PUBLIC EXECUTE; a per-schema
-- revoke cannot override it, so remove it for future postgres-owned functions.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;

REVOKE ALL ON TABLE
  public.farms,
  public.plots,
  public.crop_cycles,
  public.events,
  public.plot_alerts
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE
  public.farms,
  public.plots,
  public.crop_cycles,
  public.events,
  public.plot_alerts
TO authenticated, service_role;

REVOKE ALL ON TABLE
  public.weather_schedules,
  public.notification_contacts,
  public.notification_outbox,
  public.notification_receipts,
  public.automation_runs
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (
  id,
  farm_id,
  plot_id,
  kind,
  status,
  attempts,
  last_error_code,
  created_at,
  updated_at
) ON public.notification_outbox TO authenticated;

REVOKE ALL ON FUNCTION
  public.set_mvp_updated_at(),
  public.get_farm_dashboard_snapshot(uuid),
  public.update_crop_cycle(uuid, uuid, integer, jsonb),
  public.admit_farm_refresh(uuid, uuid, timestamptz),
  public.publish_farm_refresh(uuid, uuid, integer, timestamptz, timestamptz, jsonb, jsonb),
  public.fail_farm_refresh(uuid, uuid, integer, timestamptz, timestamptz, text),
  public.import_demo_seed(uuid, jsonb),
  public.schedule_farm_weather(),
  public.claim_weather_farm(timestamptz),
  public.fail_weather_schedule(uuid, uuid, timestamptz),
  public.configure_notification_contact(uuid, text, timestamptz, boolean),
  public.enqueue_plot_notification(),
  public.notification_is_current(uuid, timestamptz),
  public.claim_notification(timestamptz),
  public.begin_notification_send(uuid, uuid, text, timestamptz),
  public.notification_delivery_rank(text),
  public.apply_notification_receipts(uuid),
  public.record_notification_receipt(text, text, text, timestamptz, text, uuid, uuid),
  public.complete_notification_send(uuid, uuid, text, text, text, timestamptz),
  public.get_farm_notification_status(uuid),
  public.start_automation_run(text),
  public.finish_automation_run(uuid, boolean, jsonb),
  public.prune_automation_history(),
  public.create_user_farm(uuid, jsonb),
  public.create_farm_plot(uuid, uuid, integer, jsonb)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.get_farm_dashboard_snapshot(uuid)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.update_crop_cycle(uuid, uuid, integer, jsonb),
  public.get_farm_notification_status(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.admit_farm_refresh(uuid, uuid, timestamptz),
  public.publish_farm_refresh(uuid, uuid, integer, timestamptz, timestamptz, jsonb, jsonb),
  public.fail_farm_refresh(uuid, uuid, integer, timestamptz, timestamptz, text),
  public.import_demo_seed(uuid, jsonb),
  public.claim_weather_farm(timestamptz),
  public.fail_weather_schedule(uuid, uuid, timestamptz),
  public.configure_notification_contact(uuid, text, timestamptz, boolean),
  public.claim_notification(timestamptz),
  public.begin_notification_send(uuid, uuid, text, timestamptz),
  public.record_notification_receipt(text, text, text, timestamptz, text, uuid, uuid),
  public.complete_notification_send(uuid, uuid, text, text, text, timestamptz),
  public.start_automation_run(text),
  public.finish_automation_run(uuid, boolean, jsonb),
  public.prune_automation_history(),
  public.create_user_farm(uuid, jsonb),
  public.create_farm_plot(uuid, uuid, integer, jsonb)
TO service_role;

COMMIT;
