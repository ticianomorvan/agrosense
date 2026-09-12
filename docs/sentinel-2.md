# Sentinel-2 farm imagery

## First slice

Render Sentinel-2 Level-2A true color (B04/B03/B02) as a georeferenced raster
under the existing farm/plot outlines. This is observation context, not a risk
assessment. Keep it independent of P1 weather, P2 rules and weather refresh.
No NDVI, crop-health labels, boundary detection, or extra persistence tables.

Use Copernicus Data Space's Sentinel Hub Catalog and Process APIs, called only
by the Worker. Configure `COPERNICUS_CLIENT_ID` and `COPERNICUS_CLIENT_SECRET`
as server secrets. The browser never receives credentials or provider URLs.
The account's entitlement/quota still needs a real integration check.

## Contract

`POST /api/farms/:farmId/satellite` accepts exactly `{from, to}` (UTC instants).
Require a verified Supabase bearer identity, UUID farm ID, and owner-scoped
farm lookup using the existing RLS client before contacting Copernicus. Accept
at most 31 days, no future endpoint, and no caller-supplied geometry/evalscript/URL.
Use the stored farm bounds; reject spans above 0.25 degrees in either direction.
This is a bounded MVP preview, not a regional tile server.

Search `sentinel-2-l2a` within the requested window, newest first locally after
collecting a bounded result set. Refuse truncated searches instead of claiming
the latest acquisition. Return `no_scenes` when none intersect. Select the latest
acquisition; no arbitrary cloud threshold silently chooses a different day.
Render only its acquisition interval, transparently masking absent pixels.
Report scene cloud cover as scene-wide metadata, never plot cloud coverage.

Success returns a validated `SatellitePreview` with acquisition instant, scene ID,
cloud percentage (nullable), WGS84 bounds, source/attribution, and a base64 PNG.
The PNG is rendered in Web Mercator so Leaflet can place it accurately. It is
bounded to 1024×1024 output pixels; source bands have nominal 10 m resolution,
while display pixels may be resampled. Imagery can still contain clouds/shadows.
An all-no-data raster must be an explicit `no_coverage` state, not success.

No credentials → `unavailable/not_configured`; empty catalog → `no_scenes`;
no covered pixels → `no_coverage`; provider/timeout/invalid response → recoverable
503. No errors expose upstream response bodies. Private, no-store responses.
Apply an 8s deadline per provider request and a bounded total response size.
No automatic retries of the processing POST. Production rate limiting and shared
server caching are required before expanding beyond this authenticated MVP.

## UI and integration

The map uses true-color imagery only when this explicit request succeeds. Keep
field outlines and keyboard-accessible list usable without imagery. A visible
legend explains boundaries, selected field, true color and missing pixels; show
acquisition/source/cloud metadata and a retry after errors. Clear old imagery
when farm/date changes. Keep the imagery acquisition separate from forecast time.
Offline demos label synthetic geometry and unavailable imagery honestly.

P3 connects the session and stored farm to this route. P4's data-source boundary
accepts an in-memory token getter; it neither stores bearer tokens nor invents
a sign-in flow. The default local fixture has no authenticated farm association.

## Verification

Test input/date/bounds validation, absent credentials, empty/truncated catalogs,
timeout/HTTP failure, attribution, PNG validation, and auth/ownership rejection.
Check map/list selection without imagery and preview georeferencing in a browser.
Real provider validation requires configured credentials and an accessible farm.

## Official references

- [Catalog API examples](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Catalog/Examples.html)
- [True-color processing and data masks](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Process/Examples/S2L2A.html)
- [Authentication](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html)
- [2026 endpoint update](https://dataspace.copernicus.eu/news/2026-3-9-api-path-structure-updates-sentinel-hub-services)

Use the documented current paths `/catalog/v1/search` and `/process/v1`.
