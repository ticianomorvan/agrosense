import { z } from "zod";
import { cropCodeSchema } from "./agronomic";
import { pointSchema, polygonSchema } from "./geometry";
import { cropStages, farmSchema, plotSchema } from "./land";

const nameSchema = z.string().trim().min(1).max(100);
const localDateSchema = z.iso.date();
const stageSchema = z.enum(["V3", "V6", "VT", "R1", "V2", "R4", "R6"]);

export const authConfigResponseSchema = z.strictObject({
  url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    );
  }, "Supabase must use HTTPS outside local development"),
  publishableKey: z.string().min(1).max(500),
});
export type AuthConfigResponse = z.infer<typeof authConfigResponseSchema>;

export const farmListItemSchema = z.strictObject({
  id: z.uuid(),
  name: nameSchema,
  province: nameSchema,
  locality: nameSchema.nullable(),
  dataMode: z.enum(["demo", "live"]),
});
export const farmListResponseSchema = z.strictObject({
  farms: z.array(farmListItemSchema),
});
export type FarmListItem = z.infer<typeof farmListItemSchema>;
export type FarmListResponse = z.infer<typeof farmListResponseSchema>;

export const createFarmRequestSchema = z.strictObject({
  name: nameSchema,
  province: nameSchema,
  locality: nameSchema.nullable(),
  boundary: polygonSchema,
  declaredAreaHa: z.number().min(0.01).max(1_000_000),
});
export const createFarmResponseSchema = farmSchema;
export type CreateFarmRequest = z.infer<typeof createFarmRequestSchema>;

export const createCropCycleSchema = z
  .strictObject({
    cropCode: cropCodeSchema,
    seasonLabel: z.string().regex(/^\d{4}\/\d{2}$/),
    sownOn: localDateSchema.nullable(),
    stageCode: stageSchema.nullable(),
    stageAsOf: localDateSchema.nullable(),
  })
  .refine(
    (cycle) => (cycle.stageCode === null) === (cycle.stageAsOf === null),
    "Stage and observation date must be supplied together",
  )
  .refine(
    (cycle) =>
      cycle.stageCode === null ||
      (cropStages[cycle.cropCode] as readonly string[]).includes(
        cycle.stageCode,
      ),
    "Stage does not belong to crop",
  )
  .refine(
    (cycle) =>
      cycle.sownOn === null ||
      cycle.stageAsOf === null ||
      cycle.stageAsOf >= cycle.sownOn,
    "Stage date precedes sowing",
  );

export const createPlotRequestSchema = z.strictObject({
  name: nameSchema,
  boundary: polygonSchema,
  samplePoint: pointSchema,
  declaredAreaHa: z.number().min(0.01).max(1_000_000),
  cropCycle: createCropCycleSchema,
});
export const createPlotResponseSchema = z.strictObject({
  farmId: z.uuid(),
  dataVersion: z.number().int().min(1),
  plot: plotSchema,
});
export type CreatePlotRequest = z.infer<typeof createPlotRequestSchema>;
export type CreatePlotResponse = z.infer<typeof createPlotResponseSchema>;
