# AgroSense stack

## Objective and acceptance

Provide a TypeScript monorepo for a Vite React field workspace and a Hono API on
Cloudflare Workers. Shared contracts validate API data; Supabase supplies
authentication and persistence. Verification includes type checking, linting,
API/frontend/database tests, production builds and browser checks.

## Decisions

| Layer | Choice | Reason |
| --- | --- | --- |
| Workspace | pnpm workspaces | Enough orchestration for two apps and a shared package |
| Language | TypeScript, strict mode | Check frontend, backend, and contracts together |
| Frontend | React + Vite | Client-rendered SPA with fast local development |
| API | Hono + Wrangler | Web-standard handlers running on Cloudflare Workers |
| Contracts | Shared Zod schemas | Runtime response validation and inferred TypeScript types |
| Hosting | Workers Static Assets + API Worker | Independent SPA/API deploys with an exact-origin CORS boundary |
| Quality | Biome + Vitest | Formatting, linting, and API/frontend tests |
| Agent | Vercel AI SDK + official OpenRouter provider | Native Zod tools and bounded `ToolLoopAgent` execution |
| Persistence | Supabase Postgres + Auth | Typed Data API client, JWT verification, and owner-scoped RLS |

Use Node 24 and the pnpm version pinned in package.json. Exact dependency
resolutions live in pnpm-lock.yaml. The frontend uses TanStack Query for server
state, Leaflet for maps, and shadcn/ui (`base-nova`) with Tailwind v4. The shared
AgroSense theme defines colors, system typography, radii and status variants.
Use its tokens consistently; competing UI kits and one-off themes are prohibited.
See the [style guide](style-guide.md).
The SPA exposes three browser routes: `/` for the requested minimal landing
page, `/sign-in` for Supabase email/password authentication, and protected
`/app` for onboarding and the field workspace. History navigation stays
client-side; unknown paths return to the landing page. A cold landing page defers
authentication and workspace code until sign-in or protected navigation. Once
initialized, the auth subscription remains active across navigation.

## Layout and implementation order

1. `packages/contracts`: browser-safe request/response schemas.
2. `apps/api`: Hono routes under `/api`; JSON errors for unknown API routes.
3. `apps/web`: React SPA using relative `/api` requests behind Vite's local proxy
   and `VITE_API_BASE_URL` in production. The production build uses Workers
   Static Assets.

The API entrypoint exports the Hono app and Durable Object class. Wrangler
minifies the production Worker bundle. The Worker allows CORS for the exact
`CORS_ORIGIN` only; bearer authentication does not use cross-origin cookies.

Both apps depend on contracts; contracts never imports application code.
TypeScript uses ESM, named exports, and inferred schema types:

```ts
export type HealthResponse = z.infer<typeof healthResponseSchema>;
```

## Commands and verification

From the repository root: `pnpm install`, `pnpm dev`, `pnpm typecheck`,
`pnpm lint`, `pnpm test`, and `pnpm build`. `pnpm check` runs all quality checks.
`pnpm preview` runs the built SPA at port 4173 and proxies its API calls to the
local Worker at port 8787. Deployment is split into `pnpm deploy:api` and
`pnpm deploy:web`; the combined `pnpm run deploy` requires `VITE_API_BASE_URL`.
`pnpm deploy:check` validates that origin, runs the full check suite, and dry-runs
both Worker packages. The combined release completes this preflight before its
first upload, then publishes the API and the already-built frontend.

API tests live beside route source. Verify real Worker routing with Wrangler,
including unknown `/api` paths and client-side navigation paths. Add behavior
tests with each feature rather than imposing an arbitrary coverage percentage.

## Persistence boundary

Supabase is provisioned with the five-table schema in `supabase/migrations`.
See [Supabase setup](supabase.md) for credentials, migrations, types, and commands.
The Worker uses `supabase-js` over the HTTP Data API. `requireAuth` verifies user
JWTs against Supabase JWKS and provides a request-scoped client that preserves
row-level security. Secret-key writes are limited to validated seed imports and
narrow onboarding, refresh, and crop-cycle RPCs. Each RPC verifies the bearer
owner passed by the Worker; direct authenticated table writes remain revoked.
The [WhatsApp agent](whatsapp-agent.md) additionally uses a dedicated read-only
adapter with server-selected identity and mandatory owner filters after verifying
the linked sender's signed webhook. Its conversation state uses Cloudflare SQLite
Durable Objects, separately from the five agricultural tables.
Never put a secret/service-role key in Vite variables or a browser bundle.

