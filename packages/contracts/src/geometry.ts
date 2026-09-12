import { z } from "zod";

type Position = readonly [number, number];

const positionSchema = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .readonly();

export const pointSchema = z.strictObject({
  type: z.literal("Point"),
  coordinates: positionSchema,
});

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function cross(a: Position, b: Position, c: Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

// Interpolated edge samples can be a few floating-point units off their line.
// Scale the roundoff bound to coordinate precision, not a geographic distance.
function sideOfLine(a: Position, b: Position, point: Position): number {
  const precision =
    8 *
    Number.EPSILON *
    Math.max(1, ...a.map(Math.abs), ...b.map(Math.abs), ...point.map(Math.abs));
  const error = precision * (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]));
  const value = cross(a, b, point);
  return Math.abs(value) <= error ? 0 : Math.sign(value);
}

function intersects(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
): boolean {
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  )
    return false;

  return (
    Math.sign(cross(a, b, c)) * Math.sign(cross(a, b, d)) <= 0 &&
    Math.sign(cross(c, d, a)) * Math.sign(cross(c, d, b)) <= 0
  );
}

function isSimpleRing(ring: Position[]): boolean {
  // Zod can run refinements after a length failure; keep quadratic work bounded.
  if (ring.length < 4 || ring.length > 5000) return false;
  const first = ring[0];
  const last = ring.at(-1);
  if (!first || !last || !samePosition(first, last)) return false;

  const vertices = ring.slice(0, -1);
  const unique = new Set(vertices.map(([x, y]) => `${x},${y}`));
  if (unique.size !== vertices.length) return false;

  let hasTurn = false;
  for (const [index, vertex] of vertices.entries()) {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const next = ring[index + 1];
    if (!previous || !next) return false;
    if (cross(previous, vertex, next) !== 0) {
      hasTurn = true;
    } else if (
      (previous[0] - vertex[0]) * (next[0] - vertex[0]) +
        (previous[1] - vertex[1]) * (next[1] - vertex[1]) >
      0
    ) {
      // Adjacent edges may share their endpoint, but must not double back.
      return false;
    }

    for (let other = index + 2; other < vertices.length; other++) {
      if (index === 0 && other === vertices.length - 1) continue;
      const start = ring[other];
      const end = ring[other + 1];
      if (start && end && intersects(vertex, next, start, end)) return false;
    }
  }
  return hasTurn;
}

export function pointInPolygon(
  point: Position,
  polygon: Position[][],
  includeBoundary = true,
): boolean {
  const ring = polygon[0] ?? [];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (!a || !b) continue;
    const onEdge =
      sideOfLine(a, b, point) === 0 &&
      point[0] >= Math.min(a[0], b[0]) &&
      point[0] <= Math.max(a[0], b[0]) &&
      point[1] >= Math.min(a[1], b[1]) &&
      point[1] <= Math.max(a[1], b[1]);
    if (onEdge) return includeBoundary;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

export function polygonContainsPolygon(
  container: Position[][],
  child: Position[][],
): boolean {
  const outer = container[0] ?? [];
  return edges(child[0] ?? []).every(
    ([a, b]) =>
      pointInPolygon(a, container) &&
      !edges(outer).some(([c, d]) => properIntersection(a, b, c, d)) &&
      edgeMidpoints(a, b, outer).every((point) =>
        pointInPolygon(point, container),
      ),
  );
}

function signedArea(ring: Position[]): number {
  return (
    ring.slice(0, -1).reduce((area, point, i) => {
      const next = ring[i + 1];
      return area + (next ? point[0] * next[1] - next[0] * point[1] : 0);
    }, 0) / 2
  );
}

export function polygonArea(polygon: Position[][]): number {
  return Math.abs(signedArea(polygon[0] ?? []));
}

function edges(ring: Position[]): [Position, Position][] {
  return ring.slice(0, -1).flatMap((a, i) => {
    const b = ring[i + 1];
    return b ? [[a, b] as [Position, Position]] : [];
  });
}

function properIntersection(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
) {
  return (
    sideOfLine(a, b, c) * sideOfLine(a, b, d) < 0 &&
    sideOfLine(c, d, a) * sideOfLine(c, d, b) < 0
  );
}

function parameter(a: Position, b: Position, point: Position): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  return (
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)
  );
}

// Once proper crossings are excluded, polygon membership can change only at
// boundary vertices. Sample each resulting open interval, not just the vertices.
function edgeMidpoints(a: Position, b: Position, ring: Position[]): Position[] {
  const cuts = [
    0,
    1,
    ...ring
      .filter((p) => sideOfLine(a, b, p) === 0)
      .map((p) => parameter(a, b, p))
      .filter((t) => t > 0 && t < 1),
  ].sort((x, y) => x - y);
  return cuts.slice(1).flatMap((end, i) => {
    const start = cuts[i];
    if (start === undefined || start === end) return [];
    const t = (start + end) / 2;
    return [[a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] as Position];
  });
}

/** Positive-area intersection of validated simple rings; shared edges are allowed. */
export function polygonsOverlap(a: Position[][], b: Position[][]): boolean {
  const ringA = a[0] ?? [],
    ringB = b[0] ?? [];
  const edgesA = edges(ringA),
    edgesB = edges(ringB);
  const orientation =
    Math.sign(signedArea(ringA)) * Math.sign(signedArea(ringB));
  for (const [x, y] of edgesA) {
    for (const [u, v] of edgesB) {
      if (properIntersection(x, y, u, v)) return true;
      if (sideOfLine(x, y, u) === 0 && sideOfLine(x, y, v) === 0) {
        const from = parameter(x, y, u),
          to = parameter(x, y, v);
        // Coincident edges enclose common area only when their interiors lie
        // on the same side. This also detects identical polygons of either winding.
        if (
          Math.min(1, Math.max(from, to)) > Math.max(0, Math.min(from, to)) &&
          orientation * (to - from) > 0
        )
          return true;
      }
    }
  }
  return (
    edgesA.some(([x, y]) =>
      edgeMidpoints(x, y, ringB).some((p) => pointInPolygon(p, b, false)),
    ) ||
    edgesB.some(([x, y]) =>
      edgeMidpoints(x, y, ringA).some((p) => pointInPolygon(p, a, false)),
    )
  );
}

export const polygonSchema = z.strictObject({
  type: z.literal("Polygon"),
  coordinates: z
    .array(
      z.array(positionSchema).min(4).max(5000).refine(isSimpleRing, {
        message:
          "Polygon ring must be closed, non-degenerate, and non-intersecting",
      }),
    )
    .length(1),
});

export type Point = z.infer<typeof pointSchema>;
export type Polygon = z.infer<typeof polygonSchema>;
