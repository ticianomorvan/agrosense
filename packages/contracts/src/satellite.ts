import { z } from "zod";
import { instantSchema } from "./land";

export const satelliteRequestSchema = z
  .strictObject({ from: instantSchema, to: instantSchema })
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 31 * 86_400_000,
    "Choose a window of at most 31 days",
  );
export const satelliteBoundsSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-85).max(85),
    z.number().min(-180).max(180),
    z.number().min(-85).max(85),
  ])
  .refine(
    ([w, s, e, n]) => e > w && n > s && e - w <= 0.25 && n - s <= 0.25,
    "Farm is outside the supported preview extent",
  );
export const satellitePreviewSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("available"),
    source: z.literal("Sentinel-2 L2A"),
    sceneId: z.string().min(1).max(300),
    acquiredAt: instantSchema,
    cloudCoverPercent: z.number().min(0).max(100).nullable(),
    bounds: satelliteBoundsSchema,
    imageBase64: z
      .string()
      .min(1)
      .max(8_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    attribution: z.string().min(1).max(500),
    sourceResolutionM: z.literal(10),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.enum(["not_configured", "no_scenes", "no_coverage"]),
    message: z.string().min(1).max(300),
  }),
]);
export type SatellitePreview = z.infer<typeof satellitePreviewSchema>;
export type SatelliteRequest = z.infer<typeof satelliteRequestSchema>;