Shared contracts stay browser-safe. Database row types live in the API; product
response projections belong in shared Zod contracts. The public auth-config
endpoint exposes only the Supabase URL and publishable key; the session endpoint
proves the authentication boundary. Authenticated farm-list, farm-create,
plot-create, and dashboard routes read or mutate owner-scoped data. The
[weather adapter](domain-model.md#implemented-weather-adapter)
fetches and normalizes Open-Meteo data and detects hazards using the same forecast
and evidence contracts as the dashboard. It does not publish forecasts.
The refresh endpoint publishes synthetic forecasts for demo farms and complete
Open-Meteo forecasts for live farms. It uses the shared agronomic engine, validates
the prospective dashboard, and commits through service-only RPCs with verified
ownership and version/attempt checks. Withdrawn hazards are cancelled only when
newer evidence covers their whole previous interval. Crop-cycle mutation uses its
authenticated Supabase RPC. The browser signs in with Supabase email/password;
tokens remain in memory and are attached only to requests resolved against the
configured API origin.

[Automatic monitoring](weather-automation.md) centralizes scheduling and operations
in Supabase Cron, pg_net and Vault. Authenticated Worker job endpoints reuse the
refresh engine and send Kapso text messages while the owner's customer-service
window is active. Postgres owns due-work leases, the
transactional notification outbox, contacts, delivery receipts and execution
history. A daily source event key and per-owner/plot risk level deduplicate
notification intent. Unknown external send outcomes remain explicit for
reconciliation. All automation mutation RPCs are service-only.


## References

- [pnpm workspaces](https://pnpm.io/workspaces)
- [Vite setup](https://vite.dev/guide/)
- [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Hono CORS middleware](https://hono.dev/docs/middleware/builtin/cors)
- [Supabase Data API](https://supabase.com/docs/guides/api)

## Field workspace integration

`WorkspacePage` first loads the authenticated owner's farms. An empty account
receives a farm form followed by a plot/crop-cycle form; established accounts can
switch farms or add another farm/plot. The web form creates bounded rectangular
GeoJSON from map points or explicit decimal-degree inputs and the Worker revalidates every
geometry and relationship before its owner-safe RPC commits. There is no browser
signup or post-creation boundary editor.

`FieldOverview` consumes a `FarmDataSource`; use
`createLiveSource(userId, farmId, getAccessToken)` after session/farm selection is
available. Remount the overview on identity/farm changes and clear the QueryClient
on sign-out. Tokens stay in memory; requests target only the validated production
API origin (or the local relative proxy), remain cancellable, and are validated
with shared Zod schemas. Failed requests never substitute sample data.
The API derives risk and forecast freshness at full PostgreSQL timestamp precision.
The current web workspace shows plot facts, the selected plot assessment, and the
dated weather-event timeline; it does not render the retired risk-priority views.
Shared controls use shadcn Button, Badge, NativeSelect and Input with AgroSense
semantic tokens and status variants. Application layouts use Tailwind utilities;
custom CSS is limited to tokens, global defaults and Leaflet-generated markup.
On desktop, the selected plot's land/crop facts, the largest Sentinel-2 map, and
its newest-first weather-event timeline form three columns. At narrow widths the
facts and event record lead and the map becomes an explicit alternate view.
Phones defer Leaflet and the initial satellite request until that view opens;
subsequent toggles preserve imagery dates, plot selection and loaded map state.
The selected plot's current recommendations and potential-loss estimate appear
in a neutral assessment panel above the timeline, without a red alert border.
Expired assessments show an unavailable state. Notifications also use WhatsApp.
The initial imagery request uses the previous 30-day UTC window. Add primitives with
`pnpm dlx shadcn@latest add` from `apps/web`; the CLI and unused animation styles
are not application dependencies.

The dashboard API, weather adapter and UI share one dashboard schema, with land
and geometry definitions reused by satellite previews. Four hazard kinds, critical
risk, and ordered `recommendedActions` are preserved through the same contract.
Evaluated alerts require 1–10 actions; other assessment states have no risk or
actions. The shared engine enforces stage freshness and excludes synthetic rules
from live evaluations. `customRules` is stored on the farm, projected by the API,
and merged with the system rules before evaluation.

The authenticated `POST /api/farms/:farmId/satellite` accepts `{from, to}` UTC
instants within a past window of at most 31 days. It uses owner-scoped stored farm
bounds and server-only `COPERNICUS_CLIENT_ID` / `COPERNICUS_CLIENT_SECRET` secrets.
It returns one Sentinel-2 L2A true-color acquisition as a georeferenced PNG with
scene/source/time metadata, or an explicit unavailable state. When a window has
multiple acquisitions, a bounded daily SCL sample prefers the least-obscured farm
view; reported scene cloud cover and recency break ties and provide the fallback
when local statistics are unavailable. Missing pixels are transparent; reported
scene cloud cover is not plot cloud coverage or crop risk.

The Worker uses Copernicus [Catalog, Statistical and Process APIs](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview.html).
Requests have 8-second deadlines and bounded bodies; redirects are rejected.
Preview bounds are limited to 0.25 degrees per axis and output to 1024×1024 pixels.
Private responses are not stored. Production rate limiting and shared server caching
remain necessary before scaling this preview beyond the authenticated MVP.
