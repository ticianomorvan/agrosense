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

## Components and build order

| Component | Responsibility | Depends on |
| --- | --- | --- |
| Agent tools | Owner-scoped farm/plot discovery and bounded forecast retrieval | Supabase, Open-Meteo |
| Agent runner | Reasoning-model calls, validated tool dispatch, bounded loop and execution trace | Agent tools |
| Inbound parser | Raw-byte HMAC verification and normalized text-message events | Kapso webhook contract |
| Conversation worker | Durable admission, deduplication, serialized processing, bounded history and replies | Runner, parser, outbound adapter |

Implement and verify tools/runner first, then inbound parsing, then durable
orchestration and HTTP wiring. Code lives in `apps/api/src/agent`, with tests
beside each module. Public response types belong in `packages/contracts`.
Use existing TypeScript, Hono, Zod and Vitest conventions and native fetch.

## Agent behavior

Use the OpenAI Responses API with a configurable reasoning model and explicit
reasoning effort. Tool choice is made by the model. The application executes
only registered tools and returns their results through `function_call_output`.
Preserve response items, including encrypted reasoning, between steps of one
run. Do not expose or log private reasoning. Return only the final answer.

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

Retain up to six user/assistant exchanges for 24 hours. Store message-ID receipts
and execution metadata for seven days, without completed message bodies or raw
tool output. Cleanup alarms expire the local data; Cloudflare recovery backups
follow its separate retention policy. Operator status responses contain tool
names/outcomes and message IDs, never reasoning, credentials or message bodies.

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
- Live enablement requires actual Kapso/OpenAI keys, a linked sender, operator
  UUID, populated farm data and a public webhook deployment.

Reference documentation:

- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Reasoning and stateless continuation](https://developers.openai.com/api/docs/guides/reasoning)
- [Kapso event shapes](https://docs.kapso.ai/docs/platform/webhooks/message-events)
- [Kapso webhook signatures](https://docs.kapso.ai/docs/platform/webhooks/security)
- [Kapso delivery and batches](https://docs.kapso.ai/docs/platform/webhooks/advanced)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Open-Meteo forecast](https://open-meteo.com/en/docs)
