import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("agrosense-api"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const sessionResponseSchema = z.object({ userId: z.uuid() });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const uuidSchema = z.uuid();

const instantSchema = z.iso.datetime({ offset: true });
const localDateSchema = z.iso.date();
const positionSchema = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .readonly();
const pointSchema = z.object({
  type: z.literal("Point"),
  coordinates: positionSchema,
});
const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(positionSchema)).length(1),
});
const sourceSchema = z.object({
  code: z.enum(["demo", "open_meteo"]),
  url: z.url().nullable(),
  issuedAt: instantSchema.nullable(),
  retrievedAt: instantSchema,
  isDemo: z.boolean(),
});
const forecastHourSchema = z.object({
  at: instantSchema,
  temperatureC: z.number().min(-100).max(70),
});
const plotForecastSchema = z.object({
  plotId: z.uuid(),
  samplePoint: pointSchema,
  source: sourceSchema,
  temperatureHeightM: z.literal(2),
  hours: z.array(forecastHourSchema).min(1).max(168),
});
const forecastSummarySchema = z.object({
  schemaVersion: z.literal(1),
  fetchedAt: instantSchema,
  windowStart: instantSchema,
  windowEnd: instantSchema,
  plots: z.array(plotForecastSchema).min(1).max(10),
});
const cropCycleSchema = z.object({
  id: z.uuid(),
  plotId: z.uuid(),
  cropCode: z.enum(["maize", "soybean"]),
  seasonLabel: z.string().regex(/^\d{4}\/\d{2}$/),
  sownOn: localDateSchema.nullable(),
  stageCode: z.string().nullable(),
  stageAsOf: localDateSchema.nullable(),
  endedOn: localDateSchema.nullable(),
  updatedAt: instantSchema,
});
const eventEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.enum(["farm_demo", "plot_forecast"]),
  plotIds: z.array(z.uuid()).min(1).max(10),
  forecastDate: localDateSchema,
  samplePoint: pointSchema.nullable(),
  source: sourceSchema,
  temperatureHeightM: z.literal(2),
  detectionThresholdC: z.literal(0),
  hours: z.array(forecastHourSchema).min(1).max(24),
});
const eventSnapshotSchema = z.object({
  id: z.uuid(),
  status: z.enum(["active", "cancelled"]),
  startsAt: instantSchema,
  endsAt: instantSchema,
  evidence: eventEvidenceSchema,
});
const generationSchema = z.object({
  method: z.enum(["template", "llm"]),
  modelId: z.string().nullable(),
  promptVersion: z.string().nullable(),
});
const inputSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  plotId: z.uuid(),
  cropCycle: cropCycleSchema.nullable(),
  event: eventSnapshotSchema,
  ruleSetVersion: z.string().min(1).max(100),
  matchedRuleCodes: z.array(z.string().min(1).max(100)).max(20),
  generation: generationSchema,
});
const plotAlertSchema = z.object({
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
  recommendedActions: z.array(z.string()),
  ruleVersion: z.string().min(1).max(100),
  generatedAt: instantSchema,
  validUntil: instantSchema,
  generationMethod: z.enum(["template", "llm"]),
  inputSnapshot: inputSnapshotSchema,
  isStale: z.boolean(),
});
const farmSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  province: z.string().min(1).max(100),
  locality: z.string().min(1).max(100).nullable(),
  timezone: z.literal("America/Argentina/Cordoba"),
  dataMode: z.enum(["demo", "live"]),
  boundary: polygonSchema,
  declaredAreaHa: z.number().min(0.01).max(1_000_000),
  dataVersion: z.number().int().min(1),
});
const plotSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  boundary: polygonSchema,
  samplePoint: pointSchema,
  declaredAreaHa: z.number().min(0.01).max(1_000_000),
  activeCropCycle: cropCycleSchema.nullable(),
});
const basemapSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    tileUrlTemplate: z.url(),
    attribution: z.string().min(1).max(500),
    minZoom: z.number().int().min(0).max(24),
    maxZoom: z.number().int().min(0).max(24),
    acquiredAt: instantSchema.nullable(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1).max(300),
  }),
]);
const eventCardSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["frost", "severe-storm", "hail", "extreme-heat"]),
  title: z.string().min(1).max(160),
  startsAt: instantSchema,
  endsAt: instantSchema,
  status: z.enum(["active", "cancelled"]),
  temporalState: z.enum(["upcoming", "ongoing", "recent"]),
  source: sourceSchema,
  evidence: eventEvidenceSchema,
  alerts: z.array(plotAlertSchema).max(10),
});
const monitoringSchema = z.object({
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

export const dashboardResponseSchema = z.object({
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
