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

export const polygonSchema = z.object({
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
