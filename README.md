# AgroSense

TypeScript monorepo: React + Vite SPA, Hono API on Cloudflare Workers, and shared
Zod contracts. See [stack decisions](docs/stack.md) for boundaries and the optional
Supabase persistence plan.

See the [one-page domain model](docs/domain-model.md) for the proposed farm/plot
schema, event and risk lifecycle, satellite-map data, and dashboard API contracts.

## Get started

Use Node 24 and pnpm 11.21.0.

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173. The SPA calls `/api/health` through Vite's proxy to
Wrangler at http://127.0.0.1:8787. No cloud account or database credentials are
required locally. The initial web build supplies Wrangler's static asset directory;
Vite provides live frontend changes at port 5173.

```sh
pnpm check    # type checking, Biome, API tests, and production builds
pnpm preview  # built SPA + real local Worker at http://127.0.0.1:8787
```

## Layout

- `apps/web`: React application and Vite configuration.
- `apps/api`: Hono routes and Wrangler configuration.
- `packages/contracts`: browser-safe shared Zod schemas and types.

## Deployment

After selecting the intended Cloudflare account, authenticate with
`pnpm --filter @agrosense/api exec wrangler login`, then run `pnpm deploy`.
This publishes one Worker named `agrosense` with the built SPA as static assets.
API paths run the Worker first, including unknown routes; other navigation paths
use the SPA fallback. `pnpm build` only produces a dry run and does not deploy.

Supabase has not been provisioned. Add persistence and environment configuration
with the first data feature. Keep credentials out of Git and client bundles.
