# AgroSense

TypeScript monorepo: React + Vite SPA, Hono API on Cloudflare Workers, and shared
Zod contracts. See [stack decisions](docs/stack.md) for boundaries and [Supabase setup](docs/supabase.md).

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
use the Supabase settings in `apps/api/.env`. The initial web build supplies Wrangler's static asset directory;
Vite provides live frontend changes at port 5173.

```sh
pnpm check    # type checking, Biome, API/web/database tests, and production builds
pnpm preview  # built SPA + real local Worker at http://127.0.0.1:8787
```

## Layout

- `apps/web`: React application and Vite configuration.
- `apps/api`: Hono routes and Wrangler configuration.
- `packages/contracts`: browser-safe shared Zod schemas and types.

## Weather adapter

The backend includes authenticated dashboard reads and a standalone Open-Meteo
forecast adapter with frost, heat, severe-storm, and hail detection. See the
[implemented adapter scope](docs/domain-model.md#implemented-weather-adapter).
Fetching is not wired to an HTTP refresh route or persistence.

## Deployment

After selecting the intended Cloudflare account, authenticate with
`pnpm --filter @agrosense/api exec wrangler login`, then run `pnpm deploy`.
This publishes one Worker named `agrosense` with the built SPA as static assets.
API paths run the Worker first, including unknown routes; other navigation paths
use the SPA fallback. `pnpm build` only produces a dry run and does not deploy.

Supabase is provisioned with the five-table domain schema and owner-scoped RLS.
See [Supabase setup](docs/supabase.md) for the ignored API `.env`, authentication
boundary, migration commands, and the remaining product slices. Keep credentials
out of Git and client bundles.

## Frontend workspace

The field overview accepts a `FarmDataSource`; authenticated session and farm
selection still need to be connected. Until then the app shows an unavailable
state. See [stack and integration notes](docs/stack.md) for the data boundary and
Sentinel-2 configuration.
