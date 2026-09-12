import { z } from "zod";
import { cropCodeSchema, riskRuleSchema } from "./agronomic";
import { pointSchema, polygonSchema } from "./geometry";
import { instantSchema } from "./time";

const name = z.string().trim().min(1).max(100);

export { cropCodeSchema };
export const cropStages = {
  maize: ["V3", "V6", "VT", "R1"],
  soybean: ["V2", "R1", "R4", "R6"],
} as const;
export const cropLabels = { maize: "Maize", soybean: "Soybean" } as const;
const localDate = z.iso.date();
export const cropCycleSchema = z
  .strictObject({
    id: z.uuid(),
    plotId: z.uuid(),
    cropCode: cropCodeSchema,
    seasonLabel: z.string().regex(/^\d{4}\/\d{2}$/),
    sownOn: localDate.nullable(),
    stageCode: z.enum(["V3", "V6", "VT", "R1", "V2", "R4", "R6"]).nullable(),
    stageAsOf: localDate.nullable(),
    endedOn: localDate.nullable(),
    updatedAt: instantSchema,
  })
  .refine(
    (c) => (c.stageCode === null) === (c.stageAsOf === null),
    "Stage and observation date must be supplied together",
  )
  .refine(
    (c) =>
      c.stageCode === null ||
      (cropStages[c.cropCode] as readonly string[]).includes(c.stageCode),
    "Stage does not belong to crop",
  )
  .refine(
    (c) => !c.sownOn || !c.stageAsOf || c.stageAsOf >= c.sownOn,
    "Stage date precedes sowing",
  )
  .refine(
    (c) =>
      !c.endedOn ||
      ((!c.sownOn || c.endedOn > c.sownOn) &&
        (!c.stageAsOf || c.endedOn > c.stageAsOf)),
    "Invalid cycle end date",
  );
const area = z.number().min(0.01).max(1_000_000);
export const farmSchema = z.strictObject({
  id: z.uuid(),
  name,
  province: name,
  locality: name.nullable(),
  timezone: z.literal("America/Argentina/Cordoba"),
  dataMode: z.enum(["demo", "live"]),
  boundary: polygonSchema,
  declaredAreaHa: area,
  dataVersion: z.int().min(1).max(2147483647),
  customRules: z.array(riskRuleSchema).max(10).default([]),
});
export const plotSchema = z
  .strictObject({
    id: z.uuid(),
    name,
    boundary: polygonSchema,
    samplePoint: pointSchema,
    declaredAreaHa: area,
    activeCropCycle: cropCycleSchema.nullable(),
  })
  .refine(
    (p) =>
      !p.activeCropCycle ||
      (p.activeCropCycle.plotId === p.id && p.activeCropCycle.endedOn === null),
    "Active cycle must belong to plot and remain open",
  );
export type Farm = z.infer<typeof farmSchema>;
export type Plot = z.infer<typeof plotSchema>;
export type { CropCode } from "./agronomic";

export type CropCycle = z.infer<typeof cropCycleSchema>;

export const updateCropCycleRequestSchema = z
  .strictObject({
    expectedDataVersion: z.number().int().min(1),
    cropCode: cropCodeSchema.optional(),
    sownOn: localDate.nullable().optional(),
    stageCode: z.string().min(1).max(20).nullable().optional(),
    stageAsOf: localDate.nullable().optional(),
  })
  .refine(
    (request) =>
      Object.keys(request).some((key) => key !== "expectedDataVersion"),
    "At least one crop-cycle field is required",
  )
  .refine(
    (request) => "stageCode" in request === "stageAsOf" in request,
    "stageCode and stageAsOf must be supplied together",
  );
export type UpdateCropCycleRequest = z.infer<
  typeof updateCropCycleRequestSchema
>;

export const updateCropCycleResponseSchema = z.strictObject({
  farmId: z.uuid(),
  dataVersion: z.number().int().min(1),
  cropCycle: cropCycleSchema,
});
export type UpdateCropCycleResponse = z.infer<
  typeof updateCropCycleResponseSchema
>;
