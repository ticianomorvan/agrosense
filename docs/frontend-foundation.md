# Frontend foundation

Scope: the first producer workspace, reusable UI primitives, a cancellable data
layer, and the Sentinel-2 integration boundary. This implements the existing
[product context](../PRODUCT.md), [design contract](style-guide.md), and
[domain model](domain-model.md). It does not implement weather/risk evaluation,
cultivation writes, notifications, or authentication screens.

## Context and ownership

Read in Hack CBA on 2026-09-12: P1 integrates meteorological observations; P2
evaluates agronomic alerts; P3 owns authenticated API/persistence/notifications;
P4 consumes and visualizes results. P4 posted its plan at 04:07: dashboard, filters, plot details, data states and an offline demo. The user explicitly chose the merged contracts over its conflicting Tailwind and simplified schema suggestions.
The broader channel proposals include storms and hail; the merged MVP contract
remains authoritative for this slice: maize/soybean, frost, one farm, seeded plots.

## Modules and build order

| Module | Responsibility | Depends on |
| --- | --- | --- |
| ui | Native semantic React controls and plain CSS tokens | Design contract |
| data | TanStack Query, fetch cancellation, Zod response validation | Shared contracts |
| fields | Responsive overview, selection, crop filter, equivalent field list | ui, data |
| satellite | Leaflet raster overlay and bounded server-side Sentinel Hub adapter | fields, shared contracts |

Build in that order. React state owns selection and filters; Query owns remote
state. No router, global store, CSS framework, or styled third-party UI kit is
needed for this single screen. The local UI library exports Button, StatusLabel,
SelectField and DataState; use those before adding another component library.

The user selects “Explore demo farm” to load synthetic land from a fixture adapter.
It uses the shared response schema; failed live requests must never become demo
successes. Without a configured data adapter, the initial screen displays unavailable and offers the explicit demonstration.
P3 can supply the authenticated dashboard adapter without changing presentation.
English remains the UI language, per the style guide.

## Data pattern

Create one QueryClient at the application boundary. Colocate query options with
the feature. Include identity, farm and request parameters in private query keys;
clear the client on sign-out/account change. Pass AbortSignal to fetch, use only
same-origin API paths, validate JSON before caching, and normalize errors without
showing provider responses or credentials. Retry transient reads at most once;
do not retry 4xx errors or writes automatically. Query staleTime controls network
reuse, not the freshness of weather or imagery. Show source timestamps separately.

## Acceptance and verification

- Native controls use the fixed tokens, 44px targets and visible focus.
- Desktop map leads; tablet priorities lead; phone map is an alternate view.
- Plot selection and crop filters agree between map and list and survive view changes.
- Unknown crop/stage, forecast, risk and imagery are labeled unavailable.
- Failed requests offer retry; aborts do not appear as errors; private data is
  not persisted in browser storage.
- Satellite rendering has an acquisition date, source and cloud metadata. No NDVI
  or agronomic inference from color. Provider failures preserve the field outline.
- Run `pnpm check`; inspect the five viewport sizes and keyboard/reduced-motion
  behavior listed in the design contract. Tests live beside feature code.

References: [TanStack cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation),
[query options](https://tanstack.com/query/latest/docs/framework/react/guides/query-options),
[Leaflet API](https://leafletjs.com/reference.html).

## Implemented boundary and next slice

The screen implements field selection, crop filtering, plot details and satellite
controls. No weather/risk simulation, evaluation action, cultivation writes,
severity/event filters, or alert timeline is implemented in this foundation.
P3 must connect its DashboardResponse endpoint and session bootstrap through
`createLiveSource(userId, farmId, getAccessToken)`. The bootstrap must clear the
QueryClient on sign-out or identity change. The current app has no sign-in UI.

Shared Zod schemas validate response shapes, primitive limits and selected
cross-field constraints. They are not a complete seed/publication validator:
P3 still owns polygon topology, containment, sibling overlap, exact forecast
coverage, snapshot consistency and other cross-row invariants in the domain model.
SatellitePreview is separate from DashboardResponse.basemap and adds no DB table.

The map and demo fixture are separate Vite chunks. No provider requests or real
account data are used by the offline demo. Biome excludes nested `.worktrees`
so another checkout cannot introduce a conflicting root configuration.
