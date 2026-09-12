import type { Point, Polygon } from "@agrosense/contracts";

export type CoordinateBounds = {
  west: string;
  south: string;
  east: string;
  north: string;
};

export type RectangleResult =
  | { ok: false; message: string }
  | { ok: true; boundary: Polygon; samplePoint: Point };

export function rectangleFromBounds(bounds: CoordinateBounds): RectangleResult {
  const west = number(bounds.west);
  const south = number(bounds.south);
  const east = number(bounds.east);
  const north = number(bounds.north);
  if (west === null || south === null || east === null || north === null)
    return { ok: false, message: "Enter all four boundary coordinates." };
  if (west < -180 || east > 180 || south < -90 || north > 90)
    return {
      ok: false,
      message:
        "Longitude must be from −180 to 180 and latitude from −90 to 90.",
    };
  if (west >= east || south >= north)
    return {
      ok: false,
      message: "West must be before east, and south must be below north.",
    };
  if (east - west > 0.25 || north - south > 0.25)
    return {
      ok: false,
      message: "The boundary can span at most 0.25° in either direction.",
    };
  return {
    ok: true,
    boundary: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
    samplePoint: {
      type: "Point",
      coordinates: [(west + east) / 2, (south + north) / 2],
    },
  };
}

function number(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function boundsFromPoints(
  points: ReadonlyArray<{ lat: number; lng: number }>,
): CoordinateBounds | null {
  if (points.length < 4) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    west: Math.min(...lngs).toFixed(6),
    east: Math.max(...lngs).toFixed(6),
    south: Math.min(...lats).toFixed(6),
    north: Math.max(...lats).toFixed(6),
  };
}

export function polygonFromPoints(
  points: ReadonlyArray<{ lat: number; lng: number }>,
): Polygon | null {
  if (points.length < 3) return null;
  const ring = points.map((p) => [p.lng, p.lat] as [number, number]);
  const first = ring[0];
  if (!first) return null;
  ring.push(first);
  return {
    type: "Polygon",
    coordinates: [ring],
  };
}
