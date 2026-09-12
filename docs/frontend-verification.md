# Frontend foundation verification

Verified locally on 2026-09-12, on `tmorvan/frontend-foundation`.

## Automated checks

`WRANGLER_LOG_PATH=/tmp/agrosense-frontend-wrangler.log pnpm check` passes:
22 API tests, 8 frontend/data tests, 4 database tests; TypeScript, Biome and both
production builds pass. The log override only relocates Wrangler's local log
inside the sandbox. No deployment occurred.

Coverage includes invalid response shapes, abort propagation, retry limits,
identity-scoped query keys, crop/stage mismatch, absent weather/risk, cancelled
and stale risk, satellite date/bounds limits, empty/truncated catalogs, empty
rasters, provider error sanitization, authentication and owner-scoped lookup.

Runtime through Vite → Wrangler: `/api/health` returns 200; an unauthenticated
satellite POST returns 401. The deliberate 401 produces the expected browser
network error; normal workspace interactions produced no page errors or warnings.

## Browser evidence

Screenshots are local review artifacts under
`/Users/ticianomorvan/Projects/agrosense/.playwright-mcp/` (not committed):

| Evidence | File |
| --- | --- |
| 1440×900 desktop | `frontend-1440.png` |
| 1024×768 desktop | `frontend-1024.png` |
| 768×1024 tablet | `frontend-768.png` |
| 390×844 phone priorities | `frontend-390.png` |
| 320×568 phone priorities | `frontend-320.png` |
| 320px alternate map | `frontend-320-map.png` |
| Selected field/detail panel | `frontend-selected.png` |
| 200% root text size, long field name | `frontend-200percent.png` |
| 720px reflow (1440px at 200% browser zoom equivalent) | `frontend-zoom-reflow.png` |
| Loading/error/stale component states | `frontend-state-pending.png`, `frontend-state-error.png`, `frontend-state-stale.png` |

Inspected the five viewport screenshots. No page-wide horizontal overflow.
Desktop uses two columns and a dominant map; tablet priorities precede the map;
phone priorities lead with a button for the map. Fixed tooltip width and viewport
refitting after visual checks. The list preserves full field identifiers.

Map click and keyboard field selection open details in the existing panel.
Enter/Space activate controls; Shift+Tab reaches Back; returning to the list
restores focus to the field button with a visible outline under keyboard use.
Crop filtering agrees between map and list and survives phone view changes.
A synthetic test raster rendered and was removed after changing dates. This
checks the image overlay, not real satellite pixels or provider entitlement.

A temporary isolated component harness exercised loading, recoverable error/retry,
no-fields, stale monitoring, long names and enlarged text. It was removed after
verification. The normal demo exercises unavailable/partial crop, weather and
imagery states and the disabled imagery action. Query pending state is announced.
Reduced-motion media emulation produces 0s control transitions; map movements
are always instant. No modal/menu exists, so Escape behavior is not applicable.

Computed token contrast: text pairings range from 5.46:1 to 12.20:1; control
borders are 3.81:1 on surface and 3.21:1 on subtle. Checked visible native buttons,
inputs and selects: no targets smaller than 44×44 CSS pixels. This is not a full
WCAG audit; assistive-technology and native browser-chrome zoom tests are unverified.

## Live Copernicus verification

On 2026-09-12, used locally configured credentials against the real Copernicus
OAuth, Catalog and Process APIs. Credentials remain in the ignored server `.env`.
First called the existing provider directly, then exercised it in local workerd
through the existing `SatelliteControls` → data fetcher → `FieldMap` components.
A temporary loopback-only Worker supplied the demo boundary independently of
Supabase; the production authenticated route was not bypassed or changed.
The temporary Worker and browser harness were removed after verification.

- Boundary: `[-64.17, -31.47, -64.154, -31.456]` near Córdoba, using the
  existing synthetic farm geometry. These are not verified property boundaries.
- Requested UTC window: `2025-08-01T00:00:00Z` through `2025-08-15T23:59:59Z`.
- OAuth, Catalog and Process each returned HTTP 200. The successful Worker
  request completed in 5.57 seconds, with the existing provider deadlines.
- Selected scene:
  `S2B_MSIL2A_20250814T141709_N0511_R010_T20JLL_20250814T175523.SAFE`.
- Acquisition: `2025-08-14T14:31:25.931Z`; scene-wide cloud cover: 65.72%.
- Decoded true-color PNG: 998×1024, 140,074 bytes; all 1,021,952 pixels have
  valid alpha. Clouds are visible; valid coverage does not mean cloud-free land.
- Inspected real imagery under plot outlines at 1440px and 390px widths;
  acquisition, attribution, cloud cover and source resolution displayed correctly.
  Field selection retained the image, and changing dates removed it immediately.
  No page-wide overflow or browser errors/warnings in the final verification run.
- A separate real request for August 1–15, 2010 returned `unavailable/no_scenes`
  after OAuth and Catalog succeeded; no Process request followed.

The live Worker test found that this workerd runtime rejects `redirect: "error"`
before issuing a request. The provider now uses `manual`; its existing non-2xx
check rejects redirects without following them. Two regression tests failed before
the fix and pass after it, covering runtime compatibility and redirects at every
provider step.

Local evidence in the same `.playwright-mcp/` directory:
`copernicus-live.png`, `copernicus-live-desktop.png`, `copernicus-live-phone.png`,
and `copernicus-live-report.json`. The JSON records provider statuses, timings,
acquisition, bounds and decoded PNG statistics; it contains no credentials.

## Integration limits

- The initial screen offers an explicitly selected synthetic demo. It does not
  represent an authenticated producer session or a live dashboard.
- Real Catalog/Process requests and local Worker rendering are verified above.
  The complete Supabase session → stored farm → satellite route flow and deployed
  Cloudflare execution remain unverified; this check isolated those dependencies.
- Shared dashboard schemas are shape guards; trusted import/publication validation
  remains a backend responsibility as documented in `frontend-foundation.md`.
- No weather/risk engine, cultivation mutation, notification, or live session
  bootstrap was added. See `frontend-foundation.md` and `sentinel-2.md` for handoff.
