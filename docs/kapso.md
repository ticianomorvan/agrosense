# Kapso outbound WhatsApp

## Scope and acceptance

The 2026-09-12 request explicitly adds configuration and outbound WhatsApp to the
MVP. This is a scoped exception to the outbound-message exclusion in
[the domain model](domain-model.md), not a change to its five-table design.

Provide one manual text-send endpoint, accessible only to a verified Supabase
user whose ID matches the configured operator. Validate requests, keep Kapso
credentials server-side, bound provider requests to eight seconds, and return
provider acceptance with a message ID. Missing settings must fail closed. Test
authentication, operator authorization, invalid inputs, provider failures and
ambiguous outcomes. This manual endpoint makes no database writes or automated
alerts. The subsequent [WhatsApp agent foundation](whatsapp-agent.md) adds signed
inbound webhooks, read-only tools and durable conversational replies.

## Configuration

In this worktree, copy `apps/api/.env.example` to `apps/api/.env` and fill in the
existing Supabase settings plus:

| Variable | Value |
| --- | --- |
| `KAPSO_API_KEY` | Project API key from Kapso |
| `KAPSO_PHONE_NUMBER_ID` | Connected sender's numeric Meta phone number ID, not its telephone number |
| `KAPSO_ALLOWED_USER_ID` | Supabase Auth UUID of the one operator allowed to send |

The API key alone is insufficient. A connected sender is required. The operator
setting prevents other authenticated accounts from using the project sender.
Keep these values out of Vite variables. `.env` is ignored by Git. Restart
Wrangler after changing local settings.

For production, set each binding through Wrangler's interactive secret prompt:

```sh
pnpm --filter @agrosense/api exec wrangler secret put KAPSO_API_KEY
pnpm --filter @agrosense/api exec wrangler secret put KAPSO_PHONE_NUMBER_ID
pnpm --filter @agrosense/api exec wrangler secret put KAPSO_ALLOWED_USER_ID
```

Supabase configuration remains required; see [Supabase setup](supabase.md).
Configuration does not send a message. Tests use fake credentials and mock Kapso;
a live check requires the actual key, sender, authenticated operator and an
explicitly chosen recipient and message.

## HTTP contract

`POST /api/whatsapp/messages` requires `Authorization: Bearer <Supabase access
token>` and `Content-Type: application/json`. All responses disable caching with
`Cache-Control: no-store`; handler responses also include `private`.

```json
{"to":"5493511234567","text":"Hola desde AgroSense"}
```

`to` is an international number of 7–15 digits starting with 1–9; an optional
leading `+` is removed before sending. Spaces and national trunk prefixes are
rejected. `text` is trimmed and must contain 1–4,096 characters. Unknown fields
and query parameters are rejected. JSON bodies are limited to 16 KiB.

A successful provider response returns HTTP 200:

```json
{"messageId":"wamid.…","status":"accepted"}
```

Acceptance does not establish delivery or reading. The manual endpoint has no
delivery webhook or local message history. The caller chooses the recipient and wording;
no farm data is automatically fetched or sent. The adapter does not log phone
numbers, message bodies, credentials or raw provider errors.

| HTTP | Error code | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed JSON or query parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid Supabase token |
| 403 | `FORBIDDEN` | Verified user is not the configured operator |
| 413 | `PAYLOAD_LIMIT_EXCEEDED` | Body exceeds 16 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Body is not JSON |
| 422 | `VALIDATION_ERROR` | Invalid fields or unknown keys |
| 502 | `KAPSO_REJECTED` | Kapso rejected the request; check sender, credentials and conversation eligibility |
| 502/504 | `SEND_OUTCOME_UNKNOWN` | Connection failure, upstream server error, malformed success or timeout; send may have occurred |
| 503 | `KAPSO_RATE_LIMITED` | Kapso returned HTTP 429 |
| 503 | `KAPSO_UNAVAILABLE` | Missing or invalid Kapso configuration |
| 503 | `AUTH_UNAVAILABLE` | Supabase configuration/JWKS unavailable |

**Unsafe to retry automatically:** each call attempts a new message. There is no
idempotency store and no automatic retry. Check Kapso's message history before
manually retrying an unknown outcome. Removing the API key or operator binding
disables sending. This is a single-operator manual integration; bulk sending,
automation, distributed rate limits and recipient/consent management require a
separate design before wider rollout.

## Provider contract

Uses native Worker `fetch` to the fixed
`https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages` endpoint,
with `X-API-Key`. Redirects are rejected. The sender ID is validated as digits;
callers cannot choose an upstream URL or credential. Native fetch avoids an SDK
for one operation. The response is validated before exposing a message ID.

Free-form text requires an open 24-hour customer service window. Have the
recipient message the connected sender first. Approved templates are required to
start or reopen a conversation; template sending is a subsequent slice.

Official references checked on 2026-09-12:

- [Send text: prerequisites, REST request and service window](https://docs.kapso.ai/docs/whatsapp/send-messages/text)
- [Send a message: request and response fields](https://docs.kapso.ai/api/meta/whatsapp/messages/send-a-message)
- [Find the connected phone number ID](https://docs.kapso.ai/api/platform/v1/phone-numbers/list-phone-numbers)

## Verification

Run `pnpm check` from the worktree root. `apps/api/src/whatsapp.test.ts` exercises
the real authentication middleware with locally signed JWTs and a mocked provider.
Use Wrangler for local routing checks. A local build or mocked success is not a
live WhatsApp delivery test.

Verified on 2026-09-12 with Node 24.19.0 and pnpm 11.21.0: type checking,
Biome, 44 API tests (31 for WhatsApp), four database tests, Vite build and
Wrangler dry-run build passed. The initial build could not write Wrangler's
default log inside the sandbox; rerunning the API build with a writable
`WRANGLER_LOG_PATH` completed cleanly. Local Wrangler HTTP checks returned health
200, unauthenticated WhatsApp POST 401 and unknown API route 404. `pnpm audit
--prod` reported no known vulnerabilities. Live Kapso acceptance and WhatsApp
delivery remain unverified until credentials and a test recipient are supplied.
