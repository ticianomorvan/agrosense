import type {
  AgronomicAlert,
  AgronomicRule,
  EventKind,
  HourlyWeatherData,
  PlotContext,
  SeverityLevel,
} from "./agronomic";
import { DEFAULT_AGRONOMIC_RULES } from "./default-rules";

export interface EngineOptions {
  customRules?: AgronomicRule[];
  source?: string;
  now?: string;
}

const SEVERITY_WEIGHT: Record<SeverityLevel, number> = {
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

/**
 * Normalizes common agronomic stage codes (e.g., V3, VT, R4) into macro phenological stages.
 */
export function normalizePhenologicalStage(stage: string): string[] {
  const clean = stage.trim().toLowerCase();
  const stages: Set<string> = new Set([clean, stage.trim()]);

  if (clean === "ve" || clean === "emergencia" || clean === "emergence") {
    stages.add("emergence");
  } else if (
    /^v\d+$/.test(clean) ||
    clean === "vegetativo" ||
    clean === "vegetative"
  ) {
    stages.add("vegetative");
  } else if (
    clean === "vt" ||
    clean === "r1" ||
    clean === "r2" ||
    clean === "floracion" ||
    clean === "floración" ||
    clean === "flowering"
  ) {
    stages.add("flowering");
  } else if (
    clean === "r3" ||
    clean === "r4" ||
    clean === "r5" ||
    clean === "r6" ||
    clean === "llenado" ||
    clean === "grain_filling"
  ) {
    stages.add("grain_filling");
  } else if (clean === "r7" || clean === "r8" || clean === "madurez") {
    stages.add("maturity");
  }

  return Array.from(stages);
}

/**
 * Resolves effective rule set by merging system defaults with user-defined custom rules (RuleProvider Pattern).
 * Custom rules with an identical ID override default rules.
 */
export function resolveRules(
  systemRules: AgronomicRule[] = DEFAULT_AGRONOMIC_RULES,
  customRules: AgronomicRule[] = [],
): AgronomicRule[] {
  const rulesMap = new Map<string, AgronomicRule>();

  for (const rule of systemRules) {
    rulesMap.set(rule.id, rule);
  }

  for (const custom of customRules) {
    rulesMap.set(custom.id, custom);
  }

  return Array.from(rulesMap.values());
}

/**
 * Checks whether a single hourly weather reading satisfies a rule's meteorological thresholds.
 */
export function hourMatchesThresholds(
  hour: HourlyWeatherData,
  rule: AgronomicRule,
): boolean {
  const { thresholds } = rule;

  if (
    thresholds.minTemperatureC !== undefined &&
    hour.temperatureC > thresholds.minTemperatureC
  ) {
    return false;
  }

  if (
    thresholds.maxTemperatureC !== undefined &&
    hour.temperatureC < thresholds.maxTemperatureC
  ) {
    return false;
  }

  if (thresholds.windGustKmh !== undefined) {
    const gust = hour.windGustKmh ?? 0;
    if (gust < thresholds.windGustKmh) {
      return false;
    }
  }

  if (thresholds.precipitationMm !== undefined) {
    const rain = hour.precipitationMm ?? 0;
    if (rain < thresholds.precipitationMm) {
      return false;
    }
  }

  if (thresholds.convectiveIndex !== undefined) {
    // Evaluates WMO thunderstorm/hail codes (96, 99 = thunderstorm with hail; 89, 90 = hail showers)
    // or precipitation/convective probability
    const isWmoHail =
      hour.weatherCode === 96 ||
      hour.weatherCode === 99 ||
      hour.weatherCode === 89 ||
      hour.weatherCode === 90;
    const meetsProb =
      (hour.precipitationProbability ?? 0) >= thresholds.convectiveIndex;

    if (!isWmoHail && !meetsProb) {
      return false;
    }
  }

  return true;
}

interface QualifyingBlock {
  rule: AgronomicRule;
  hours: HourlyWeatherData[];
  start: string;
  end: string;
}

function findQualifyingBlocks(
  weatherHours: HourlyWeatherData[],
  rule: AgronomicRule,
): QualifyingBlock[] {
  const minConsecutive = rule.thresholds.minimumConsecutiveHours || 1;
  const blocks: QualifyingBlock[] = [];
  let currentRun: HourlyWeatherData[] = [];

  for (const hour of weatherHours) {
    if (hourMatchesThresholds(hour, rule)) {
      currentRun.push(hour);
    } else {
      if (currentRun.length >= minConsecutive) {
        const block = buildBlock(currentRun, rule);
        if (block) blocks.push(block);
      }
      currentRun = [];
    }
  }

  if (currentRun.length >= minConsecutive) {
    const block = buildBlock(currentRun, rule);
    if (block) blocks.push(block);
  }

  return blocks;
}

function buildBlock(
  hours: HourlyWeatherData[],
  rule: AgronomicRule,
): QualifyingBlock | null {
  const firstHour = hours[0];
  const lastHour = hours[hours.length - 1];

  if (!firstHour || !lastHour) {
    return null;
  }

  const start = firstHour.timestamp;
  // validUntil extends 1 hour past the start of the final qualifying interval
  const lastDate = new Date(lastHour.timestamp);
  const endDate = new Date(lastDate.getTime() + 60 * 60 * 1000);

  return {
    rule,
    hours,
    start,
    end: endDate.toISOString(),
  };
}

/**
 * Generates a stable deterministic identifier for the generated alert.
 */
function generateDeterministicAlertId(
  plotId: string,
  event: EventKind,
  validFrom: string,
): string {
  const base = `${plotId}:${event}:${validFrom}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    const char = base.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `alert-${hex}-${event}`;
}

/**
 * Pure deterministic agronomic alert calculation engine per plot.
 */
export function evaluateAgronomicAlerts(
  plot: PlotContext,
  weatherData: HourlyWeatherData[],
  options: EngineOptions = {},
): AgronomicAlert[] {
  if (!weatherData || weatherData.length === 0) {
    return [];
  }

  // Sort weather chronologically
  const sortedWeather = [...weatherData].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const activeRules = resolveRules(
    DEFAULT_AGRONOMIC_RULES,
    options.customRules ?? [],
  );

  // Normalize stages for flexible matching
  const candidateStages = normalizePhenologicalStage(plot.phenologicalStage);

  // Filter rules matching the plot's crop and phenological stage
  const applicableRules = activeRules.filter(
    (rule) =>
      rule.crop === plot.crop &&
      candidateStages.includes(rule.phenologicalStage.toLowerCase()),
  );

  if (applicableRules.length === 0) {
    return [];
  }

  // Scan all blocks triggering rules
  const rawBlocks: QualifyingBlock[] = [];
  for (const rule of applicableRules) {
    const blocks = findQualifyingBlocks(sortedWeather, rule);
    rawBlocks.push(...blocks);
  }

  if (rawBlocks.length === 0) {
    return [];
  }

  // Deduplicate alerts by event type and overlapping temporal windows
  const deduplicatedAlerts: AgronomicAlert[] = [];
  const source = options.source ?? "agronomic-engine";

  // Group by hazard event kind
  const byEvent = new Map<EventKind, QualifyingBlock[]>();
  for (const block of rawBlocks) {
    const existing = byEvent.get(block.rule.event) ?? [];
    existing.push(block);
    byEvent.set(block.rule.event, existing);
  }

  for (const [event, blocks] of byEvent.entries()) {
    // Sort multiple blocks for the same event by descending severity
    blocks.sort(
      (a, b) =>
        SEVERITY_WEIGHT[b.rule.severity] - SEVERITY_WEIGHT[a.rule.severity],
    );

    // Take the highest risk block for this hazard window
    const winningBlock = blocks[0];
    if (!winningBlock) {
      continue;
    }
    const winningRule = winningBlock.rule;

    // Compute adjusted confidence
    let confidence = winningRule.baseConfidence;
    const avgProb =
      winningBlock.hours.reduce(
        (acc, h) => acc + (h.precipitationProbability ?? 80),
        0,
      ) / winningBlock.hours.length;
    if (event === "severe-storm" || event === "hail") {
      confidence = Math.min(1.0, (confidence + avgProb / 100) / 2);
    }

    // Combine recommended actions across matching rules without duplicates
    const actionSet = new Set<string>();
    for (const b of blocks) {
      for (const action of b.rule.recommendedActions) {
        actionSet.add(action);
      }
    }

    const title =
      winningRule.titleTemplate ??
      `${event.toUpperCase()} alert in plot (${winningRule.severity})`;
    const description =
      winningRule.descriptionTemplate ??
      `Detected ${event} conditions exceeding agronomic thresholds for ${plot.crop}.`;

    const alertId = generateDeterministicAlertId(
      plot.plotId,
      event,
      winningBlock.start,
    );

    deduplicatedAlerts.push({
      id: alertId,
      plotId: plot.plotId,
      farmId: plot.farmId,
      crop: plot.crop,
      phenologicalStage: plot.phenologicalStage,
      event,
      severity: winningRule.severity,
      title,
      description,
      recommendedActions: Array.from(actionSet),
      confidence: Math.round(confidence * 100) / 100,
      validFrom: winningBlock.start,
      validUntil: winningBlock.end,
      source,
      matchedRuleId: winningRule.id,
    });
  }

  return deduplicatedAlerts;
}
