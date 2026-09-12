import { z } from "zod";
import {
  cropCycleSchema,
  farmSchema,
  instantSchema,
  plotSchema,
  pointSchema,
} from "./land";

const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
export const sourceSchema = z
  .strictObject({
    code: z.enum(["demo", "open_meteo"]),
    url: httpsUrl.nullable(),
    issuedAt: instantSchema.nullable(),
    retrievedAt: instantSchema,
    isDemo: z.boolean(),
  })
  .refine(
    (s) =>
      s.isDemo === (s.code === "demo") &&
      (!s.issuedAt || Date.parse(s.issuedAt) <= Date.parse(s.retrievedAt)),
    "Inconsistent source metadata",
  );
const hour = z.strictObject({
  at: instantSchema,
  temperatureC: z.number().min(-100).max(70),
});
const forecast = z.strictObject({
  schemaVersion: z.literal(1),
  fetchedAt: instantSchema,
  windowStart: instantSchema,
  windowEnd: instantSchema,
  plots: z
    .array(
      z.strictObject({
        plotId: z.uuid(),
        samplePoint: pointSchema,
        source: sourceSchema,
        temperatureHeightM: z.literal(2),
        hours: z.array(hour).min(1).max(168),
      }),
    )
    .min(1)
    .max(10),
});
const evidence = z
  .strictObject({
    schemaVersion: z.literal(1),
    scope: z.enum(["farm_demo", "plot_forecast"]),
    plotIds: z.array(z.uuid()).min(1).max(10),
    forecastDate: z.iso.date(),
    samplePoint: pointSchema.nullable(),
    source: sourceSchema,
    temperatureHeightM: z.literal(2),
    detectionThresholdC: z.literal(0),
    hours: z.array(hour).min(1).max(24),
  })
  .refine(
    (e) =>
      e.scope === "farm_demo"
        ? e.source.isDemo && e.samplePoint === null
        : !e.source.isDemo && e.plotIds.length === 1 && e.samplePoint !== null,
    "Inconsistent evidence scope",
  );
const eventStatus = z.enum(["active", "cancelled"]);
const generation = z
  .strictObject({
    method: z.enum(["template", "llm"]),
    modelId: z.string().min(1).max(200).nullable(),
    promptVersion: z.string().min(1).max(100).nullable(),
  })
  .refine(
    (g) =>
      g.method === "template"
        ? g.modelId === null && g.promptVersion === null
        : g.modelId !== null && g.promptVersion !== null,
    "Inconsistent generation metadata",
  );
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
    riskLevel: z.enum(["low", "moderate", "high"]).nullable(),
    reason: z.string().min(1).max(1000),
    recommendation: z.string().min(1).max(1000).nullable(),
    ruleVersion: z.string().min(1).max(100),
    generatedAt: instantSchema,
    validUntil: instantSchema,
    generationMethod: z.enum(["template", "llm"]),
    isStale: z.boolean(),
    inputSnapshot: z.strictObject({
      schemaVersion: z.literal(1),
      plotId: z.uuid(),
      cropCycle: cropCycleSchema.nullable(),
      event: z.strictObject({
        id: z.uuid(),
        status: eventStatus,
        startsAt: instantSchema,
        endsAt: instantSchema,
        evidence,
      }),
      ruleSetVersion: z.string().min(1).max(100),
      matchedRuleCodes: z.array(z.string().min(1).max(100)).max(20),
      generation,
    }),
  })
  .refine(
    (a) =>
      a.assessmentState === "evaluated"
        ? a.riskLevel !== null && a.recommendation !== null
        : a.riskLevel === null && a.recommendation === null,
    "Unevaluated alerts cannot claim a risk or recommendation",
  )
  .refine(
    (a) => Date.parse(a.validUntil) > Date.parse(a.generatedAt),
    "Invalid alert validity window",
  );
export const eventCardSchema = z.strictObject({
  id: z.uuid(),
  kind: z.literal("frost"),
  title: z.string().min(1).max(160),
  startsAt: instantSchema,
  endsAt: instantSchema,
  status: eventStatus,
  temporalState: z.enum(["upcoming", "ongoing", "recent"]),
  source: sourceSchema,
  evidence,
  alerts: z.array(plotAlertSchema).min(1).max(10),
});
const basemap = z.union([
  z
    .strictObject({
      status: z.literal("available"),
      tileUrlTemplate: httpsUrl,
      attribution: z.string().min(1).max(500),
      minZoom: z.int().min(0).max(24),
      maxZoom: z.int().min(0).max(24),
      acquiredAt: instantSchema.nullable(),
    })
    .refine(
      (b) =>
        b.minZoom <= b.maxZoom &&
        ["{z}", "{x}", "{y}"].every((p) => b.tileUrlTemplate.includes(p)),
      "Invalid tile template",
    ),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.string().min(1).max(300),
  }),
]);
export const dashboardResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  asOf: instantSchema,
  farm: farmSchema,
  plots: z.array(plotSchema).min(1).max(10),
  basemap,
  forecast: forecast.nullable(),
  events: z.array(eventCardSchema).max(50),
  monitoring: z.strictObject({
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
  }),
});
// These are response-shape guards. Trusted seed/publication code additionally
// validates topology, ownership, exact hourly coverage and cross-row invariants.
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type PlotAlert = z.infer<typeof plotAlertSchema>;
export type EventCard = z.infer<typeof eventCardSchema>;
