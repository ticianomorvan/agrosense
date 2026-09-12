import {
  type Polygon,
  type SatellitePreview,
  type SatelliteRequest,
  satelliteBoundsSchema,
  satellitePreviewSchema,
  satelliteRequestSchema,
} from "@agrosense/contracts";
import { decode, hasPngSignature } from "fast-png";
import { boundedFetch } from "../lib/http";

export type SatelliteBindings = {
  COPERNICUS_CLIENT_ID?: string;
  COPERNICUS_CLIENT_SECRET?: string;
};
const origin = "https://sh.dataspace.copernicus.eu";
const tokenUrl =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const unavailable = (
  reason: "not_configured" | "no_scenes" | "no_coverage",
  message: string,
): SatellitePreview => ({ status: "unavailable", reason, message });

// B04/B03/B02 at the provider's documented true-color gain. Alpha is the data mask.
const evalscript = `//VERSION=3
function setup() { return { input: ["B02", "B03", "B04", "dataMask"], output: { bands: 4 } }; }
function evaluatePixel(s) { return [2.5*s.B04, 2.5*s.B03, 2.5*s.B02, s.dataMask]; }`;
const cloudStatisticsEvalscript = `//VERSION=3
function setup() { return { input: ["SCL", "dataMask"], output: [{ id: "cloud", bands: 1, sampleType: "FLOAT32" }, { id: "dataMask", bands: 1 }] }; }
function evaluatePixel(s) { return { cloud: [[3, 7, 8, 9, 10].includes(s.SCL) ? 1 : 0], dataMask: [s.dataMask] }; }`;

type Scene = { id: string; time: number; cloud: number | null };
type CloudInterval = { from: number; to: number; fraction: number };

function mercator([lng, lat]: readonly [number, number]): [number, number] {
  return [
    (6378137 * lng * Math.PI) / 180,
    6378137 * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  ];
}
function base64(bytes: Uint8Array) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}

