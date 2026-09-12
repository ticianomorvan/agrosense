import { z } from "zod";
import { eventKindSchema } from "./agronomic";
import { demoEconomicImpactSchema } from "./economic-impact";
import { pointSchema } from "./geometry";
import { cropCycleSchema, farmSchema, plotSchema } from "./land";
import { compareInstants, instantSchema } from "./time";

export const localDateSchema = z.iso.date();
export const sourceSchema = z
  .strictObject({
    code: z.enum(["demo", "open_meteo"]),
    url: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable(),
    issuedAt: instantSchema.nullable(),
    retrievedAt: instantSchema,
    isDemo: z.boolean(),
  })
  .refine(
    (source) => source.isDemo === (source.code === "demo"),
    "Source mode must match its code",
  )
  .refine(
    (source) =>
      source.issuedAt === null ||
      compareInstants(source.issuedAt, source.retrievedAt) <= 0,
    "Issuance cannot follow retrieval",
  );

export type { EventKind } from "./agronomic";
export { eventKindSchema };

export const forecastHourSchema = z.strictObject({
  at: instantSchema.refine(
    (at) => /:00:00(?:\.0+)?Z$/.test(at),
    "Forecast timestamps must start on a UTC hour",
  ),
  temperatureC: z.number().min(-100).max(70),
  windGustKmh: z.number().min(0).max(300).nullable(),
  precipitationMm: z.number().min(0).max(500).nullable(),
  precipitationProbability: z.number().int().min(0).max(100).nullable(),
  weatherCode: z.number().int().min(0).max(99).nullable(),
});
export type ForecastHour = z.infer<typeof forecastHourSchema>;

export const forecastHoursSchema = z
  .array(forecastHourSchema)
  .min(1)
  .max(168)
  .refine(
    (hours) =>
      hours.every((hour, index) => {
        const previous = hours[index - 1];
        return (
          !previous ||
          Date.parse(hour.at) - Date.parse(previous.at) === 3_600_000
        );
      }),
    "Forecast hours must be chronological and exactly one hour apart",
  );

export const plotForecastSchema = z.strictObject({
  plotId: z.uuid(),
  samplePoint: pointSchema,
  source: sourceSchema,
  temperatureHeightM: z.literal(2),
  hours: forecastHoursSchema,
});
export type PlotForecast = z.infer<typeof plotForecastSchema>;

export const forecastSummarySchema = z.strictObject({
  schemaVersion: z.literal(1),
  fetchedAt: instantSchema,
  windowStart: instantSchema,
  windowEnd: instantSchema,
  plots: z.array(plotForecastSchema).min(1).max(10),
});
export const eventEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    scope: z.enum(["farm_demo", "plot_forecast"]),
    plotIds: z
      .array(z.uuid())
      .min(1)
      .max(10)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Plot IDs must be unique",
      ),
    forecastDate: localDateSchema,
    samplePoint: pointSchema.nullable(),
    source: sourceSchema,
    temperatureHeightM: z.literal(2),
    detectionThresholdC: z.union([z.literal(0), z.literal(35)]).nullable(),
    hours: forecastHoursSchema.max(24),
  })
  .refine(
    (evidence) =>
      evidence.hours.every(
        (hour) => hour.at.slice(0, 10) === evidence.forecastDate,
      ),
    "Evidence hours must belong to the forecast date",
  )
  .refine(
    (evidence) =>
      evidence.scope === "farm_demo"
        ? evidence.source.isDemo && evidence.samplePoint === null
        : !evidence.source.isDemo &&
          evidence.plotIds.length === 1 &&
          evidence.samplePoint !== null,
    "Evidence scope must match its source, plots, and sampling point",
  );
export type EventEvidence = z.infer<typeof eventEvidenceSchema>;

export const eventSnapshotSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(["active", "cancelled"]),
  startsAt: instantSchema,
  endsAt: instantSchema,
  evidence: eventEvidenceSchema,
});
export const generationSchema = z
  .strictObject({
    method: z.enum(["template", "llm"]),
    modelId: z.string().min(1).max(200).nullable(),
    promptVersion: z.string().min(1).max(100).nullable(),
  })
  .refine(
    (generation) =>
      generation.method === "template"
        ? generation.modelId === null && generation.promptVersion === null
        : generation.modelId !== null && generation.promptVersion !== null,
    "Inconsistent generation metadata",
  );
