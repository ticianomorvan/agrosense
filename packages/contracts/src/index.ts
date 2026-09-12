import { z } from "zod";
import { pointSchema, polygonSchema } from "./geometry";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("agrosense-api"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const sessionResponseSchema = z.object({ userId: z.uuid() });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const whatsappPhoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{6,14}$/)
  .transform((value) => value.replace(/^\+/, ""));
export const whatsappTextSchema = z.string().trim().min(1).max(4096);
export const whatsappMessageRequestSchema = z.strictObject({
  to: whatsappPhoneSchema,
  text: whatsappTextSchema,
});
export type WhatsappMessageRequest = z.infer<
  typeof whatsappMessageRequestSchema
>;

export const whatsappMessageResponseSchema = z.strictObject({
  messageId: z.string().min(1).max(1024),
  status: z.literal("accepted"),
});
export type WhatsappMessageResponse = z.infer<
  typeof whatsappMessageResponseSchema
>;

export {
  type WhatsappAgentRun,
  whatsappAgentRunSchema,
  whatsappWebhookResponseSchema,
} from "./whatsapp-agent";
export const uuidSchema = z.uuid();

export const refreshResponseSchema = z.object({
  farmId: z.uuid(),
  dataVersion: z.number().int().min(1),
  refreshedAt: z.iso.datetime({ offset: false }),
  dataMode: z.enum(["demo", "live"]),
  eventCount: z.number().int().min(0),
  alertCount: z.number().int().min(0),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

const instantSchema = z.iso.datetime({ offset: false });
const localDateSchema = z.iso.date();
const sourceSchema = z
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
      Date.parse(source.issuedAt) <= Date.parse(source.retrievedAt),
    "Issuance cannot follow retrieval",
  );

const eventKindSchema = z.enum([
  "frost",
  "severe-storm",
  "hail",
  "extreme-heat",
]);
export type EventKind = z.infer<typeof eventKindSchema>;

export const forecastHourSchema = z.strictObject({
  at: instantSchema.refine(
    (at) => Date.parse(at) % 3_600_000 === 0,
    "Forecast timestamps must start on a UTC hour",
  ),
  temperatureC: z.number().min(-100).max(70),
  windGustKmh: z.number().min(0).max(300).nullable(),
  precipitationMm: z.number().min(0).max(500).nullable(),
  precipitationProbability: z.number().int().min(0).max(100).nullable(),
  weatherCode: z.number().int().min(0).max(99).nullable(),
});
export type ForecastHour = z.infer<typeof forecastHourSchema>;

const forecastHoursSchema = z
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

export { pointSchema };
export type Point = z.infer<typeof pointSchema>;
