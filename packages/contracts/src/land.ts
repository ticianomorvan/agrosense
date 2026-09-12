import { z } from "zod";

export const instantSchema = z.iso.datetime();
const name = z.string().trim().min(1).max(100);
export const positionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export const pointSchema = z.strictObject({
  type: z.literal("Point"),
  coordinates: positionSchema,
});
export const polygonSchema = z
  .strictObject({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(positionSchema).min(4).max(5000)).length(1),
  })
  .refine(({ coordinates: [ring] }) => {
    const first = ring?.[0];
    const last = ring?.at(-1);
    return !!first && !!last && first[0] === last[0] && first[1] === last[1];
  }, "Polygon ring must be closed");
export type Polygon = z.infer<typeof polygonSchema>;

export const cropCodeSchema = z.enum(["maize", "soybean"]);
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
export type CropCode = z.infer<typeof cropCodeSchema>;
