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
| Hosting | Workers Static Assets + API Worker | One deployment and origin; explicit `/api` routing |
| Quality | Biome + Vitest | Formatting, linting, and API/frontend tests |
| Agent | Vercel AI SDK + official OpenRouter provider | Native Zod tools and bounded `ToolLoopAgent` execution |
| Persistence | Supabase Postgres + Auth | Typed Data API client, JWT verification, and owner-scoped RLS |

Use Node 24 and the pnpm version pinned in package.json. Exact dependency
resolutions live in pnpm-lock.yaml. The frontend uses TanStack Query for server
state, Leaflet for maps, and shadcn/ui (`base-nova`) with Tailwind v4. The shared
AgroSense theme defines colors, system typography, radii and status variants.
Use its tokens consistently; competing UI kits and one-off themes are prohibited.
See the [style guide](style-guide.md).
Routing is deferred while there is only one workspace screen.

## Layout and implementation order

1. `packages/contracts`: browser-safe request/response schemas.
2. `apps/api`: Hono routes under `/api`; JSON errors for unknown API routes.
3. `apps/web`: React SPA using same-origin `/api` requests. Vite proxies them to
   Wrangler locally. Production assets are served by Workers Static Assets.

The API entrypoint exports the Hono app and Durable Object class. Wrangler minifies
the production Worker bundle.

Both apps depend on contracts; contracts never imports application code.
TypeScript uses ESM, named exports, and inferred schema types:

```ts
export type HealthResponse = z.infer<typeof healthResponseSchema>;
```

## Commands and verification

From the repository root: `pnpm install`, `pnpm dev`, `pnpm typecheck`,
`pnpm lint`, `pnpm test`, and `pnpm build`. `pnpm check` runs all quality checks.
`pnpm preview` serves the built SPA and API together locally.

API tests live beside route source. Verify real Worker routing with Wrangler,
including unknown `/api` paths and client-side navigation paths. Add behavior
tests with each feature rather than imposing an arbitrary coverage percentage.

## Persistence boundary

Supabase is provisioned with the five-table schema in `supabase/migrations`.
See [Supabase setup](supabase.md) for credentials, migrations, types, and commands.
The Worker uses `supabase-js` over the HTTP Data API. `requireAuth` verifies user
JWTs against Supabase JWKS and provides a request-scoped client that preserves
row-level security. Secret-key operations are reserved for explicit administration.
The [WhatsApp agent](whatsapp-agent.md) additionally uses a dedicated read-only
adapter with server-selected identity and mandatory owner filters after verifying
the linked sender's signed webhook. Its conversation state uses Cloudflare SQLite
Durable Objects, separately from the five agricultural tables.
Never put a secret/service-role key in Vite variables or a browser bundle.

Shared contracts stay browser-safe. Database row types live in the API; product
response projections belong in shared Zod contracts. The session endpoint proves
the authentication boundary. The authenticated dashboard route reads stored farm
snapshots. The [weather adapter](domain-model.md#implemented-weather-adapter)
fetches and normalizes Open-Meteo data and detects hazards using the same forecast
and evidence contracts as the dashboard. It does not publish forecasts.
The refresh endpoint publishes synthetic forecasts for demo farms; live refresh
returns unavailable. Crop-cycle mutation is implemented by the API route and
Supabase RPC. Live publication and sign-in UI remain subsequent feature slices.


## References

- [pnpm workspaces](https://pnpm.io/workspaces)
- [Vite setup](https://vite.dev/guide/)
- [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Workers SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [Supabase Data API](https://supabase.com/docs/guides/api)

## Field workspace integration

`FieldOverview` consumes a `FarmDataSource`; use
`createLiveSource(userId, farmId, getAccessToken)` after session/farm selection is
available. Remount the overview on identity/farm changes and clear the QueryClient
on sign-out. Tokens stay in memory; requests are same-origin, cancellable and
validated with shared Zod schemas. Failed requests never substitute sample data.
Risk and forecast freshness update at response deadlines and tab resume without a
network fetch; sub-millisecond PostgreSQL deadlines are not rounded down.
Shared controls use shadcn Button, Badge, NativeSelect and Input with AgroSense
semantic tokens and status variants. Application layouts use Tailwind utilities;
custom CSS is limited to tokens, global defaults and Leaflet-generated markup.
Map rendering loads lazily. Add primitives with `pnpm dlx shadcn@latest add` from
`apps/web`; the CLI and unused animation styles are not application dependencies.

The dashboard API, weather adapter and UI share one dashboard schema, with land
and geometry definitions reused by satellite previews. Four hazard kinds, critical
risk, and ordered `recommendedActions` are preserved through the same contract.
The read contract remains compatible with the stored schema: up to 20 actions,
including an evaluated assessment with no actions. The UI reports actions as
unavailable in that case. The domain reference's stricter 1–10 publication rule
still requires alignment in the publication/storage slice. `customRules` is also
not yet stored or projected; the client does not fabricate an empty rule array.

The authenticated `POST /api/farms/:farmId/satellite` accepts `{from, to}` UTC
instants within a past window of at most 31 days. It uses owner-scoped stored farm
bounds and server-only `COPERNICUS_CLIENT_ID` / `COPERNICUS_CLIENT_SECRET` secrets.
It returns the newest Sentinel-2 L2A true-color acquisition as a georeferenced PNG
with scene/source/time metadata, or an explicit unavailable state. Missing pixels
are transparent; scene cloud cover is not plot cloud coverage or crop risk.

The Worker uses Copernicus [Catalog and Process APIs](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview.html).
Requests have 8-second deadlines and bounded bodies; redirects are rejected.
Preview bounds are limited to 0.25 degrees per axis and output to 1024×1024 pixels.
Private responses are not stored. Production rate limiting and shared server caching
remain necessary before scaling this preview beyond the authenticated MVP.
