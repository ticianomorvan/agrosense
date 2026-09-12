# Automatic weather ingestion and owner notifications

## Objective and scope

Every live farm is refreshed approximately every 30 minutes using the stored sample
point of each plot. A complete forecast is normalized, evaluated by the existing
deterministic rule engine, and published atomically. Each plot belongs to its farm's
owner. Notifications use a separately provisioned owner contact with recorded
WhatsApp opt-in; the conversation agent's allowlisted phone is not a contact database.

This extends the original five-table demo scope to scheduled ingestion and outbound
delivery. Demo farms remain manually refreshable and never generate automatic sends.
Live crop assessments still require approved rules with evidence URLs. Weather
hazards can be notified with an explicit unavailable crop-risk assessment.

## Research and design decisions

Research checked 2026-09-12 against installed Hono 4.13.7, Wrangler 4.131.1,
supabase-js 2.116.x and Zod 4.6.2.

| Technology | Verified behavior | Design consequence |
| --- | --- | --- |
| [Supabase Cron](https://supabase.com/docs/guides/cron), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [Vault](https://supabase.com/docs/guides/database/vault) | Postgres manages schedules and run history; pg_net queues asynchronous HTTP; Vault supplies stored secrets. | Centralize job operation in Supabase. Two jobs running every minute invoke authenticated Worker endpoints; durable due state remains in Postgres. Cron's successful enqueue is distinct from actual Worker completion. |
| [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers), [body limits](https://hono.dev/docs/middleware/builtin/body-limit) | Existing fetch routes run on Workers and can bound incoming bodies. | Reuse the TypeScript publication and provider code through small authenticated HTTP jobs. Worker compute performs external I/O outside database transactions. |
| [Cloudflare Queues](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) | Delivery is at least once. | A queue alone cannot provide notification idempotency or atomically commit a database alert and its message. For the bounded MVP, a Postgres outbox avoids a second durable transport; queues can later carry outbox IDs. |
| [PostgreSQL SELECT](https://www.postgresql.org/docs/current/sql-select.html) and [INSERT](https://www.postgresql.org/docs/current/sql-insert.html) | SKIP LOCKED supports concurrent queue consumers; unique constraints arbitrate ON CONFLICT. | Atomic claims with expiring leases; unique business keys deduplicate notification intent. Never use an in-memory Set as the durable guarantee. |
| [Supabase database functions](https://supabase.com/docs/guides/database/functions) | RPCs run database functions; definer functions require a fixed search path and restricted execution grants. | Keep privileged writes service-only, with explicit owner checks and owner-scoped reads. Publication and outbox insertion share a transaction. |
| [Open-Meteo forecast API](https://open-meteo.com/en/docs) | Hourly values include 2 m temperature, gusts, precipitation and WMO codes; forecasts are model output. | Preserve units, UTC hourly coverage, nullable measurements and actual retrieval time. Detect the repository's four hazards; do not claim observational measurements or agronomic validation. |
| [Kapso message API](https://docs.kapso.ai/api/meta/whatsapp/messages/send-a-message) | Accepted messages return a provider ID; biz_opaque_callback_data is echoed in callbacks. The documented send API does not promise client-key deduplication. | Record an attempt before the HTTP call. Timeouts, malformed success responses and server errors become unknown outcomes; do not blindly resend. Correlate signed receipts by provider ID or callback token. |
| [Kapso templates](https://docs.kapso.ai/docs/whatsapp/templates/simple-text) | Approved named templates support proactive notifications. | Use a named Spanish utility template with bounded parameters, independent of the 24-hour free-form conversation window. |
| [Kapso webhook security](https://docs.kapso.ai/docs/platform/webhooks/security), [message events](https://docs.kapso.ai/docs/platform/webhooks/message-events), [delivery](https://docs.kapso.ai/docs/platform/webhooks/advanced) | Raw-body HMAC authentication; sent, delivered, read and failed events; duplicates and retries are possible. | Verify before parsing or persisting, keep monotonic delivery state, and handle callbacks that arrive before the send response. |

## Scheduling contract

Supabase Cron invokes separate weather and notification endpoints every minute.
The weather endpoint claims due live farms in oldest-due order with SKIP LOCKED. Each
claim has a random token and a two-minute lease. A successful publication moves
the farm's due time forward 30 minutes in the publication transaction, even if
the Worker dies before acknowledging success. Failed attempts use a five-minute
delay; abandoned leases expire. Manual and automatic refreshes use the same
admission cooldown and publication compare-and-swap protocol.

Each weather invocation processes one due farm. A separate notification invocation
processes at most ten notices, with two sends at a time and a 50-second drain budget.
Each refresh has a 55-second work deadline plus at most eight seconds to record
failure; each provider request is bounded to eight seconds,
with at most two weather requests in flight per refresh. The MVP is bounded to
10 plots per farm, 50 retained events and a 1 MiB dashboard, as before. Capacity
and due-work age must be monitored before expanding this workload. The default
weather schedule admits at most 30 farms per 30 minutes. For a larger fleet,
increase the authenticated HTTP fan-out in the Supabase job while monitoring
provider limits, or add durable queue consumers carrying the same outbox identities.

## Notification contract

Persist initial hazard notices and upward crop-risk escalations once per owner,
plot and stable daily source event key. Ordinary re-ingestion does not resend.
Withdrawals cancel unsent notices and can produce one withdrawal notice after a
send was attempted. New evidence may update an unsent notice; sent payloads stay
immutable. Do not send expired evidence or notices for a different current owner,
revoked contact, cancelled hazard, changed custom rules or stale crop snapshot.

Claims transition pending → leased → sending before the network call. Expired
leases before sending are reclaimable; expired sending attempts become unknown.
HTTP 429 is an explicit rejection and retries with bounded backoff; other 4xx
rejections are failed. Timeout, 408, 5xx, connection loss, redirect or malformed
success is unknown. Accepted means the provider accepted the message, not that it
was delivered. Signed receipts advance sent/delivered/read or record failure.
Unknown outcomes require receipt reconciliation or operator investigation; this
system does not claim exactly-once delivery across a non-idempotent external API.

## Implementation and verification

Backend code follows existing strict TypeScript, Hono and shared Zod contracts.
SQL belongs in new migrations; tests live beside backend code and exercise real
PGlite transactions. Provider tests mock only the external HTTP boundary.

Example: `const result = await client.rpc("claim_weather_farm");` followed by
validated result parsing; never accept an owner ID from a notification request.

Run `pnpm --filter @agrosense/api test`, `pnpm db:test`, `pnpm check`, and the
Worker runtime tests. Verify concurrent/duplicate claims, atomic rollback,
publication after worker interruption, correct recipient resolution, idempotent
receipts, cancellation, stale data and uncertain sends. No frontend change is
required. Do not send real messages from automated tests or invent approved
agronomic rules. Production activation requires applied migrations, server-side
secrets, an approved template and a provisioned owner contact.

## Activation

1. Apply migrations using `pnpm db:push` after reviewing the target Supabase
   project, and regenerate database types with `pnpm db:types`.
2. Configure the existing Supabase credentials plus `AUTOMATION_CRON_SECRET`
   (64 random lowercase hex characters) as Worker secrets. Configure
   `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`,
   `KAPSO_NOTIFICATION_TEMPLATE_NAME`, `KAPSO_NOTIFICATION_TEMPLATE_LANGUAGE`
   and `KAPSO_NOTIFICATION_WEBHOOK_SECRET`. The conversation agent and its
   allowlisted owner are independent of automatic notifications.
3. Connect the business number in Kapso. Submit the
   [named utility template](assets/kapso-weather-template.json) for review, then
   set the name and language to the exact approved values. This file uses the
   installed Kapso CLI/SDK camelCase input (`parameterFormat`,
   `bodyTextNamedParams`, `paramName`); raw Meta JSON uses different field names.
   Submit with `kapso whatsapp templates new --project <project-id> --phone-number-id <sender-id> --input docs/assets/kapso-weather-template.json`.
   Template review and
   business account approval are external prerequisites, not outcomes of a test.
4. Register a **phone-number**, **Kapso v2** webhook to
   `https://<worker-origin>/api/whatsapp/notifications/webhook` for
   `whatsapp.message.sent`, `whatsapp.message.delivered`, `whatsapp.message.read`,
   and `whatsapp.message.failed`. Set its signing secret to the notification
   webhook secret. The separate conversation webhook can remain in place.
5. Verify the owner's identity, phone and opt-in, then create an ignored local
   contact JSON file with exactly `ownerId`, `phoneNumber` (international digits),
   `consentedAt` (past UTC instant), and `enabled` (boolean). Run
   `node --env-file=apps/api/.env scripts/configure-notification-contact.mjs <contact.json>`.
   Set `enabled: false` and run it again to revoke future sends. A message already
   submitted to the provider cannot be recalled by changing the contact.
6. Deploy the Worker using `pnpm deploy`. Add Vault secrets named
   `agrosense_worker_url` (HTTPS origin with no trailing slash) and
   `agrosense_cron_secret` (same secret as the Worker).
7. Run [install-automation.sql](../supabase/operations/install-automation.sql)
   as the Supabase database administrator. It enables pg_cron/pg_net, installs
   two jobs and daily retention, and uses secret names rather than embedding
   credentials in cron commands. Re-running updates the same named jobs.

The extension activation script is separate from portable application migrations:
PGlite exercises all business SQL but does not implement pg_cron, pg_net or Vault.
Verify the deployed HTTP calls and Supabase job history during activation.
Pause `agrosense-weather` and/or `agrosense-notifications` in Supabase Cron to
pause operation. No Cloudflare Cron Trigger needs configuring.

Open-Meteo's [free service terms](https://open-meteo.com/en/terms) and
[commercial plans](https://open-meteo.com/en/pricing) distinguish permitted use and
capacity. Set `OPEN_METEO_API_KEY` for the fixed customer API endpoint when using a
commercial subscription. Keep the key server-side; it never enters persisted
forecast source URLs or logs. Do not assume a free endpoint is a production SLA.

## Operation and recovery

Run [automation-health.sql](../supabase/operations/automation-health.sql) to inspect
actual job completion, overdue farms, notification backlog, missing contacts and
pg_net HTTP failures. `automation_runs` stores sanitized per-run outcomes in
Supabase. A completed dispatch run can include individual failed/unknown notices;
inspect its counts and the outbox. An HTTP enqueue success alone does not prove
ingestion or delivery. Runs left running for ten minutes indicate interruption;
daily retention marks them failed.

`GET /api/farms/:farmId/notifications` returns the latest 100 owner-visible notices
with state, attempts and error codes. It excludes recipient numbers, payloads and
attempt tokens. RLS also protects direct Data API access. Delivery states advance
monotonically; delayed sent/failed callbacks cannot overwrite delivered/read.

Explicit rate-limit rejections retry up to five attempts with exponential backoff
and jitter. Unknown sends stay visible and are never automatically resent. Inspect
Kapso by provider message ID or the `agrosense:<notice UUID>:<attempt UUID>` callback
reference. Signed callbacks can reconcile them later. If there is no callback or
provider ID, an operator must determine the actual send outcome before any manual
retry; there is no generic requeue endpoint that could silently duplicate sends.

Runs retain seven days of history; receipts and terminal notice rows retain 30
days. Unknown notices remain until resolved. These retention windows exceed the
daily forecast identity horizon; future changes to historical ingestion must
reconsider deduplication retention.

## Provisioning status — 2026-09-12

The selected production sender is **AgroSense +1 204-400-0468**, phone number ID
`1242340842303957`, in Kapso project `8ca28301-d96f-4868-82f6-6affb94c6050`.
Template `agrosense_weather_alert` (`es`, UTILITY), ID `3327227480790131`, was
submitted and read back with its four named parameters intact. Its last verified
status is **PENDING**. The initial submission on the previously selected Klasty
sender was rejected and subsequently deleted at the user's request; deletion was
verified against Kapso. No messages were sent.

Application migrations, Worker deployment, notification secrets, receipt webhook,
owner contact provisioning and Supabase Cron activation have not been applied to
production by this task. Do not activate notification dispatch until the template
is approved and the intended owner's phone and opt-in are configured.

## Verification results — 2026-09-12

`pnpm check` passed: TypeScript, Biome, 288 API tests, 20 frontend tests, 43 SQL
tests, production builds and two workerd runtime tests. The runtime tests use
intercepted provider traffic and send no real messages. The end-to-end publication
test uses real PGlite migrations and Supabase RPC calls with mocked Open-Meteo
and Kapso, covering ingestion, approved fixture-rule assessment, atomic outbox,
dispatch, delivery and duplicate invocations. Further SQL tests cover lease expiry,
unknown sends, rate limits across evidence updates, escalation/withdrawal,
contact revocation, changed ownership/rules and owner-scoped status.

Final review also restricted cron-history retention to these three AgroSense jobs.
`git diff --check` passed. No UI changes were made; browser screenshots are not
applicable. Hosted pg_cron/pg_net/Vault execution, template approval, provider
acceptance and actual WhatsApp delivery remain unverified until activation.
