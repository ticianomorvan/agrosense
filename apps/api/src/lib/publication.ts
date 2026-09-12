import {
  type EventEvidence,
  type EventKind,
  eventEvidenceSchema,
  type PlotForecast,
  type RuleSet,
} from "@agrosense/contracts";
import { demoRuleSet, evaluateRisk, type RiskEvaluation } from "./risk";

export type PublicationCycle = {
  id: string;
  plotId: string;
  cropCode: "maize" | "soybean";
  stageCode: string | null;
  stageAsOf: string | null;
  sownOn: string | null;
  endedOn: string | null;
  updatedAt: string;
};

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

export type PublicationAlert = RiskEvaluation & {
  plotId: string;
  generatedAt: string;
  validUntil: string;
  generationMethod: "template";
  inputSnapshot: unknown;
};

function validUntil(evidence: EventEvidence): string {
  const retrieved = Date.parse(evidence.source.retrievedAt) + 60 * 60 * 1000;
  const issued = evidence.source.issuedAt
    ? Date.parse(evidence.source.issuedAt) + 6 * 60 * 60 * 1000
    : Number.POSITIVE_INFINITY;
  return new Date(Math.min(retrieved, issued)).toISOString();
}

export function buildPublication(params: {
  forecasts: PlotForecast[];
  cycles: PublicationCycle[];
  now: string;
  ruleSet?: RuleSet;
  detect: (forecast: PlotForecast) => Array<{
    sourceEventKey: string;
    kind: EventKind;
    title: string;
    startsAt: string;
    endsAt: string;
    evidence: EventEvidence;
  }>;
}): PublicationEvent[] {
  const ruleSet = params.ruleSet ?? demoRuleSet;
  const cycles = new Map(params.cycles.map((cycle) => [cycle.plotId, cycle]));
  const events = new Map<string, PublicationEvent>();
  for (const forecast of params.forecasts) {
    for (const detected of params.detect(forecast)) {
      const evidence = eventEvidenceSchema.parse(detected.evidence);
      const plotId = evidence.plotIds[0];
      if (!plotId) continue;
      const cycle = cycles.get(plotId) ?? null;
      const evaluation = evaluateRisk(ruleSet, evidence, cycle, detected.kind);
      const generatedAt = params.now;
      const alert = {
        ...evaluation,
        plotId,
        generatedAt,
        validUntil: validUntil(evidence),
        generationMethod: "template" as const,
        inputSnapshot: {
          schemaVersion: 1,
          plotId,
          cropCycle: cycle,
          event: {
            id: "00000000-0000-4000-8000-000000000000",
            status: "active",
            startsAt: detected.startsAt,
            endsAt: detected.endsAt,
            evidence,
          },
          ruleSetVersion: ruleSet.version,
          matchedRuleCodes: evaluation.matchedRuleCodes,
          generation: {
            method: "template",
            modelId: null,
            promptVersion: null,
          },
        },
      };
      const existing = events.get(detected.sourceEventKey);
      if (existing) {
        existing.evidence = evidence;
        existing.alerts.push(alert);
      } else {
        events.set(detected.sourceEventKey, {
          sourceCode: evidence.source.code,
          sourceEventKey: detected.sourceEventKey,
          kind: detected.kind,
          title: detected.title,
          startsAt: detected.startsAt,
          endsAt: detected.endsAt,
          issuedAt: evidence.source.issuedAt,
          retrievedAt: evidence.source.retrievedAt,
          sourceUrl: evidence.source.url,
          isDemo: evidence.source.isDemo,
          status: "active",
          evidence,
          alerts: [alert],
        });
      }
    }
  }
  return [...events.values()].sort((a, b) =>
    a.sourceEventKey.localeCompare(b.sourceEventKey),
  );
}
