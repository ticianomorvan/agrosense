# WhatsApp agent foundation

A signed Kapso text message is admitted to a Durable Object. Vercel AI SDK’s
`ToolLoopAgent` runs a bounded tool loop through the official OpenRouter provider.
The final answer is sent through the shared
[Kapso adapter](kapso.md). For this public demo, every valid inbound sender is
mapped to one configured Supabase owner. Each sender has an isolated queue, history,
rate limit and run receipts, but all senders can query that owner's farm data; this
is not an account-linking or authorization flow.
Automatic alerts, scheduled forecast refreshes, farm mutations, media, templates,
and account-linking flows are outside this slice.
For implementation changes, see the [official skills and development references](agent-development.md).

## Tools and data boundaries

| Tool | Behavior |
| --- | --- |
| `list_farms` | Discover the configured owner's farms |
| `list_plots` | Discover plots in an owned farm |
| `get_forecast` | Fetch 1–7 local calendar days, including today, for an owned plot's stored sample point |

Forecasts include local dates, temperatures at 2 m in Celsius, precipitation in
mm, retrieval time and Open-Meteo attribution. Live reads require `data_mode=live`;
demo farms return unavailable. These tools do not update dashboard snapshots or
infer agronomic risk. Missing data never becomes zero rainfall or a safe condition.

The server supplies owner identity, URLs and credentials. Every Supabase query
has an owner filter; tools cannot choose another identity or issue arbitrary
queries. This is the explicit exception allowing the Supabase server secret for
owner-scoped agent reads. Agricultural tables and dashboard refresh budgets in
[the domain model](domain-model.md) remain unchanged.

The model chooses tools and receives their results before continuing. AI SDK manages
the message history and tool results; the OpenRouter provider preserves its
`reasoning_details` within a run. Only the final answer leaves the runner. Current facts require current tools;
ambiguous locations should produce a clarifying question. Recent user/assistant
turns provide follow-up context, without retaining private reasoning or tool bodies.

## Configuration

Use the ignored `apps/api/.env` locally, based on
[the environment example](../apps/api/.env.example). Supply the existing
[Supabase](supabase.md) and [Kapso](kapso.md) bindings plus:

| Binding | Value |
| --- | --- |
| `SUPABASE_SECRET_KEY` | Server key for the owner-scoped read adapter |
| `KAPSO_WEBHOOK_SECRET` | Kapso subscription signing secret, at least 16 characters |
| `OPENROUTER_API_KEY` | OpenRouter inference key |
| `OPENROUTER_MODEL` | Default `deepseek/deepseek-v4.1-flash` |
| `OPENROUTER_REASONING_EFFORT` | `low`, `medium` (default), or `high` |
| `OPEN_METEO_API_KEY` | Optional customer key; uses the Open-Meteo customer forecast endpoint when set, otherwise the free endpoint |
| `WHATSAPP_AGENT_ENABLED` | Literal `true` to enable; disabled by default |

`KAPSO_ALLOWED_USER_ID` selects the single Supabase owner whose data every demo
sender can query and authorizes run inspection. The business number is selected by
`KAPSO_PHONE_NUMBER_ID`. Contact identities come from the signed inbound event;
country-specific mobile prefixes are not inferred.

The optional weather key stays inside the server-side forecast request. Tool
results and error messages do not expose it or keyed provider URLs.

The agent uses `ai` and `@openrouter/ai-sdk-provider`, with native Zod tool
schemas. The provider uses `https://openrouter.ai/api/v1/chat/completions`.
AI SDK manages tool selection, argument validation, execution and continuation;
the application enforces run limits, serializes data reads and retains safe traces.
Routing requires support for supplied parameters and disables provider fallbacks.
Providers are sorted by throughput so a price-prioritized slow endpoint does not
consume the bounded agent deadline. Model requests are not retried. A replacement
model must support reasoning and tools. OpenRouter and downstream provider
retention follows their policies and account settings. Direct `OPENAI_*` settings
are unused.

## Enablement

1. Create the owner, farm and plot records using the existing domain schema.
   Forecasts need a valid plot sample point and a live farm. Empty records yield
   an unavailable/clarification response; the agent does not invent a location.
2. Configure production bindings with
   `pnpm --filter @agrosense/api exec wrangler secret put <NAME>`, then deploy
   with `pnpm deploy:api`. Wrangler creates the SQLite Durable Object via migration
   `whatsapp-agent-v1`; no Supabase migration is added by this feature.
3. Create a phone-number-scoped Kapso v2 webhook for the configured business
   `phone_number_id`, subscribing to `whatsapp.message.received` events at
   `https://<your-worker-host>/api/whatsapp/webhook` with the same signing secret.
   Use unbuffered events or batches of at most 20 messages and 128 KiB.
