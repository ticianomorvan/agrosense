# WhatsApp agent foundation

## Objective and boundaries

A producer sends a text question through WhatsApp. The backend verifies the
Kapso webhook, persists the inbound message, and runs an agent that chooses
read-only tools, observes their results, and continues until it can answer.
The backend sends the final answer through the existing Kapso adapter.
Automatic alerts, scheduled forecast refreshes, farm mutations, media messages,
and WhatsApp onboarding are outside this slice.

This request extends the outbound-only slice in [Kapso setup](kapso.md). It is an
explicit exception to the domain model's outbound-message exclusion and its
single LLM wording-call budget. Conversation transport state lives in a
Cloudflare Durable Object; the five agricultural Supabase tables stay unchanged.

## Components

| Component | Responsibility | Depends on |
| --- | --- | --- |
| Agent tools | Owner-scoped farm/plot discovery and bounded forecast retrieval | Supabase, Open-Meteo |
| Agent runner | Reasoning-model calls, validated tool dispatch, bounded loop and execution trace | Agent tools |
| Inbound parser | Raw-byte HMAC verification and normalized text-message events | Kapso webhook contract |
| Conversation worker | Durable admission, deduplication, serialized processing, bounded history and replies | Runner, parser, outbound adapter |

Code lives in `apps/api/src/agent`, with tests
beside each module. Public response types belong in `packages/contracts`.
Use existing TypeScript, Hono, Zod and Vitest conventions and native fetch.

## Agent behavior

Use the OpenRouter Responses API with a configurable reasoning model and explicit
reasoning effort. Tool choice is made by the model. The application executes
only registered tools and returns their results through `function_call_output`.
Preserve response items, including provider reasoning fields and encrypted
reasoning, between steps of one run. Do not expose or log private reasoning.
Return only the final answer. Requests use the fixed
`https://openrouter.ai/api/v1/responses` endpoint and require providers to support
all supplied parameters (`provider.require_parameters=true`), including tools
and reasoning. Provider fallbacks are disabled; errors follow the existing
bounded failure path. The endpoint is stateless: every step sends the complete
in-run context, without `previous_response_id`.

Initial tools:

- `list_farms`: discover farms owned by the configured user.
- `list_plots`: discover plots within an owned farm.
- `get_forecast`: fetch 1–7 local calendar days of temperature and precipitation
  forecast for an owned plot's stored sample point.

The server supplies identity, provider URLs and credentials. Tool arguments
cannot override them. Each data query enforces ownership, including requests
for guessed IDs. Data tools never mutate agricultural records. Live forecast
reads do not publish events, alter the dashboard or evaluate agronomic risk.
Demo farms return an explicit unavailable result for live forecasts.

For "how's the forecast looking for the next three days?", the expected trace
is farm discovery, plot discovery, forecast retrieval and a grounded answer.
If the location is ambiguous, the agent asks a concise clarifying question.
Follow-up messages use the conversation's recent user/assistant history.
Instructions require current tools for current facts and treat tool data and
user text as untrusted input, never as authorization. Unsupported agronomic
claims must not be invented.

Limits: eight model steps, eight tool calls, 4,096 model output tokens per step,
60 seconds per agent run, 20 seconds per model request, eight seconds per data
request, and 4,096 characters per final reply. Tool failures are structured
results the model can reason about; invalid model responses, deadline or budget
exhaustion produce a concise unavailable reply. No automatic model/provider
retries inside a run.

## Trust and delivery

Only the configured sender number may talk to the agent, mapped to
`KAPSO_ALLOWED_USER_ID`. Verify `X-Webhook-Signature` with HMAC-SHA256 against
raw bytes before parsing. Check the configured business phone-number ID and
inbound direction. Ignore outbound echoes, history imports, non-text messages,
unlinked senders and events older than 24 hours. Support Kapso v2 unbuffered
and bounded batch deliveries. Anonymous messages never invoke tools or the model.

A signed WhatsApp sender is a separate authentication channel from a Supabase
browser JWT. The read-only agent data adapter uses the server secret key with
mandatory owner filters; the model never sees that credential. This explicitly
extends the previously admin-only use of that key to the configured agent's
owner-scoped reads. Do not introduce a generic privileged query tool.

A Durable Object handles one sender/owner/business-number tuple. Admission
persists the message and schedules an alarm before returning HTTP 200.
Deduplicate by the signed message ID and content fingerprint, so changing an
unsigned webhook delivery header cannot trigger another reply. Bound the queue
to 20 and admission to 60 new messages per hour. Duplicate delivery is harmless;
reuse of a message ID with changed content is rejected.