export const inputSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  plotId: z.uuid(),
  cropCycle: cropCycleSchema.nullable(),
  event: eventSnapshotSchema,
  ruleSetVersion: z.string().min(1).max(100),
  matchedRuleCodes: z
    .array(z.string().min(1).max(100))
    .max(20)
    .refine(
      (codes) => new Set(codes).size === codes.length,
      "Matched rule codes must be unique",
    ),
  generation: generationSchema,
  lossEstimate: demoEconomicImpactSchema.nullable().optional(),
});
export const plotAlertSchema = z
  .strictObject({
    id: z.uuid(),
    plotId: z.uuid(),
    eventId: z.uuid(),
    assessmentState: z.enum([
      "evaluated",
      "insufficient_data",
      "no_applicable_rule",
    ]),
    riskLevel: z.enum(["low", "moderate", "high", "critical"]).nullable(),
    reason: z.string().min(1).max(1000),
    recommendedActions: z.array(z.string().min(1).max(1000)).max(10),
    ruleVersion: z.string().min(1).max(100),
    generatedAt: instantSchema,
    validUntil: instantSchema,
    generationMethod: z.enum(["template", "llm"]),
    inputSnapshot: inputSnapshotSchema,
    lossEstimate: demoEconomicImpactSchema.nullable().optional(),
    isStale: z.boolean(),
  })
  .refine(
    (alert) =>
      alert.assessmentState === "evaluated"
        ? alert.riskLevel !== null && alert.recommendedActions.length >= 1
        : alert.riskLevel === null && alert.recommendedActions.length === 0,
    "Evaluated alerts require risk and actions; unevaluated alerts cannot claim them",
  )
  .refine(
    (alert) => compareInstants(alert.validUntil, alert.generatedAt) > 0,
    "Invalid alert validity window",
  );
export const basemapSchema = z.discriminatedUnion("status", [
  z
    .strictObject({
      status: z.literal("available"),
      tileUrlTemplate: z.url({ protocol: /^https$/ }).max(2048),
      attribution: z.string().min(1).max(500),
      minZoom: z.number().int().min(0).max(24),
      maxZoom: z.number().int().min(0).max(24),
      acquiredAt: instantSchema.nullable(),
    })
    .refine(
      (basemap) =>
        basemap.minZoom <= basemap.maxZoom &&
        ["{z}", "{x}", "{y}"].every((placeholder) =>
          basemap.tileUrlTemplate.includes(placeholder),
        ),
      "Invalid tile template",
    ),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.string().min(1).max(300),
  }),
]);
export const eventCardSchema = z.strictObject({
  id: z.uuid(),
  kind: eventKindSchema,
  title: z.string().min(1).max(160),
  startsAt: instantSchema,
  endsAt: instantSchema,
  status: z.enum(["active", "cancelled"]),
  temporalState: z.enum(["upcoming", "ongoing", "recent"]),
  source: sourceSchema,
  evidence: eventEvidenceSchema,
  alerts: z.array(plotAlertSchema).max(10),
});
export const monitoringSchema = z.strictObject({
  status: z.enum(["never_refreshed", "fresh", "stale", "failed"]),
  lastAttemptAt: instantSchema.nullable(),
  lastSuccessAt: instantSchema.nullable(),
  lastErrorCode: z
    .enum([
      "PROVIDER_TIMEOUT",
      "PROVIDER_UNAVAILABLE",
      "INVALID_PROVIDER_DATA",
      "PAYLOAD_LIMIT_EXCEEDED",
      "PUBLISH_FAILED",
    ])
    .nullable(),
  forecastValidUntil: instantSchema.nullable(),
});

export const dashboardResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  asOf: instantSchema,
  farm: farmSchema,
  plots: z.array(plotSchema).max(10),
  basemap: basemapSchema,
  forecast: forecastSummarySchema.nullable(),
  events: z.array(eventCardSchema).max(50),
  monitoring: monitoringSchema,
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

export type PlotAlert = z.infer<typeof plotAlertSchema>;
export type EventCard = z.infer<typeof eventCardSchema>;

export type Source = z.infer<typeof sourceSchema>;

export type ForecastSummary = z.infer<typeof forecastSummarySchema>;

export type EventSnapshot = z.infer<typeof eventSnapshotSchema>;

export type Generation = z.infer<typeof generationSchema>;

export type InputSnapshot = z.infer<typeof inputSnapshotSchema>;

export type Basemap = z.infer<typeof basemapSchema>;

export type Monitoring = z.infer<typeof monitoringSchema>;
