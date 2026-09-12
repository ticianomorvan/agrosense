import {
  type Polygon,
  polygonSchema,
  type SatellitePreview,
  type SatelliteRequest,
  satelliteBoundsSchema,
  satellitePreviewSchema,
  satelliteRequestSchema,
} from "@agrosense/contracts";
import { decode, hasPngSignature } from "fast-png";

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

async function boundedBody(response: Response, maxBytes: number) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Provider response failed");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("Provider response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
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
  const ring = polygonSchema.parse(boundary).coordinates[0];
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
      const response = await fetcher(url, {
        ...init,
        // workerd supports manual/follow; boundedBody rejects every 3xx.
        // Never follow a redirect carrying credentials or a bearer token.
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      return { response, bytes: await boundedBody(response, maxBytes) };
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
    const scenes = data.features
      .map((f) => {
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
      })
      .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
    const scene = scenes[0];
    if (!scene)
      return unavailable(
        "no_scenes",
        "No Sentinel-2 acquisitions were found in this date window.",
      );
    const sw = mercator([bounds[0], bounds[1]]),
      ne = mercator([bounds[2], bounds[3]]);
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
