import {
  type CropCycle,
  compareInstants,
  cropCycleSchema,
  DEMO_V1_RULESET,
  type EventEvidence,
  type EventKind,
  evaluatePlotAlert,
  eventCardSchema,
  eventEvidenceSchema,
  type PlotAlert,
  type PlotForecast,
  type RuleSet,
  ruleSetSchema,
} from "@agrosense/contracts";
import type { Database } from "./database.types";
import { iso } from "./database-utils";

export type PublicationAlert = Omit<PlotAlert, "id" | "eventId" | "isStale">;
export type PublicationEvent = {
  sourceCode: "demo" | "open_meteo";
  sourceEventKey: string;
  kind: EventKind;
  title: string;
  startsAt: string;
  endsAt: string;
  issuedAt: string | null;
  retrievedAt: string;
  sourceUrl: string | null;
  isDemo: boolean;
  status: "active" | "cancelled";
  evidence: EventEvidence;
  alerts: PublicationAlert[];
};
export type PreviousEvent = Omit<PublicationEvent, "alerts">;

// SQL substitutes the upserted event ID in every snapshot before storing it.
const pendingId = "00000000-0000-4000-8000-000000000000";

export function projectPublicationCycle(
  cycle: Database["public"]["Tables"]["crop_cycles"]["Row"],
): CropCycle {
  return cropCycleSchema.parse({
    id: cycle.id,
    plotId: cycle.plot_id,
    cropCode: cycle.crop_code,
    seasonLabel: cycle.season_label,
    stageCode: cycle.stage_code,
    stageAsOf: cycle.stage_as_of,
    sownOn: cycle.sown_on,
    endedOn: cycle.ended_on,
    updatedAt: iso(cycle.updated_at),
  });
}

function eventSource(evidence: EventEvidence) {
  return {
    sourceCode: evidence.source.code,
    issuedAt: evidence.source.issuedAt,
    retrievedAt: evidence.source.retrievedAt,
    sourceUrl: evidence.source.url,
    isDemo: evidence.source.isDemo,
  };
}

function withdrawalEvidence(
  event: PreviousEvent,
  forecasts: PlotForecast[],
): EventEvidence | null {
  const relevant = event.evidence.plotIds.map((plotId) =>
    forecasts.find((forecast) => forecast.plotId === plotId),
  );
  for (const forecast of relevant) {
    const first = forecast?.hours[0];
    const last = forecast?.hours.at(-1);
    if (
      !forecast ||
      !first ||
      !last ||
      forecast.source.code !== event.sourceCode ||
      compareInstants(forecast.source.retrievedAt, event.retrievedAt) <= 0 ||
      compareInstants(first.at, event.startsAt) > 0 ||
      Date.parse(last.at) + 3_600_000 < Date.parse(event.endsAt)
    )
      return null;
  }
  const first = relevant[0];
  if (!first) return null;
  return eventEvidenceSchema.parse({
    ...event.evidence,
    source: first.source,
    hours: first.hours.filter(
      (hour) => hour.at.slice(0, 10) === event.evidence.forecastDate,
    ),
  });
}

export function buildPublication(params: {
  forecasts: PlotForecast[];
  cycles: CropCycle[];
  now: string;
  ruleSet?: RuleSet;
  previousEvents?: PreviousEvent[];
  detect: (forecast: PlotForecast) => Array<{
    sourceEventKey: string;
    kind: EventKind;
    title: string;
    startsAt: string;
    endsAt: string;
    evidence: EventEvidence;
  }>;
}): PublicationEvent[] {
  const ruleSet = ruleSetSchema.parse(params.ruleSet ?? DEMO_V1_RULESET);
  const cycles = new Map(
    params.cycles.map((cycle) => [cycle.plotId, cropCycleSchema.parse(cycle)]),
  );
  const events = new Map<string, PreviousEvent>();
  for (const forecast of params.forecasts) {
    for (const detected of params.detect(forecast)) {
      const evidence = eventEvidenceSchema.parse(detected.evidence);
      const existing = events.get(detected.sourceEventKey);
      if (existing) {
        existing.evidence = eventEvidenceSchema.parse({
          ...existing.evidence,
          plotIds: [...existing.evidence.plotIds, ...evidence.plotIds],
        });
      } else {
        events.set(detected.sourceEventKey, {
          ...detected,
          ...eventSource(evidence),
          status: "active",
          evidence,
        });
      }
    }
  }
  for (const previous of params.previousEvents ?? []) {
    if (
      previous.status !== "active" ||
      compareInstants(previous.endsAt, params.now) <= 0 ||
      events.has(previous.sourceEventKey)
    )
      continue;
    const evidence = withdrawalEvidence(previous, params.forecasts);
    if (evidence)
      events.set(previous.sourceEventKey, {
        ...previous,
        ...eventSource(evidence),
        status: "cancelled",
        evidence,
      });
  }
  return [...events.values()]
    .sort((a, b) => a.sourceEventKey.localeCompare(b.sourceEventKey))
    .map((event) => {
      const alerts = event.evidence.plotIds.map((plotId) =>
        evaluatePlotAlert({
          plot: { id: plotId, activeCropCycle: cycles.get(plotId) ?? null },
          event: {
            id: pendingId,
            kind: event.kind,
            status: event.status,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            evidence: event.evidence,
          },
          rules: ruleSet.rules,
          ruleSetVersion: ruleSet.version,
          now: params.now,
          alertId: pendingId,
        }),
      );
      eventCardSchema.parse({
        id: pendingId,
        kind: event.kind,
        title: event.title,
        status: event.status,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        evidence: event.evidence,
        source: event.evidence.source,
        temporalState: "upcoming",
        alerts,
      });
      return {
        ...event,
        alerts: alerts.map((alert) => ({
          plotId: alert.plotId,
          assessmentState: alert.assessmentState,
          riskLevel: alert.riskLevel,
          reason: alert.reason,
          recommendedActions: alert.recommendedActions,
          ruleVersion: alert.ruleVersion,
          generatedAt: alert.generatedAt,
          validUntil: alert.validUntil,
          generationMethod: alert.generationMethod,
          inputSnapshot: alert.inputSnapshot,
        })),
      };
    });
}
