import { DEMO_V1_RULES } from "./default-rules";
import {
  type CropCycle,
  type EventKind,
  type EventSnapshot,
  type ForecastHour,
  type PlotAlert,
  plotAlertSchema,
  type RiskLevel,
  type RiskRule,
} from "./index";

export interface EvaluatePlotAlertInput {
  plot: {
    id: string;
    activeCropCycle: CropCycle | null;
  };
  event: EventSnapshot & { kind?: EventKind };
  rules?: RiskRule[];
  ruleSetVersion?: string;
  now?: string;
  alertId?: string;
  generationMethod?: "template" | "llm";
}

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

/**
 * Resolves effective rule set by merging system defaults with user-defined custom rules (RuleProvider Pattern).
 * Custom rules with an identical `code` override default rules.
 */
export function resolveRules(
  systemRules: RiskRule[] = DEMO_V1_RULES,
  customRules: RiskRule[] = [],
): RiskRule[] {
  const rulesMap = new Map<string, RiskRule>();

  for (const rule of systemRules) {
    rulesMap.set(rule.code, rule);
  }

  for (const custom of customRules) {
    rulesMap.set(custom.code, custom);
  }

  return Array.from(rulesMap.values());
}

/**
 * Checks whether an array of hourly forecasts satisfies the rule's threshold for the required consecutive hours.
 */
export function ruleFires(rule: RiskRule, hours: ForecastHour[]): boolean {
  const requiredConsecutive = rule.minimumConsecutiveHours;
  let consecutive = 0;

  for (const hour of hours) {
    let matches = true;

    if (rule.thresholdC !== null) {
      if (rule.hazardKind === "frost") {
        matches = matches && hour.temperatureC <= rule.thresholdC;
      } else if (rule.hazardKind === "extreme-heat") {
        matches = matches && hour.temperatureC >= rule.thresholdC;
      }
    }

    if (rule.windGustThresholdKmh !== null) {
      matches = matches && (hour.windGustKmh ?? 0) >= rule.windGustThresholdKmh;
    }

    if (rule.precipitationThresholdMm !== null) {
      matches =
        matches && (hour.precipitationMm ?? 0) >= rule.precipitationThresholdMm;
    }

    if (rule.hazardKind === "hail") {
      matches = matches && (hour.weatherCode === 96 || hour.weatherCode === 99);
    }

    if (matches) {
      consecutive++;
      if (consecutive >= requiredConsecutive) {
        return true;
      }
    } else {
      consecutive = 0;
    }
  }

  return false;
}

/**
 * Pure deterministic agronomic alert evaluation engine per plot and event.
 * Complies explicitly with docs/domain-model.md lines 310-344.
 */
