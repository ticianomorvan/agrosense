# AgroSense

TypeScript monorepo: React + Vite SPA, Hono API on Cloudflare Workers, and shared
Zod contracts. See [stack decisions](docs/stack.md) for boundaries, [Supabase setup](docs/supabase.md), [Kapso outbound WhatsApp](docs/kapso.md), and the [WhatsApp reasoning agent](docs/whatsapp-agent.md).

[Automatic weather monitoring](docs/weather-automation.md) uses Supabase Cron to
refresh live plots, publish rule-based alerts and dispatch deduplicated owner
notifications through Kapso. Its setup guide covers contacts, the required
customer-service window, job activation, delivery tracking and recovery.

See [product context](PRODUCT.md) for the intended audience and core job, and the
[frontend implementation contract](docs/style-guide.md) for required visual
tokens, layouts, component behavior, and verification. Read [AGENTS.md](AGENTS.md)
before implementation.

## Get started

Use Node 24 and pnpm 11.21.0.

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173. Vite forwards `/api` requests to
Wrangler at http://127.0.0.1:8787; `/api/health` remains available for diagnostics. Authenticated API routes
use the Supabase settings in `apps/api/.env`. Vite provides live frontend changes
at port 5173 while Wrangler runs the API separately.

```sh
pnpm check    # types, lint, API/web/DB tests, builds, and mocked Worker integration
pnpm preview  # built SPA on :4173 + real local Worker on :8787
```

## Layout

- `apps/web`: React application and Vite configuration.
- `apps/api`: Hono routes and Wrangler configuration.
- `packages/contracts`: browser-safe shared Zod schemas and types.

## Weather adapter

The backend includes authenticated dashboard reads and a standalone Open-Meteo
forecast adapter with frost, heat, severe-storm, and hail detection. See the
[implemented adapter scope](docs/domain-model.md#implemented-weather-adapter).
The authenticated refresh route publishes synthetic forecasts for demo farms and
complete Open-Meteo forecasts for live farms. Live crop-risk evaluations require
approved rules; absent rules do not imply safe conditions.

## Deployment

Production uses two Cloudflare resources: the `agrosense` API Worker and the
`agrosense-web` frontend on Workers Static Assets. Authenticate once with
`pnpm --filter @agrosense/api exec wrangler login`, then publish each surface:

```sh
pnpm deploy:api
pnpm --filter @agrosense/api exec wrangler secret bulk
VITE_API_BASE_URL=https://YOUR-WORKER.workers.dev pnpm deploy:web
```

Supply the Worker secrets to `secret bulk` as JSON on stdin or from an ignored
file. The core browser flow requires the four `SUPABASE_*` settings. Satellite
imagery additionally requires both `COPERNICUS_*` settings; otherwise it reports
an unavailable state. `CORS_ORIGIN` is a non-secret Wrangler variable set to
the exact frontend origin; update it if that origin changes.
Kapso, OpenRouter, and monitoring settings are required only when those features
are activated; keep the reasoning agent disabled until its owner, provider keys,
and webhook signing secret are configured. Never use a `VITE_` variable for a
secret.

For subsequent releases, apply pending Supabase migrations with `pnpm db:push`
using the linked project before deploying API changes. The multi-event demo seed
requires `20260912122000_demo_seed_events.sql` on existing installations.
Then export the same Worker origin and run `pnpm run deploy`.
It validates the origin, runs the complete `pnpm check` suite, and dry-runs both
Worker packages before publishing either one. Run `pnpm deploy:check` for the same
preflight without publishing. A frontend build failure therefore leaves both live
deployments untouched. Individual `deploy:api` / `deploy:web` commands are available
for targeted releases after verification; they do not run the complete suite.
`pnpm build` remains a non-deploying local build. The frontend's
static-assets configuration supplies SPA fallback routing, while the API Worker
grants browser CORS access only to `CORS_ORIGIN`.

Supabase is provisioned with the five-table domain schema and owner-scoped RLS.
See [Supabase setup](docs/supabase.md) for the ignored API `.env`, authentication
boundary, migration commands, and the remaining product slices. Keep credentials
out of Git and client bundles.

## Frontend workspace

The SPA provides landing, email/password sign-in, and an authenticated workspace.
Owners can create farms and plots, switch farms, and inspect plot/crop facts,
Sentinel-2 imagery, and dated weather events. Requests are owner-scoped and failed
requests never substitute sample data. See [stack and integration notes](docs/stack.md)
for the data boundary and Sentinel-2 configuration.
