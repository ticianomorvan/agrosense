import {
  type EventEvidence,
  type EventKind,
  type RiskRule,
  type RuleSet,
  ruleSetSchema,
} from "@agrosense/contracts";

type Cycle = {
  id: string;
  plotId: string;
  cropCode: "maize" | "soybean";
  stageCode: string | null;
  stageAsOf: string | null;
  sownOn: string | null;
  endedOn: string | null;
  updatedAt: string;
};

export type RiskEvaluation = {
  assessmentState: "evaluated" | "insufficient_data" | "no_applicable_rule";
  riskLevel: "low" | "moderate" | "high" | "critical" | null;
  reason: string;
  recommendedActions: string[];
  matchedRuleCodes: string[];
};

const rank = { low: 0, moderate: 1, high: 2, critical: 3 } as const;

function fires(rule: RiskRule, evidence: EventEvidence): boolean {
  let run = 0;
  for (const hour of evidence.hours) {
    const matches =
      (rule.thresholdC === null ||
        (rule.hazardKind === "frost"
          ? hour.temperatureC <= rule.thresholdC
          : hour.temperatureC >= rule.thresholdC)) &&
      (rule.windGustThresholdKmh === null ||
        (hour.windGustKmh !== null &&
          hour.windGustKmh >= rule.windGustThresholdKmh)) &&
      (rule.precipitationThresholdMm === null ||
        (hour.precipitationMm !== null &&
          hour.precipitationMm >= rule.precipitationThresholdMm)) &&
      (rule.hazardKind !== "hail" ||
        hour.weatherCode === 96 ||
        hour.weatherCode === 99);
    run = matches ? run + 1 : 0;
    if (run >= rule.minimumConsecutiveHours) return true;
  }
  return false;
}

export function evaluateRisk(
  ruleSet: RuleSet,
  evidence: EventEvidence,
  cycle: Cycle | null,
  hazardKind: EventKind,
  eventStatus: "active" | "cancelled" = "active",
): RiskEvaluation {
  const normalized = ruleSetSchema.parse(ruleSet);
  if (eventStatus === "cancelled")
    return {
      assessmentState: "no_applicable_rule",
      riskLevel: null,
      reason: "Event was cancelled.",
      recommendedActions: [],
      matchedRuleCodes: [],
    };
  const applicable = normalized.rules.filter(
    (rule) => rule.hazardKind === hazardKind,
  );
  if (!cycle?.stageCode || !cycle.stageAsOf)
    return {
      assessmentState: "insufficient_data",
      riskLevel: null,
      reason: "Crop stage data is unavailable.",
      recommendedActions: [],
      matchedRuleCodes: [],
    };
  const eventDate = evidence.forecastDate;
  const stageAsOf = cycle.stageAsOf;
  const eligible = applicable.filter(
    (rule) =>
      rule.cropCode === cycle.cropCode &&
      rule.stageCodes.includes(cycle.stageCode as never) &&
      stageAsOf <= eventDate &&
      (!cycle.sownOn ||
        Math.floor(
          (Date.parse(`${eventDate}T00:00:00Z`) -
            Date.parse(`${cycle.stageAsOf}T00:00:00Z`)) /
            86400000,
        ) <= rule.stageMaxAgeDays) &&
      fires(rule, evidence),
  );
  const matchedRuleCodes = eligible.map((r) => r.code).sort();
  if (!eligible.length)
    return {
      assessmentState: "no_applicable_rule",
      riskLevel: null,
      reason: "No applicable rule matched.",
      recommendedActions: [],
      matchedRuleCodes,
    };
  const winner = [...eligible].sort(
    (a, b) =>
      rank[b.riskLevel] - rank[a.riskLevel] || a.code.localeCompare(b.code),
  )[0];
  if (!winner) throw new Error("Risk rule selection failed");
  return {
    assessmentState: "evaluated",
    riskLevel: winner.riskLevel,
    reason: winner.reasonTemplate.replaceAll("{code}", winner.code),
    recommendedActions: winner.recommendedActionTemplates.map((a) =>
      a.replaceAll("{code}", winner.code),
    ),
    matchedRuleCodes,
  };
}

export const demoRuleSet: RuleSet = {
  version: "demo-v1",
  rules: [
    [
      "demo-maize-v3",
      "frost",
      "maize",
      ["V3"],
      -1,
      null,
      null,
      1,
      14,
      "moderate",
    ],
    ["demo-maize-v6", "frost", "maize", ["V6"], -1, null, null, 1, 14, "high"],
    [
      "demo-soybean-r4",
      "frost",
      "soybean",
      ["R4"],
      -1,
      null,
      null,
      1,
      14,
      "high",
    ],
    [
      "demo-maize-heat",
      "extreme-heat",
      "maize",
      ["VT"],
      35,
      null,
      null,
      2,
      14,
      "critical",
    ],
    [
      "demo-storm-v",
      "severe-storm",
      "maize",
      ["V6"],
      null,
      70,
      null,
      1,
      14,
      "high",
    ],
  ].map(
    ([
      code,
      hazardKind,
      cropCode,
      stageCodes,
      thresholdC,
      windGustThresholdKmh,
      precipitationThresholdMm,
      minimumConsecutiveHours,
      stageMaxAgeDays,
      riskLevel,
    ]) => ({
      code,
      hazardKind,
      cropCode,
      stageCodes,
      temperatureHeightM: 2,
      thresholdC,
      windGustThresholdKmh,
      precipitationThresholdMm,
      minimumConsecutiveHours,
      stageMaxAgeDays,
      riskLevel,
      reviewState: "synthetic",
      evidenceUrl: null,
      reasonTemplate: "Escenario sintético: la regla {code} coincide.",
      recommendedActionTemplates: [
        "Demostración: revisar el lote; no es asesoramiento agronómico.",
      ],
    }),
  ) as RiskRule[],
};
