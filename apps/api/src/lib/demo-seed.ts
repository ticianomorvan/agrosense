import {
  pointInPolygon,
  pointSchema,
  polygonArea,
  polygonContainsPolygon,
  polygonSchema,
} from "@agrosense/contracts";
import { z } from "zod";

const cycleSchema = z.strictObject({
  cropCode: z.enum(["maize", "soybean"]),
  seasonLabel: z.string().regex(/^\d{4}\/\d{2}$/),
  sownOn: z.iso.date().nullable(),
  stageCode: z.string().nullable(),
  stageAsOf: z.iso.date().nullable(),
});
export const demoSeedSchema = z.strictObject({
  farm: z.strictObject({
    name: z.string().min(1).max(100),
    province: z.string().min(1).max(100),
    locality: z.string().min(1).max(100).nullable(),
    boundary: polygonSchema,
    declaredAreaHa: z.number().positive(),
  }),
  plots: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(100),
        boundary: polygonSchema,
        samplePoint: pointSchema,
        declaredAreaHa: z.number().positive(),
        cropCycle: cycleSchema,
      }),
    )
    .min(1)
    .max(10),
});
export type DemoSeed = z.infer<typeof demoSeedSchema>;

function segments(ring: readonly (readonly [number, number])[]) {
  return ring.slice(0, -1).flatMap((a, i) => {
    const next = ring[i + 1];
    return next ? ([[a, next]] as const) : [];
  });
}
function cross(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function properIntersection(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
) {
  return (
    Math.sign(cross(a, b, c)) * Math.sign(cross(a, b, d)) < 0 &&
    Math.sign(cross(c, d, a)) * Math.sign(cross(c, d, b)) < 0
  );
}
function overlaps(
  a: readonly (readonly [number, number])[],
  b: readonly (readonly [number, number])[],
) {
  const firstA = a[0];
  const firstB = b[0];
  if (!firstA || !firstB) return false;
  return (
    segments(a).some(([x, y]) =>
      segments(b).some(([u, v]) => properIntersection(x, y, u, v)),
    ) ||
    pointInPolygon(firstA, [b as [number, number][]]) ||
    pointInPolygon(firstB, [a as [number, number][]])
  );
}

export function validateDemoSeed(input: unknown): DemoSeed {
  const seed = demoSeedSchema.parse(input);
  const farmRing = seed.farm.boundary.coordinates[0];
  if (!farmRing) throw new Error("Farm boundary is empty");
  for (const plot of seed.plots) {
    if (
      !polygonContainsPolygon(
        seed.farm.boundary.coordinates,
        plot.boundary.coordinates,
      )
    )
      throw new Error(`Plot ${plot.name} is outside the farm boundary`);
    if (
      !pointInPolygon(plot.samplePoint.coordinates, plot.boundary.coordinates)
    )
      throw new Error(`Sample point for ${plot.name} is outside its plot`);
  }
  for (let i = 0; i < seed.plots.length; i++)
    for (let j = i + 1; j < seed.plots.length; j++) {
      const a = seed.plots[i]?.boundary.coordinates[0];
      const b = seed.plots[j]?.boundary.coordinates[0];
      if (!a || !b) throw new Error("Plot boundary is empty");
      if (
        overlaps(a, b) &&
        polygonArea(a ? [a] : []) > 0 &&
        polygonArea(b ? [b] : []) > 0
      )
        throw new Error(
          `Plots ${seed.plots[i]?.name} and ${seed.plots[j]?.name} overlap`,
        );
    }
  if (
    farmRing.length +
      seed.plots.reduce(
        (n, p) => n + (p.boundary.coordinates[0]?.length ?? 0),
        0,
      ) >
    5000
  )
    throw new Error("Seed coordinate limit exceeded");
  return seed;
}
