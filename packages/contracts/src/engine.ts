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
  modelId?: string | null;
  promptVersion?: string | null;
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
 * Validates temporal continuity (each consecutive interval must be exactly 1 hour apart).
 */
export function ruleFires(rule: RiskRule, hours: ForecastHour[]): boolean {
  const requiredConsecutive = rule.minimumConsecutiveHours;
  let consecutive = 0;

  for (let i = 0; i < hours.length; i++) {
    const hour = hours[i];
    if (!hour) continue;

    // Reset run if intervals are not contiguous 1-hour steps
    if (i > 0 && consecutive > 0) {
      const prev = hours[i - 1];
      if (prev && Date.parse(hour.at) - Date.parse(prev.at) !== 3_600_000) {
        consecutive = 0;
      }
    }

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
  const modelId =
    generationMethod === "llm" ? (input.modelId ?? "default-model") : null;
  const promptVersion =
    generationMethod === "llm" ? (input.promptVersion ?? "v1") : null;
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
          modelId,
          promptVersion,
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

  // Determine hazard kind
  const hazardKind: EventKind =
    event.kind ??
    (event.evidence.detectionThresholdC === 0
      ? "frost"
      : event.evidence.detectionThresholdC === 35
        ? "extreme-heat"
        : event.evidence.hours.some(
              (h) => h.weatherCode === 96 || h.weatherCode === 99,
            )
          ? "hail"
          : "severe-storm");

  const isDemo = event.evidence.source.isDemo;
  const effectiveRules = resolveRules(rules ?? DEMO_V1_RULES);

  // Live evaluation permits approved rules with evidence URLs only (lines 339-340)
  const candidateRules = effectiveRules.filter((r) => {
    if (!isDemo) {
      return r.reviewState === "approved" && r.evidenceUrl !== null;
    }
    return true;
  });

  if (candidateRules.length === 0) {
    return createAlert(
      "no_applicable_rule",
      null,
      isDemo
        ? "No agronomic rules configured."
        : "No approved agronomic rules with evidence URL for live event.",
      [],
      [],
    );
  }

  const hazardRules = candidateRules.filter((r) => r.hazardKind === hazardKind);
  if (hazardRules.length === 0) {
    return createAlert(
      "no_applicable_rule",
      null,
      "No applicable agronomic rule for hazard kind.",
      [],
      [],
    );
  }

  // State precedence 2: Missing crop cycle or stage for an otherwise matching rule -> insufficient_data
  const cropCycle = plot.activeCropCycle;
  if (!cropCycle?.cropCode || !cropCycle.stageCode || !cropCycle.stageAsOf) {
    return createAlert(
      "insufficient_data",
      null,
      "Missing active crop cycle or phenological stage.",
      [],
      [],
    );
  }

  // Match crop and phenological stage
  const matchingCropStageRules = hazardRules.filter(
    (r) =>
      r.cropCode === cropCycle.cropCode &&
      r.stageCodes.some(
        (code) => code.toLowerCase() === cropCycle.stageCode?.toLowerCase(),
      ),
  );

  if (matchingCropStageRules.length === 0) {
    return createAlert(
      "no_applicable_rule",
      null,
      "No applicable agronomic rule for current crop stage.",
      [],
      [],
    );
  }

  // State precedence 3: Stage date cannot follow event forecast date
  const forecastDateMs = Date.parse(`${event.evidence.forecastDate}T00:00:00Z`);
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

  // Filter rules whose individual stageMaxAgeDays is not exceeded (lines 311-313)
  const freshRules = matchingCropStageRules.filter(
    (r) => ageDays <= r.stageMaxAgeDays,
  );

  if (freshRules.length === 0) {
    const maxAllowed = Math.max(
      ...matchingCropStageRules.map((r) => r.stageMaxAgeDays),
    );
    return createAlert(
      "insufficient_data",
      null,
      `Declared stage observation is stale (${ageDays} days old; max allowed is ${maxAllowed} days).`,
      [],
      [],
    );
  }

  // Evaluate meteorological thresholds against event evidence hours
  const firingRules = freshRules.filter((r) =>
    ruleFires(r, event.evidence.hours),
  );

  // State precedence 4: No firing rule -> no_applicable_rule
  if (firingRules.length === 0) {
    return createAlert(
      "no_applicable_rule",
      null,
      "Weather conditions did not reach agronomic rule thresholds.",
      [],
      [],
    );
  }

  // State precedence 5: Evaluated!
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