4. Enable the agent and message the business number from each demo participant's
   phone.
   Verify an actual tool-backed answer, a follow-up question in the same
   conversation, and the run's status.

Setting `WHATSAPP_AGENT_ENABLED=false` stops admission and subsequent run/send
operations. Current identity is checked again before processing and sending.
Changing owner, contact sender or business number selects a different conversation
store. Status inspection requires the full enabled configuration and the contact
sender used to select that store.

## HTTP and delivery behavior

`POST /api/whatsapp/webhook` verifies the raw body using HMAC-SHA256 from the bare
hex `X-Webhook-Signature` header. The event name is in `X-Webhook-Event`.
No Supabase bearer token is required. Mismatched sender identities, wrong business
IDs, outbound echoes, history imports, non-text events and messages older than 24
hours are ignored.
BSUID-only contacts are unsupported.

The Worker calls the Durable Object through typed RPC. HTTP 200 follows durable
admission and wakeup scheduling:

```json
{"accepted":1,"duplicates":0,"ignored":0}
```

This acknowledges queued work. Invalid signatures return 401, malformed bodies
400, oversized bodies 413, conflicting message IDs 409, capacity limits 429, and
configuration/storage failures 503. Ignored events return 200 with an ignored count.
Deduplication uses signed message identity/content, independent of delivery headers.

`GET /api/whatsapp/agent/runs/<URL-encoded-message-id>?sender=<international-digits>`
requires exactly one contact sender query parameter and the configured operator's
verified Supabase bearer token. An optional leading `+` must be URL-encoded.
Unknown/expired IDs return 404; malformed lookups return 400; missing or invalid
authentication returns 401 and another user receives 403. Responses contain status,
timestamps, attempts, model steps, tool outcomes, reply message ID and error code.
They exclude bodies, credentials and reasoning.

A run moves through `queued`, `running`, `reply_pending`, `sending`, then
`accepted`, `failed` or `send_unknown`. The generated reply and then a sending
marker are persisted before calling Kapso. A crash during sending or an uncertain
provider response is never automatically resent. Interrupted read-only reasoning
is terminated with the fixed unavailable reply instead of repeating a slow model
call at the head of the per-sender queue. These semantics avoid duplicate replies
at the cost of possibly missing a reply after a crash; they do not guarantee
exactly-once delivery.

`accepted` means Kapso accepted the message, not that it was delivered. An agent
failure may send a fixed English unavailable reply and retain its error code.
Completed tool outcomes and attempted model steps are retained when a run fails.
Check Kapso before manually retrying `send_unknown`.

## Bounds and verification

| Resource | Limit |
| --- | --- |
| Agent run | 8 model steps, 8 tool calls, 60 seconds |
| Provider requests | 20 seconds per model request; 8 seconds per data/send request |
| Provider success bodies | 1 MiB for model responses; 128 KiB for Supabase; 64 KiB for forecasts; 16 KiB for sends |
| Output | 4,096 model output tokens per step; 4,096 characters per reply |
| Admission | Per sender: 20 queued messages; 60 new messages per hour |
| History | 6 exchanges; session expires 24 hours after its first accepted reply |
| Run receipts | 7 days, with completed input/reply bodies removed |

Alarms process admitted work, recover interruptions and expire local records;
they do not schedule agricultural checks. Cloudflare recovery backups have their
own retention policy.

Run `pnpm check` for types, lint, unit/database tests, builds and the local workerd
integration. To repeat only the runtime check after building, use
`pnpm --filter @agrosense/api test:runtime`. It uses fake keys, locally signed JWTs
and intercepted providers to verify routing, SQLite alarms, the tool loop,
deduplication, and history after object eviction. It never reads `.env` or sends a
real WhatsApp message. Live model behavior and delivery remain a deployment check.
Recovery from intermediate run/send states is covered by unit tests; runtime
eviction coverage verifies completed receipts and history.

For delivery problems, correlate the run and reply message IDs with Kapso's
webhook deliveries and message status. Check whether Kapso paused the webhook
after repeated failures; retries are finite and batches may fall back to
individual delivery. Consult the current delivery documentation for retry and
pause settings. Re-enable only after fixing the endpoint, and inspect Kapso
before retrying an uncertain send.

References: [AI SDK ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent),
[OpenRouter AI SDK provider](https://github.com/OpenRouterTeam/ai-sdk-provider),
[provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
[DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash),
[Kapso events](https://docs.kapso.ai/docs/platform/webhooks/message-events),
[signatures](https://docs.kapso.ai/docs/platform/webhooks/security),
[delivery/batches](https://docs.kapso.ai/docs/platform/webhooks/advanced),
[Durable Object RPC](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/),
[Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
[storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[Open-Meteo](https://open-meteo.com/en/docs).