export async function loadSatellitePreview(
  env: SatelliteBindings,
  boundary: Polygon,
  window: SatelliteRequest,
  fetcher: typeof fetch = fetch,
): Promise<SatellitePreview> {
  satelliteRequestSchema.parse(window);
  if (Date.parse(window.to) > Date.now())
    throw new Error("Satellite window cannot end in the future");
  // The route has already validated polygon topology before calling the provider.
  const ring = boundary.coordinates[0];
  if (!ring) throw new Error("Farm boundary is unavailable");
  const bounds = satelliteBoundsSchema.parse([
    Math.min(...ring.map((p) => p[0])),
    Math.min(...ring.map((p) => p[1])),
    Math.max(...ring.map((p) => p[0])),
    Math.max(...ring.map((p) => p[1])),
  ]);
  if (!env.COPERNICUS_CLIENT_ID || !env.COPERNICUS_CLIENT_SECRET)
    return unavailable(
      "not_configured",
      "Sentinel-2 imagery is not configured for this workspace.",
    );
  try {
    const request = async (
      url: string,
      init: RequestInit,
      maxBytes = 1_048_576,
    ) => {
      const response = await boundedFetch(url, init, {
        fetcher,
        timeoutMs: 8000,
        maxBytes,
      });
      if (!response.ok || !response.body)
        throw new Error("Provider response failed");
      return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
    };
    const auth = await request(tokenUrl, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.COPERNICUS_CLIENT_ID,
        client_secret: env.COPERNICUS_CLIENT_SECRET,
      }),
    });
    const token: unknown = JSON.parse(new TextDecoder().decode(auth.bytes));
    if (
      !token ||
      typeof token !== "object" ||
      !("access_token" in token) ||
      typeof token.access_token !== "string"
    )
      throw new Error("Invalid token response");
    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    };
    const catalog = await request(`${origin}/catalog/v1/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        collections: ["sentinel-2-l2a"],
        intersects: boundary,
        datetime: `${window.from}/${window.to}`,
        limit: 100,
      }),
    });
    const data = JSON.parse(new TextDecoder().decode(catalog.bytes)) as {
      features?: { id?: unknown; properties?: Record<string, unknown> }[];
      context?: { next?: unknown };
      links?: { rel?: string }[];
    };
    if (
      !Array.isArray(data.features) ||
      data.features.length > 100 ||
      data.context?.next != null ||
      data.links?.some((l) => l.rel === "next")
    )
      throw new Error("Incomplete catalog");
    const scenes: Scene[] = data.features.map((f) => {
      if (
        typeof f.id !== "string" ||
        typeof f.properties?.datetime !== "string"
      )
        throw new Error("Invalid scene");
      const time = Date.parse(f.properties.datetime);
      if (
        !Number.isFinite(time) ||
        time < Date.parse(window.from) ||
        time > Date.parse(window.to)
      )
        throw new Error("Invalid acquisition");
      const cloud = f.properties["eo:cloud_cover"];
      if (
        cloud != null &&
        (typeof cloud !== "number" ||
          !Number.isFinite(cloud) ||
          cloud < 0 ||
          cloud > 100)
      )
        throw new Error("Invalid cloud metadata");
      return {
        id: f.id,
        time,
        cloud: cloud == null ? null : (cloud as number),
      };
    });
    if (scenes.length === 0)
      return unavailable(
        "no_scenes",
        "No Sentinel-2 acquisitions were found in this date window.",
      );
    const sw = mercator([bounds[0], bounds[1]]),
      ne = mercator([bounds[2], bounds[3]]);
    let cloudIntervals: CloudInterval[] = [];
    if (scenes.length > 1) {
      try {
        const statistics = await request(`${origin}/statistics/v1`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            input: {
              bounds: {
                properties: {
                  crs: "http://www.opengis.net/def/crs/EPSG/0/3857",
                },
                bbox: [...sw, ...ne],
                geometry: {
                  type: "Polygon",
                  coordinates: [ring.map(mercator)],
                },
              },
              data: [
                {
                  type: "sentinel-2-l2a",
                  dataFilter: { mosaickingOrder: "mostRecent" },
                },
              ],
            },
            aggregation: {
              timeRange: window,
              aggregationInterval: {
                of: "P1D",
                lastIntervalBehavior: "SHORTEN",
              },
              width: 128,
              height: 128,
              evalscript: cloudStatisticsEvalscript,
            },
          }),
        });
        cloudIntervals = parseCloudIntervals(statistics.bytes, window);
      } catch {
        // Scene cloud metadata remains a bounded fallback if local statistics fail.
      }
    }
    const scene = scenes.sort((a, b) => compareScenes(a, b, cloudIntervals))[0];
    if (!scene) throw new Error("Missing scene");
    const ratio = (ne[0] - sw[0]) / (ne[1] - sw[1]);
    const width = ratio >= 1 ? 1024 : Math.max(1, Math.round(1024 * ratio));
    const height = ratio <= 1 ? 1024 : Math.max(1, Math.round(1024 / ratio));
    const acquiredAt = new Date(scene.time).toISOString();
    const rendered = await request(
      `${origin}/process/v1`,
      {
        method: "POST",
        headers: { ...headers, Accept: "image/png" },
        body: JSON.stringify({
          input: {
            bounds: {
              properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/3857" },
              bbox: [...sw, ...ne],
              geometry: { type: "Polygon", coordinates: [ring.map(mercator)] },
            },
            data: [
              {
                type: "sentinel-2-l2a",
                dataFilter: {
                  timeRange: {
                    from: acquiredAt,
                    to: new Date(scene.time + 1000).toISOString(),
                  },
                },
              },
            ],
          },
          output: {
            width,
            height,
            responses: [
              { identifier: "default", format: { type: "image/png" } },
            ],
          },
          evalscript,
        }),
      },
      6_000_000,
    );
    const bytes = rendered.bytes;
    if (
      !rendered.response.headers.get("content-type")?.startsWith("image/png") ||
      !hasPngSignature(bytes) ||
      bytes.length < 24
    )
      throw new Error("Invalid image");
    const header = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    if (header.getUint32(16) > 1024 || header.getUint32(20) > 1024)
      throw new Error("Unexpected image dimensions");
    const png = decode(bytes, { checkCrc: true });
    if (png.channels !== 4 || png.depth !== 8)
      throw new Error("Missing image data mask");
    if (!png.data.some((v, i) => i % 4 === 3 && v > 0))
      return unavailable(
        "no_coverage",
        "This acquisition has no valid pixels within the farm boundary.",
      );
    return satellitePreviewSchema.parse({
      status: "available",
      source: "Sentinel-2 L2A",
      sceneId: scene.id,
      acquiredAt,
      cloudCoverPercent: scene.cloud,
      bounds,
      imageBase64: base64(bytes),
      sourceResolutionM: 10,
      attribution: `Contains modified Copernicus Sentinel data ${new Date(scene.time).getUTCFullYear()}, processed with Sentinel Hub.`,
    });
  } catch {
    throw new Error("Satellite imagery is temporarily unavailable");
  }
}

function compareScenes(a: Scene, b: Scene, intervals: CloudInterval[]) {
  const localA = localCloudFraction(a.time, intervals);
  const localB = localCloudFraction(b.time, intervals);
  if (localA !== null || localB !== null) {
    if (localA === null) return 1;
    if (localB === null) return -1;
    if (localA !== localB) return localA - localB;
  }
  if (a.cloud !== null || b.cloud !== null) {
    if (a.cloud === null) return 1;
    if (b.cloud === null) return -1;
    if (a.cloud !== b.cloud) return a.cloud - b.cloud;
  }
  return b.time - a.time || a.id.localeCompare(b.id);
}

function localCloudFraction(time: number, intervals: CloudInterval[]) {
  return (
    intervals.find(({ from, to }) => time >= from && time < to)?.fraction ??
    null
  );
}

function parseCloudIntervals(
  bytes: Uint8Array,
  window: SatelliteRequest,
): CloudInterval[] {
  const response = JSON.parse(new TextDecoder().decode(bytes)) as {
    status?: unknown;
    data?: {
      interval?: { from?: unknown; to?: unknown };
      outputs?: {
        cloud?: {
          bands?: { B0?: { stats?: { mean?: unknown } } };
        };
      };
    }[];
  };
  if (
    response.status !== "OK" ||
    !Array.isArray(response.data) ||
    response.data.length > 32
  )
    throw new Error("Invalid cloud statistics");
  const windowFrom = Date.parse(window.from);
  const windowTo = Date.parse(window.to);
  const intervals = response.data.map((item) => {
    const from =
      typeof item.interval?.from === "string"
        ? Date.parse(item.interval.from)
        : Number.NaN;
    const to =
      typeof item.interval?.to === "string"
        ? Date.parse(item.interval.to)
        : Number.NaN;
    const fraction = item.outputs?.cloud?.bands?.B0?.stats?.mean;
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from < windowFrom ||
      to > windowTo ||
      from >= to ||
      typeof fraction !== "number" ||
      !Number.isFinite(fraction) ||
      fraction < 0 ||
      fraction > 1
    )
      throw new Error("Invalid cloud statistics");
    return { from, to, fraction };
  });
  intervals.sort((a, b) => a.from - b.from);
  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    if (!previous || !current || current.from < previous.to)
      throw new Error("Invalid cloud statistics");
  }
  return intervals;
}