Only one alarm processor runs per conversation. Persist the generated reply
before delivery, and persist a sending marker before the Kapso call. A crash or
uncertain send response is recorded as an unknown outcome and never blindly
resent. Interrupted read-only reasoning can be attempted again with a bounded
attempt count. These semantics favor avoiding duplicate messages over guaranteed
delivery. No claim of exactly-once delivery is made.

Retain up to six user/assistant exchanges in a session that expires 24 hours
after its first accepted reply. Follow-ups do not extend that expiry. Store message-ID receipts
and execution metadata for seven days, without completed message bodies or raw
tool output. Cleanup alarms expire the local data; Cloudflare recovery backups
follow its separate retention policy. Operator status responses contain tool
names/outcomes and message IDs, never reasoning, credentials or message bodies.

## Configuration and enablement

The agent runs in the AgroSense Worker using OpenRouter; Kapso supplies WhatsApp
transport. It is disabled by default. Fill `apps/api/.env` using the checked-in
example for local development. In production, configure the same bindings using
Wrangler secret prompts; never commit keys or put them in `VITE_*` variables.

| Binding | Required value |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWKS_URL` | Existing [Supabase settings](supabase.md) |
| `SUPABASE_SECRET_KEY` | Server secret for the explicitly owner-filtered read adapter |
| `KAPSO_API_KEY` | Kapso project credential |
| `KAPSO_PHONE_NUMBER_ID` | Connected business sender's numeric Meta ID |
| `KAPSO_ALLOWED_USER_ID` | Supabase Auth UUID owning the accessible farms and allowed to inspect runs |
| `WHATSAPP_AGENT_PHONE_NUMBER` | Producer's verified WhatsApp number, 7–15 international digits; optional leading `+` |
| `KAPSO_WEBHOOK_SECRET` | Subscription signing secret, at least 16 characters |
| `OPENROUTER_API_KEY` | OpenRouter API credential |
| `OPENROUTER_MODEL` | Responses reasoning model; default `openai/gpt-5.4-mini` |
| `OPENROUTER_REASONING_EFFORT` | `low`, `medium` (default), or `high`; model must support the choice |
| `WHATSAPP_AGENT_ENABLED` | Literal `true` to enable; `false` to disable |

Use a provider-qualified model ID (`provider/model`) supporting both reasoning
and function calling. The default is GPT-5.4 Mini through OpenRouter; changing
`OPENROUTER_MODEL` requires no agent-loop change. Direct `OPENAI_*` settings are
no longer read, and an OpenAI API key cannot substitute for an OpenRouter key.
No new SDK or frontend configuration is required.

Example interactive configuration command (repeat for each required binding):

```sh
pnpm --filter @agrosense/api exec wrangler secret put OPENROUTER_API_KEY
```

Confirm the operator owns a farm and plot with a valid stored sample point.
The initial database has no seed producer/farm records. Empty data produces a
helpful unavailable/clarification response; it must not fabricate a location.
Live forecasts require `data_mode=live`. This slice does not create records.

Deploy with the existing `pnpm deploy` workflow when ready to publish. Wrangler
creates the SQLite Durable Object class via migration `whatsapp-agent-v1`.
No Supabase migration is needed. Configure a Kapso v2 webhook subscription for
`whatsapp.message.received`, pointing to
`https://<your-worker-host>/api/whatsapp/webhook`, with the same signing secret.
Use unbuffered events or batches of at most 20 messages and 128 KiB. The event
name must be sent in `X-Webhook-Event`; the bare hex HMAC belongs in
`X-Webhook-Signature`. No Supabase bearer token is needed on this webhook.

The linked producer messages the business number first, opening WhatsApp's
24-hour customer service window. Ask “how's the forecast looking for the next
three days?”; the forecast tool currently includes today and the next two local
calendar days. The model can ask which farm/plot to use when there is ambiguity.
This primitive supports one explicitly mapped producer per deployment; it does
not implement account linking, groups, media, templates, or BSUID-only contacts.

To disable processing, set `WHATSAPP_AGENT_ENABLED=false`. Both run and send
recheck current configuration, so queued work cannot send under a changed
identity. Status inspection also requires the full enabled configuration.
Changing owner/sender/business identity selects a different conversation store.
No scheduled agricultural checks or automatic alerts are installed; Durable
Object alarms only process admitted messages, recover interrupted work and
expire conversation data.

## HTTP and operational status

`POST /api/whatsapp/webhook` returns HTTP 200 only after durable admission:

```json
{"accepted":1,"duplicates":0,"ignored":0}
```

This acknowledges queued work, not model completion or WhatsApp delivery.
Invalid signatures return 401, malformed payloads 400, excessive bodies 413,
changed content for an existing message ID 409, capacity limits 429, and missing
configuration or storage failure 503. Unsupported senders/events return 200
with an ignored count. Kapso can retry failed admission; duplicate signed
messages are deduplicated for seven days.

`GET /api/whatsapp/agent/runs/<URL-encoded-inbound-message-id>` requires a verified
Supabase access token belonging to `KAPSO_ALLOWED_USER_ID`. It returns 404 for an
unknown/expired ID, 401 without authentication, and 403 for another user.
The response includes `status`, `attempts`, `modelSteps`, safe tool `trace`,
`replyMessageId`, timestamps and an optional `errorCode`.

Statuses progress through `queued`, `running`, `reply_pending`, `sending`, then
`accepted`, `failed` or `send_unknown`. `accepted` means Kapso accepted the reply;
it is not a delivery/read receipt. `send_unknown` must be reconciled in Kapso
before any manual resend. A model failure can still produce `accepted` for a
short unavailable reply, with the failure recorded in `errorCode`. That fixed
fallback is currently English; successful replies follow the user's language.

No message text, tool-result bodies or private reasoning are exposed in run
status. Completed bodies remain only in the bounded local conversation history.
The Responses API uses `store:false`; provider-side logging/retention remains
subject to OpenRouter's and the routed provider's policies and account settings.

## Local verification

```sh
pnpm check
# To repeat just the runtime check after building:
pnpm --filter @agrosense/api test:runtime
```

The runtime test starts local workerd through Miniflare, uses fake keys and
locally signed JWTs, and intercepts every outbound request. It exercises actual
Hono routing, HMAC authentication, SQLite Durable Object admission/alarms,
the four-step model/tool loop, Kapso response parsing, replay conflicts and
history after object eviction. It requires permission to bind a localhost port.
It never loads `.env` or sends a real WhatsApp message. Provider mocks verify
transport and orchestration; they do not establish live model quality or delivery.

Verified on 2026-09-12 with Node 24.19.0 and pnpm 11.21.0: `pnpm check` passed
type checking, Biome, 113 API tests, four database tests, Vite and Wrangler dry-run
builds, and the local workerd integration test. `pnpm audit --prod` reported no
known vulnerabilities. Runtime verification caught and fixed native fetch
receiver binding and redirect-mode incompatibilities; provider redirects are
rejected without following them. No UI files changed, so no visual acceptance
claim is made. Live webhook delivery, OpenRouter answers and WhatsApp delivery remain
unverified; deployment and real credentials are still required.

## Acceptance and verification

- Tests prove a multi-step model → tool → model sequence, including reasoning
  item continuity, invalid/unknown tool calls, budgets and provider failure.
- Tools reject cross-owner IDs and invalid forecasts. Dates, units and source
  attribution accompany forecast values; missing values never become zero.
- Webhook tests cover signatures, exact raw bytes, batches, unsupported events,
  sender authorization and stale messages.
- Durable-worker tests cover duplicates, concurrent admission, bounded queues,
  history, restart recovery, terminal failures and uncertain sends.
- `pnpm check` passes. Verify the durable route in a local Worker with fake
  provider responses. No real WhatsApp send is needed for automated tests.
- Live enablement requires actual Kapso/OpenRouter keys, a linked sender, operator
  UUID, populated farm data and a public webhook deployment.

Reference documentation:

- [OpenRouter Responses API](https://openrouter.ai/docs/api_reference/responses/overview)
- [OpenRouter tool calling](https://openrouter.ai/docs/api_reference/responses/tool-calling)
- [OpenRouter reasoning](https://openrouter.ai/docs/api_reference/responses/reasoning)
- [OpenRouter parameter-aware routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Default model](https://openrouter.ai/openai/gpt-5.4-mini)
- [Kapso event shapes](https://docs.kapso.ai/docs/platform/webhooks/message-events)
- [Kapso webhook signatures](https://docs.kapso.ai/docs/platform/webhooks/security)
- [Kapso delivery and batches](https://docs.kapso.ai/docs/platform/webhooks/advanced)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Worker request redirects](https://developers.cloudflare.com/workers/runtime-apis/request/)
- [Native invocation binding](https://developers.cloudflare.com/workers/observability/errors/)
- [Open-Meteo forecast](https://open-meteo.com/en/docs)
