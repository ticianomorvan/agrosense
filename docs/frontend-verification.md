# Frontend foundation verification

Verified locally on 2026-09-12, on `tmorvan/frontend-foundation`.

## Automated checks

`WRANGLER_LOG_PATH=/tmp/agrosense-frontend-wrangler.log pnpm check` passes:
20 API tests, 8 frontend/data tests, 4 database tests; TypeScript, Biome and both
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

## Integration limits

- The initial screen offers an explicitly selected synthetic demo. It does not
  represent an authenticated producer session or a live dashboard.
- Copernicus secrets are not configured locally; live Catalog/Process requests
  were not performed. Provider behavior is covered with bounded mocked responses.
- Shared dashboard schemas are shape guards; trusted import/publication validation
  remains a backend responsibility as documented in `frontend-foundation.md`.
- No weather/risk engine, cultivation mutation, notification, or live session
  bootstrap was added. See `frontend-foundation.md` and `sentinel-2.md` for handoff.
