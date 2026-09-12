# Automatic weather alerts

The requested end-to-end extension builds on the merged forecast publication and
deterministic risk engine. Implementation order:

1. **weather-scheduling** → due-farm admission, leases, retries and the existing
   complete per-plot refresh. Supabase remains the authority for due work.
2. **alert-outbox** → atomically persist notification intent with current alerts;
   resolve the recipient from the farm owner and a provisioned, opted-in contact.
3. **notification-delivery** → approved Kapso templates, durable send state,
   authenticated delivery callbacks, and owner-scoped delivery status.
4. **verification** → exercise real SQL migrations, provider boundaries, cron
   wiring and recovery paths; document provisioning and operational limits.

Dependencies point from delivery to outbox and from outbox to existing publication.
Scheduling calls publication; publication does not call providers under a DB lock.
The detailed specification and technology research live in
[weather-automation.md](../docs/weather-automation.md).
