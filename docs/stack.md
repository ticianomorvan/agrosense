# AgroSense stack

## Objective and acceptance

Provide a TypeScript monorepo for a Vite React SPA and a Hono API on Cloudflare
Workers. The initial slice proves browser-to-API connectivity without credentials.
Success means a clean install, type check, lint, API tests, production build, and
local runtime checks for API responses and SPA fallback.

## Decisions

| Layer | Choice | Reason |
| --- | --- | --- |
| Workspace | pnpm workspaces | Enough orchestration for two apps and a shared package |
| Language | TypeScript, strict mode | Check frontend, backend, and contracts together |
| Frontend | React + Vite | Client-rendered SPA with fast local development |
| API | Hono + Wrangler | Web-standard handlers running on Cloudflare Workers |
| Contracts | Shared Zod schemas | Runtime response validation and inferred TypeScript types |
| Hosting | Workers Static Assets + API Worker | One deployment and origin; explicit `/api` routing |
| Quality | Biome + Vitest | Formatting, linting, and API contract tests |
| Persistence | Supabase Postgres + Auth | Typed Data API client, JWT verification, and owner-scoped RLS |

Use Node 24 and the pnpm version pinned in package.json. Exact dependency
resolutions live in pnpm-lock.yaml. Add routing, server-state caching, and a UI
component library when the first product screen needs them.

## Layout and implementation order

1. `packages/contracts`: browser-safe request/response schemas.
2. `apps/api`: Hono routes under `/api`; JSON errors for unknown API routes.
3. `apps/web`: React SPA using same-origin `/api` requests. Vite proxies them to
   Wrangler locally. Production assets are served by Workers Static Assets.

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
Never put a secret/service-role key in Vite variables or a browser bundle.

Shared contracts stay browser-safe. Database row types live in the API; product
response projections belong in shared Zod contracts. The session endpoint proves
the authentication boundary. Demo imports, product routes, mutation RPCs, forecast
adapters, and sign-in UI are subsequent feature slices.

## References

- [pnpm workspaces](https://pnpm.io/workspaces)
- [Vite setup](https://vite.dev/guide/)
- [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Workers SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [Supabase Data API](https://supabase.com/docs/guides/api)
