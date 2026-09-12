import { z } from "zod";

export const eventKindSchema = z.enum([
  "frost",
  "severe-storm",
  "hail",
  "extreme-heat",
]);
export type EventKind = z.infer<typeof eventKindSchema>;

export const riskLevelSchema = z.enum(["low", "moderate", "high", "critical"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type SeverityLevel = RiskLevel;

export const assessmentStateSchema = z.enum([
  "evaluated",
  "insufficient_data",
  "no_applicable_rule",
]);
export type AssessmentState = z.infer<typeof assessmentStateSchema>;

export const cropCodeSchema = z.enum(["maize", "soybean"]);
export type CropCode = z.infer<typeof cropCodeSchema>;

export const maizeStageCodeSchema = z.enum(["V3", "V6", "VT", "R1"]);
export const soybeanStageCodeSchema = z.enum(["V2", "R1", "R4", "R6"]);
export const stageCodeSchema = z.enum([
  "V3",
  "V6",
  "VT",
  "R1",
  "V2",
  "R4",
  "R6",
]);
export type StageCode = z.infer<typeof stageCodeSchema>;

export const riskRuleSchema = z
  .strictObject({
    code: z.string().min(1).max(100),
    hazardKind: eventKindSchema,
    cropCode: cropCodeSchema,
    stageCodes: z
      .array(z.string().min(1).max(20))
      .min(1)
      .max(8)
      .refine(
        (stages) => new Set(stages).size === stages.length,
        "Stage codes must be unique",
      ),
    temperatureHeightM: z.literal(2),
    thresholdC: z.number().min(-100).max(70).nullable(),
    windGustThresholdKmh: z.number().min(0).max(300).nullable(),
    precipitationThresholdMm: z.number().min(0).max(500).nullable(),
    minimumConsecutiveHours: z.number().int().min(1).max(24),
    stageMaxAgeDays: z.number().int().min(1).max(30),
    riskLevel: riskLevelSchema,
    reviewState: z.enum(["synthetic", "approved"]),
    evidenceUrl: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable(),
    reasonTemplate: z.string().min(1).max(1000),
    recommendedActionTemplates: z
      .array(z.string().min(1).max(1000))
      .min(1)
      .max(10),
  })
  .refine(
    (rule) => rule.reviewState !== "approved" || rule.evidenceUrl !== null,
    "Approved rules require a non-null HTTPS evidenceUrl",
  );

export type RiskRule = z.infer<typeof riskRuleSchema>;
export type AgronomicRule = RiskRule;

export const ruleSetSchema = z.strictObject({
  version: z.string().min(1).max(100),
  rules: z
    .array(riskRuleSchema)
    .max(20)
    .refine(
      (rules) => new Set(rules.map((r) => r.code)).size === rules.length,
      "Rule codes must be unique within RuleSet",
    ),
});

export type RuleSet = z.infer<typeof ruleSetSchema>;