export function evaluatePlotAlert(input: EvaluatePlotAlertInput): PlotAlert {
  const { plot, event, rules } = input;
  const ruleSetVersion = input.ruleSetVersion ?? "demo-v1";
  const generationMethod = input.generationMethod ?? "template";
  const now = input.now ?? new Date().toISOString();
  const alertId = input.alertId ?? crypto.randomUUID();
  const validUntil =
    Date.parse(event.endsAt) > Date.parse(now)
      ? event.endsAt
      : new Date(Date.parse(now) + 3_600_000).toISOString();

  const eventSnapshot: EventSnapshot = {
    id: event.id,
    status: event.status,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    evidence: event.evidence,
  };

  const createAlert = (
    assessmentState: "evaluated" | "insufficient_data" | "no_applicable_rule",
    riskLevel: RiskLevel | null,
    reason: string,
    recommendedActions: string[],
    matchedRuleCodes: string[],
  ): PlotAlert => {
    return plotAlertSchema.parse({
      id: alertId,
      plotId: plot.id,
      eventId: event.id,
      assessmentState,
      riskLevel,
      reason,
      recommendedActions,
      ruleVersion: ruleSetVersion,
      generatedAt: now,
      validUntil,
      generationMethod,
      inputSnapshot: {
        schemaVersion: 1,
        plotId: plot.id,
        cropCycle: plot.activeCropCycle,
        event: eventSnapshot,
        ruleSetVersion,
        matchedRuleCodes,
        generation: {
          method: generationMethod,
          modelId: null,
          promptVersion: null,
        },
      },
      isStale: false,
    });
  };

  // State precedence 1: Cancelled event -> no_applicable_rule
  if (event.status === "cancelled") {
    return createAlert(
      "no_applicable_rule",
      null,
      "Forecast withdrawn by newer data.",
      [],
      [],
    );
  }

  // State precedence 2: Missing active crop cycle or stage -> insufficient_data
  const cropCycle = plot.activeCropCycle;
  if (!cropCycle?.stageCode || !cropCycle.stageAsOf) {
    return createAlert(
      "insufficient_data",
      null,
      "Missing active crop cycle or phenological stage.",
      [],
      [],
    );
  }

  // Determine event hazard kind
  const hazardKind: EventKind =
    event.kind ??
    (event.evidence.detectionThresholdC === 0
      ? "frost"
      : event.evidence.detectionThresholdC === 35
        ? "extreme-heat"
        : "severe-storm");

  const effectiveRules = resolveRules(rules ?? DEMO_V1_RULES);

  // Check for rules matching the crop and stage
  const matchingCropStageRules = effectiveRules.filter(
    (r) =>
      r.hazardKind === hazardKind &&
      r.cropCode === cropCycle.cropCode &&
      r.stageCodes.some(
        (code) => code.toLowerCase() === cropCycle.stageCode?.toLowerCase(),
      ),
  );

  // State precedence 3: Stale stage date for an otherwise matching rule -> insufficient_data
  if (matchingCropStageRules.length > 0) {
    const forecastDateMs = Date.parse(
      `${event.evidence.forecastDate}T00:00:00Z`,
    );
    const stageAsOfMs = Date.parse(`${cropCycle.stageAsOf}T00:00:00Z`);

    if (stageAsOfMs > forecastDateMs) {
      return createAlert(
        "insufficient_data",
        null,
        "Declared stage date cannot follow event forecast date.",
        [],
        [],
      );
    }

    const ageDays = Math.floor(
      (forecastDateMs - stageAsOfMs) / (24 * 60 * 60 * 1000),
    );
    const maxAllowedAge = Math.max(
      ...matchingCropStageRules.map((r) => r.stageMaxAgeDays),
    );

    if (ageDays > maxAllowedAge) {
      return createAlert(
        "insufficient_data",
        null,
        `Declared stage observation is stale (${ageDays} days old; max allowed is ${maxAllowedAge} days).`,
        [],
        [],
      );
    }
  }

  // Filter eligible rules for live vs demo modes
  const eligibleRules = matchingCropStageRules.filter((r) => {
    if (!event.evidence.source.isDemo) {
      return r.reviewState === "approved" && r.evidenceUrl !== null;
    }
    return true;
  });

  // State precedence 4: No eligible rule -> no_applicable_rule
  if (eligibleRules.length === 0) {
    return createAlert(
      "no_applicable_rule",
      null,
      "No applicable agronomic rule for current crop stage.",
      [],
      [],
    );
  }

  // Evaluate meteorological thresholds against event evidence hours
  const firingRules = eligibleRules.filter((r) =>
    ruleFires(r, event.evidence.hours),
  );

  // State precedence 5: No firing rule -> no_applicable_rule
  if (firingRules.length === 0) {
    return createAlert(
      "no_applicable_rule",
      null,
      "Weather conditions did not reach agronomic rule thresholds.",
      [],
      [],
    );
  }

  // State precedence 6: Evaluated!
  // Sort firing rules: greatest risk first, then lexicographically smallest rule code for ties
  firingRules.sort((a, b) => {
    const riskDiff = RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel];
    if (riskDiff !== 0) {
      return riskDiff;
    }
    return a.code.localeCompare(b.code);
  });

  const winningRule = firingRules[0];
  if (!winningRule) {
    return createAlert(
      "no_applicable_rule",
      null,
      "No applicable agronomic rule found.",
      [],
      [],
    );
  }

  const matchedRuleCodes = firingRules
    .map((r) => r.code)
    .sort((a, b) => a.localeCompare(b));

  const reason = winningRule.reasonTemplate.replace(
    /\{code\}/g,
    winningRule.code,
  );
  const recommendedActions = winningRule.recommendedActionTemplates;

  return createAlert(
    "evaluated",
    winningRule.riskLevel,
    reason,
    recommendedActions,
    matchedRuleCodes,
  );
}
