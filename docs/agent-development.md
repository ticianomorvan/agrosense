# Agent development references

Use this guide when changing the [WhatsApp agent](whatsapp-agent.md) or
[Kapso adapter](kapso.md). Product behavior and limits remain in those documents
and the [domain model](domain-model.md). Prefer an existing SDK or platform
primitive when it removes application code without weakening those boundaries.

## Official skills

These upstream skills were installed in the developer's personal Codex skill
directory on 2026-09-12. They are development aids, not runtime dependencies.
The links pin the reviewed revisions; no skill scripts or reference dumps are
vendored into this repository. Another developer can install the same paths
with Codex's skill installer, or read the linked instructions directly.

| Skill | Use for | Pinned source |
| --- | --- | --- |
| `integrate-whatsapp` | Kapso messaging, webhook setup and payloads | [gokapso/agent-skills](https://github.com/gokapso/agent-skills/tree/13fd9a16438c1f561baa49d585c75869de8d5822/skills/integrate-whatsapp) |
| `observe-whatsapp` | Delivery failures, webhook retries and provider diagnostics | [gokapso/agent-skills](https://github.com/gokapso/agent-skills/tree/13fd9a16438c1f561baa49d585c75869de8d5822/skills/observe-whatsapp) |
| `ai-sdk` | Agent loop, native tools, schemas and provider interfaces | [vercel/ai](https://github.com/vercel/ai/tree/6c6c2210b9532a4c369615c044a16d595f3db117/skills/use-ai-sdk) |
| `durable-objects` | RPC, storage, alarms, concurrency and recovery | [cloudflare/skills](https://github.com/cloudflare/skills/tree/b052c32bab7dd493513260228a36c88294f343f1/skills/durable-objects) |
| `workers-best-practices` | Worker request handling, bindings and runtime compatibility | [cloudflare/skills](https://github.com/cloudflare/skills/tree/b052c32bab7dd493513260228a36c88294f343f1/skills/workers-best-practices) |

Load only the skill relevant to the change. Kapso's hosted automation system is
outside this implementation. AI Gateway examples do not change our explicit
OpenRouter provider. Operational examples require the corresponding task scope;
installing a skill does not authorize live sends or deployments.

## Source selection

The reviewed baseline is `ai` 7.0.99, `@openrouter/ai-sdk-provider` 3.0.0,
Wrangler 4.131.1, Workers types 5.20260911.1, and compatibility date 2026-09-12.
Recheck the installed packages and Wrangler configuration after upgrades.

| Area | Read first | Application here |
| --- | --- | --- |
| AI SDK | `apps/api/node_modules/ai/docs/` and `src/`; [ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent) | Bundled docs match the installed major. Use SDK orchestration and Zod tools; keep explicit application budgets and cancellation. Verify callback behavior in source before using a callback to enforce a limit. |
| OpenRouter | Installed provider `README.md`, `dist/index.d.ts` and `dist/index.js`; [provider repository](https://github.com/OpenRouterTeam/ai-sdk-provider), [reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [routing](https://openrouter.ai/docs/guides/routing/provider-selection) | Preserve provider metadata through tool continuations. Verify model capabilities and routing parameters against OpenRouter before changing the configured model. |
| DeepSeek | [Thinking mode and tool calls](https://api-docs.deepseek.com/guides/thinking_mode/) | Direct API examples use `reasoning_content`; our route uses OpenRouter's provider representation. Do not copy direct API fields or model IDs into this adapter without checking the route. |
| Kapso | [Documentation index](https://docs.kapso.ai/llms.txt), [security](https://docs.kapso.ai/docs/platform/webhooks/security), [delivery](https://docs.kapso.ai/docs/platform/webhooks/advanced), [message events](https://docs.kapso.ai/docs/platform/webhooks/message-events) | Verify raw bytes, scope subscriptions to the business phone number, acknowledge durable admission promptly, and deduplicate signed message identity. Delivery headers alone are not authenticated identity. |
| Cloudflare | Installed Wrangler `config-schema.json` and platform types; [DO rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [Workers practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) | Typed RPC and SQLite-backed state remain the coordination boundary. One alarm belongs to each object; protect related storage writes and account for interleaving around external I/O. |

Use current official pages for hosted service behavior and installed sources for
library signatures. Search snippets and copied examples can lag the actual page.
If they conflict, inspect the current API/source and record the uncertainty;
do not resolve it by adding speculative compatibility code.

## Review and verification

1. Preserve owner-scoped reads and the distinction between live, demo and
   unavailable data. Model-generated arguments cannot select an owner or URL.
2. Preserve reasoning metadata within each tool loop. Persist only the existing
   user/assistant history and safe receipts; keep reasoning and tool bodies out
   of WhatsApp replies, status responses and logs. Direct-provider reasoning
   retention requirements need a separate review before changing routes.
3. Keep admission durable before HTTP 200 and the sending marker durable before
   Kapso I/O. Alarm retries are not proof that an external send is safe to retry.
   Preserve `send_unknown` and the current bounded recovery behavior.
4. For runtime changes, run `pnpm check`. Existing runner tests cover tool
   continuation and provider metadata; conversation tests cover interrupted
   states; workerd integration covers RPC, alarms, deduplication and eviction.
   Documentation-only changes need link/consistency checks and `git diff --check`.

Before enabling a new model/provider configuration, a separately authorized live
check must cover a tool-backed question and a follow-up question in the same
conversation. Mocks establish protocol handling, not model quality or provider
acceptance of the retained history. Check routing, tool support, reasoning
continuation, language, units and actual WhatsApp delivery.
