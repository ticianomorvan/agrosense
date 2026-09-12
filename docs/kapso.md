# Kapso outbound WhatsApp

The manual send endpoint and the [conversational agent](whatsapp-agent.md) share
one Kapso adapter. This is the explicit WhatsApp exception to the
[domain model](domain-model.md); no agricultural tables or refresh rules change.

## Configuration

Copy `apps/api/.env.example` to the ignored `apps/api/.env` for local development.
Keep credentials server-side. The [Supabase settings](supabase.md) and these
three bindings are required for manual sending:

| Binding | Value |
| --- | --- |
| `KAPSO_API_KEY` | Kapso project API key |
| `KAPSO_PHONE_NUMBER_ID` | Connected business sender's numeric Meta ID, not its telephone number |
| `KAPSO_ALLOWED_USER_ID` | Supabase Auth UUID of the operator allowed to send |

Restart Wrangler after local configuration changes. In production, set each
binding with `pnpm --filter @agrosense/api exec wrangler secret put <NAME>`.
Removing the Kapso key or operator binding disables manual sending; the agent's
separate enable flag does not disable this endpoint.

## Manual send

`POST /api/whatsapp/messages` requires a verified Supabase bearer token belonging
to the configured operator and `Content-Type: application/json`.

```json
{"to":"5493511234567","text":"Hola desde AgroSense"}
```

`to` accepts 7–15 international digits with an optional leading `+`, which is
removed. `text` is trimmed and limited to 1–4,096 characters. Unknown fields,
query parameters and JSON bodies over 16 KiB are rejected. Responses disable caching.

HTTP 200 reports provider acceptance, not delivery or reading:

```json
{"messageId":"wamid.…","status":"accepted"}
```

| HTTP | Error code | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed JSON or query parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid Supabase token |
| 403 | `FORBIDDEN` | User is not the configured operator |
| 413 | `PAYLOAD_LIMIT_EXCEEDED` | Body exceeds 16 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Body is not JSON |
| 422 | `VALIDATION_ERROR` | Invalid or unknown fields |
| 502 | `KAPSO_REJECTED` | Provider rejected the request |
| 502/504 | `SEND_OUTCOME_UNKNOWN` | Send may have occurred; check Kapso before retrying |
| 503 | `KAPSO_RATE_LIMITED` | Provider returned HTTP 429 |
| 503 | `KAPSO_UNAVAILABLE` / `AUTH_UNAVAILABLE` | Configuration or authentication service unavailable |

The adapter makes one attempt with an eight-second deadline to the fixed
`https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages` endpoint.
It rejects redirects and never logs credentials, message bodies or provider errors.
The manual endpoint has no deduplication or message history: each call attempts
another message. Conversation deduplication belongs to the agent.

The recipient must message the connected business number first to open the
24-hour customer service window. Templates for initiating conversations, bulk
sending and delivery receipts are outside this foundation.

Run `pnpm check` for authentication, validation, provider failures and local Worker
coverage. Tests use fake credentials; they do not establish live delivery.

References: [send text and service window](https://docs.kapso.ai/docs/whatsapp/send-messages/text),
[provider response](https://docs.kapso.ai/api/meta/whatsapp/messages/send-a-message),
[connected phone IDs](https://docs.kapso.ai/api/platform/v1/phone-numbers/list-phone-numbers).
