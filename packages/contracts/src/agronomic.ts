import { z } from "zod";

export const eventKindSchema = z.enum([
  "frost",
  "severe-storm",
  "hail",
  "extreme-heat",
]);
export type EventKind = z.infer<typeof eventKindSchema>;

export const severityLevelSchema = z.enum([
  "low",
  "moderate",
  "high",
  "critical",
]);
export type SeverityLevel = z.infer<typeof severityLevelSchema>;

export const cropCodeSchema = z.enum(["maize", "soybean"]);
export type CropCode = z.infer<typeof cropCodeSchema>;

export const phenologicalStageSchema = z.enum([
  "emergence",
  "vegetative",
  "flowering",
  "grain_filling",
  "maturity",
]);
export type PhenologicalStage = z.infer<typeof phenologicalStageSchema>;

export const agronomicThresholdsSchema = z.object({
  minTemperatureC: z.number().optional(),
  maxTemperatureC: z.number().optional(),
  windGustKmh: z.number().optional(),
  precipitationMm: z.number().optional(),
  convectiveIndex: z.number().optional(),
  minimumConsecutiveHours: z.number().int().min(1).optional(),
});
export type AgronomicThresholds = z.infer<typeof agronomicThresholdsSchema>;

export const agronomicRuleSchema = z.object({
  id: z.string(),
  crop: cropCodeSchema,
  phenologicalStage: z.string(),
  event: eventKindSchema,
  thresholds: agronomicThresholdsSchema,
  severity: severityLevelSchema,
  titleTemplate: z.string().optional(),
  descriptionTemplate: z.string().optional(),
  recommendedActions: z.array(z.string()).min(1),
  baseConfidence: z.number().min(0).max(1).default(0.85),
});
export type AgronomicRule = z.infer<typeof agronomicRuleSchema>;

export const hourlyWeatherSchema = z.object({
  timestamp: z.string(),
  temperatureC: z.number(),
  windGustKmh: z.number().optional(),
  precipitationMm: z.number().optional(),
  weatherCode: z.number().optional(),
  precipitationProbability: z.number().min(0).max(100).optional(),
});
export type HourlyWeatherData = z.infer<typeof hourlyWeatherSchema>;

export const plotContextSchema = z.object({
  plotId: z.string(),
  farmId: z.string().optional(),
  crop: cropCodeSchema,
  phenologicalStage: z.string(),
  stageAsOf: z.string().optional(),
});
export type PlotContext = z.infer<typeof plotContextSchema>;

export const agronomicAlertSchema = z.object({
  id: z.string(),
  plotId: z.string(),
  farmId: z.string().optional(),
  crop: cropCodeSchema,
  phenologicalStage: z.string(),
  event: eventKindSchema,
  severity: severityLevelSchema,
  title: z.string(),
  description: z.string(),
  recommendedActions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  validFrom: z.string(),
  validUntil: z.string(),
  source: z.string(),
  matchedRuleId: z.string(),
});
export type AgronomicAlert = z.infer<typeof agronomicAlertSchema>;
