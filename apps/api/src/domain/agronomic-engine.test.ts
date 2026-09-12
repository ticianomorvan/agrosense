import {
  type CropCycle,
  DEMO_V1_RULES,
  type EventSnapshot,
  evaluatePlotAlert,
  type ForecastHour,
  generationSchema,
  plotAlertSchema,
  type RiskRule,
  resolveRules,
  riskRuleSchema,
} from "@agrosense/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T00:30:00Z"));
});

afterEach(() => vi.useRealTimers());

function createHour(
  timestamp: string,
  overrides: Partial<ForecastHour> = {},
): ForecastHour {
  return {
    at: timestamp,
    temperatureC: overrides.temperatureC ?? 15,
    windGustKmh: overrides.windGustKmh ?? null,
    precipitationMm: overrides.precipitationMm ?? null,
    precipitationProbability: overrides.precipitationProbability ?? null,
    weatherCode: overrides.weatherCode ?? null,
  };
}

function createEvent(
  kind: "frost" | "extreme-heat" | "severe-storm" | "hail",
  forecastDate: string,
  hours: ForecastHour[],
  overrides: Partial<EventSnapshot> = {},
): EventSnapshot & { kind: typeof kind } {
  const plotId = "44444444-4444-4444-8444-444444444444";
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    status: overrides.status ?? "active",
    startsAt: hours[0]?.at ?? `${forecastDate}T00:00:00Z`,
    endsAt: `${forecastDate}T23:59:59Z`,
    kind,
    evidence: {
      schemaVersion: 1,
      scope: "farm_demo",
      plotIds: [plotId],
      forecastDate,
      samplePoint: null,
      source: {
        code: "demo",
        url: null,
        issuedAt: null,
        retrievedAt: `${forecastDate}T00:00:00Z`,
        isDemo: true,
      },
      temperatureHeightM: 2,
      detectionThresholdC:
        kind === "frost" ? 0 : kind === "extreme-heat" ? 35 : null,
      hours,
    },
  };
}

describe("Agronomic Rules Engine - Contract Validations", () => {
  it("validates all 5 default demo-v1 rules against riskRuleSchema", () => {
    expect(DEMO_V1_RULES).toHaveLength(5);
    for (const rule of DEMO_V1_RULES) {
      expect(riskRuleSchema.parse(rule)).toBeDefined();
    }
  });

  it("rejects rules with cross-crop stages (e.g. soybean stages on maize)", () => {
    expect(() =>
      riskRuleSchema.parse({
        code: "invalid-cross-crop",
        hazardKind: "frost",
        cropCode: "maize",
        stageCodes: ["R4"], // R4 is a soybean stage, not a maize stage
        temperatureHeightM: 2,
        thresholdC: -1,
        windGustThresholdKmh: null,
        precipitationThresholdMm: null,
        minimumConsecutiveHours: 1,
        stageMaxAgeDays: 14,
        riskLevel: "high",
        reviewState: "synthetic",
        evidenceUrl: null,
        reasonTemplate: "Template",
        recommendedActionTemplates: ["Action"],
      }),
    ).toThrow(/RiskRule stages must belong to its crop/);
  });

  it("rejects approved rules with null evidenceUrl", () => {
    expect(() =>
      riskRuleSchema.parse({
        code: "invalid-approved-rule",
        hazardKind: "frost",
        cropCode: "maize",
        stageCodes: ["V3"],
        temperatureHeightM: 2,
        thresholdC: -1,
        windGustThresholdKmh: null,
        precipitationThresholdMm: null,
        minimumConsecutiveHours: 1,
        stageMaxAgeDays: 14,
        riskLevel: "moderate",
        reviewState: "approved",
        evidenceUrl: null, // Approved rules MUST have HTTPS evidenceUrl
        reasonTemplate: "Template",
        recommendedActionTemplates: ["Action"],
      }),
    ).toThrow(/Approved rules require a non-null HTTPS evidenceUrl/);
  });
});

describe("Agronomic Rules Engine - RuleProvider Pattern", () => {
  it("resolves default system rules (demo-v1)", () => {
    const rules = resolveRules();
    expect(rules).toHaveLength(DEMO_V1_RULES.length);
    expect(rules.map((r) => r.code)).toEqual([
      "demo-maize-v3",
      "demo-maize-v6",
      "demo-soybean-r4",
      "demo-maize-heat",
      "demo-storm-v",
    ]);
  });

  it("allows custom rules to override default rules with matching code", () => {
    const customRule: RiskRule = {
      code: "demo-maize-v3",
      hazardKind: "frost",
      cropCode: "maize",
      stageCodes: ["V3"],
      temperatureHeightM: 2,
      thresholdC: -3,
      windGustThresholdKmh: null,
      precipitationThresholdMm: null,
      minimumConsecutiveHours: 2,
      stageMaxAgeDays: 10,
      riskLevel: "critical",
      reviewState: "synthetic",
      evidenceUrl: null,
      reasonTemplate: "Custom rule {code} fired.",
      recommendedActionTemplates: ["Custom critical action"],
    };

    const rules = resolveRules(DEMO_V1_RULES, [customRule]);
    const overridden = rules.find((r) => r.code === "demo-maize-v3");

    expect(overridden?.thresholdC).toBe(-3);
    expect(overridden?.riskLevel).toBe("critical");
    expect(overridden?.minimumConsecutiveHours).toBe(2);
  });
});

describe("Agronomic Rules Engine - Evaluation & State Precedence", () => {
  const plotId = "44444444-4444-4444-8444-444444444444";
  const baseCropCycle: CropCycle = {
    id: "33333333-3333-4333-8333-333333333333",
    plotId,
    cropCode: "maize",
    seasonLabel: "2025/26",
    sownOn: "2026-08-01",
    stageCode: "V3",
    stageAsOf: "2026-09-05",
    endedOn: null,
    updatedAt: "2026-09-05T12:00:00Z",
  };

  it("yields no_applicable_rule when event is cancelled", () => {
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const event = createEvent("frost", "2026-09-12", hours, {
      status: "cancelled",
    });

    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: baseCropCycle },
      event,
    });

    expect(alert.assessmentState).toBe("no_applicable_rule");
    expect(alert.riskLevel).toBeNull();
    expect(alert.recommendedActions).toHaveLength(0);
    expect(alert.reason).toBe("Forecast withdrawn by newer data.");
    expect(plotAlertSchema.parse(alert)).toBeDefined();
  });

  it("yields insufficient_data when plot lacks active crop cycle or stage for an otherwise matching rule", () => {
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const event = createEvent("frost", "2026-09-12", hours);

    const alertNoCycle = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: null },
      event,
    });
    expect(alertNoCycle.assessmentState).toBe("insufficient_data");
    expect(alertNoCycle.riskLevel).toBeNull();
    expect(alertNoCycle.recommendedActions).toEqual([]);

    const alertNoStage = evaluatePlotAlert({
      plot: {
        id: plotId,
        activeCropCycle: { ...baseCropCycle, stageCode: null, stageAsOf: null },
      },
      event,
    });
    expect(alertNoStage.assessmentState).toBe("insufficient_data");
  });

  it("yields insufficient_data when stageAsOf follows the event local start date", () => {
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const event = createEvent("frost", "2026-09-12", hours);

    const alert = evaluatePlotAlert({
      plot: {
        id: plotId,
        activeCropCycle: { ...baseCropCycle, stageAsOf: "2026-09-15" },
      },
      event,
    });

    expect(alert.assessmentState).toBe("insufficient_data");
    expect(alert.reason).toContain("cannot follow event local start date");
  });

  it("yields insufficient_data when stage observation exceeds stageMaxAgeDays", () => {
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const event = createEvent("frost", "2026-09-12", hours);

    // stageAsOf is 20 days ago (max allowed is 14 days in demo-v1)
    const alert = evaluatePlotAlert({
      plot: {
        id: plotId,
        activeCropCycle: { ...baseCropCycle, stageAsOf: "2026-08-23" },
      },
      event,
    });

    expect(alert.assessmentState).toBe("insufficient_data");
    expect(alert.reason).toContain(
      "stale (20 days old; max allowed is 14 days)",
    );
  });

  it("enforces stageMaxAgeDays per-rule when multiple rules have different age limits", () => {
    const strictRule: RiskRule = {
      code: "rule-strict-10-days",
      hazardKind: "frost",
      cropCode: "maize",
      stageCodes: ["V3"],
      temperatureHeightM: 2,
      thresholdC: 0,
      windGustThresholdKmh: null,
      precipitationThresholdMm: null,
      minimumConsecutiveHours: 1,
      stageMaxAgeDays: 10,
      riskLevel: "critical", // Stricter rule has higher severity
      reviewState: "synthetic",
      evidenceUrl: null,
      reasonTemplate: "Strict rule {code}",
      recommendedActionTemplates: ["Strict action"],
    };

    const permissiveRule: RiskRule = {
      code: "rule-permissive-14-days",
      hazardKind: "frost",
      cropCode: "maize",
      stageCodes: ["V3"],
      temperatureHeightM: 2,
      thresholdC: 0,
      windGustThresholdKmh: null,
      precipitationThresholdMm: null,
      minimumConsecutiveHours: 1,
      stageMaxAgeDays: 14,
      riskLevel: "moderate",
      reviewState: "synthetic",
      evidenceUrl: null,
      reasonTemplate: "Permissive rule {code}",
      recommendedActionTemplates: ["Permissive action"],
    };

    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const event = createEvent("frost", "2026-09-12", hours);

    // Case 1: age is 12 days -> strictRule is expired (age 12 > 10), but permissiveRule is fresh (age 12 <= 14)
    // strictRule MUST NOT fire despite having higher severity!
    const alert12Days = evaluatePlotAlert({
      plot: {
        id: plotId,
        activeCropCycle: { ...baseCropCycle, stageAsOf: "2026-08-31" }, // exactly 12 days
      },
      event,
      rules: [strictRule, permissiveRule],
    });

    expect(alert12Days.assessmentState).toBe("evaluated");
    expect(alert12Days.riskLevel).toBe("moderate");
    expect(alert12Days.inputSnapshot.matchedRuleCodes).toEqual([
      "rule-permissive-14-days",
    ]);

    // Case 2: age is 10 days (boundary) -> both rules are fresh, strictRule fires and wins on critical severity
    const alert10Days = evaluatePlotAlert({
      plot: {
        id: plotId,
        activeCropCycle: { ...baseCropCycle, stageAsOf: "2026-09-02" }, // exactly 10 days
      },
      event,
      rules: [strictRule, permissiveRule],
    });

    expect(alert10Days.assessmentState).toBe("evaluated");
    expect(alert10Days.riskLevel).toBe("critical");
    expect(alert10Days.inputSnapshot.matchedRuleCodes).toEqual([
      "rule-permissive-14-days",
      "rule-strict-10-days",
    ]);
  });

  it("yields no_applicable_rule in live mode when rules are synthetic (even if stage is stale)", () => {
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const event = createEvent("frost", "2026-09-12", hours);
    event.evidence.source = {
      code: "open_meteo",
      url: "https://open-meteo.com",
      issuedAt: null,
      retrievedAt: "2026-09-12T00:00:00Z",
      isDemo: false,
    };
    event.evidence.scope = "plot_forecast";
    event.evidence.samplePoint = {
      type: "Point",
      coordinates: [-64.18, -31.42],
    };

    // With a stale stage (20 days old) in LIVE mode:
    // Synthetic rules cannot be used to declare insufficient_data; it MUST return no_applicable_rule
    const alert = evaluatePlotAlert({
      plot: {
        id: plotId,
        activeCropCycle: { ...baseCropCycle, stageAsOf: "2026-08-23" },
      },
      event,
    });

    expect(alert.assessmentState).toBe("no_applicable_rule");
    expect(alert.riskLevel).toBeNull();
    expect(alert.recommendedActions).toEqual([]);
    expect(plotAlertSchema.parse(alert)).toBeDefined();
  });
});

describe("Agronomic Rules Engine - Evaluation of All Canonical Rules", () => {
  const plotId = "44444444-4444-4444-8444-444444444444";

  it("evaluates demo-maize-v3 frost alert", () => {
    const cropCycle: CropCycle = {
      id: "33333333-3333-4333-8333-333333333333",
      plotId,
      cropCode: "maize",
      seasonLabel: "2025/26",
      sownOn: "2026-08-01",
      stageCode: "V3",
      stageAsOf: "2026-09-05",
      endedOn: null,
      updatedAt: "2026-09-05T12:00:00Z",
    };
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -1.5 })];
    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: cropCycle },
      event: createEvent("frost", "2026-09-12", hours),
    });

    expect(alert.assessmentState).toBe("evaluated");
    expect(alert.riskLevel).toBe("moderate");
    expect(alert.inputSnapshot.matchedRuleCodes).toEqual(["demo-maize-v3"]);
  });

  it("evaluates demo-maize-v6 frost alert with high risk", () => {
    const cropCycle: CropCycle = {
      id: "33333333-3333-4333-8333-333333333333",
      plotId,
      cropCode: "maize",
      seasonLabel: "2025/26",
      sownOn: "2026-08-01",
      stageCode: "V6",
      stageAsOf: "2026-09-05",
      endedOn: null,
      updatedAt: "2026-09-05T12:00:00Z",
    };
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -1 })];
    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: cropCycle },
      event: createEvent("frost", "2026-09-12", hours),
    });

    expect(alert.assessmentState).toBe("evaluated");
    expect(alert.riskLevel).toBe("high");
    expect(alert.inputSnapshot.matchedRuleCodes).toEqual(["demo-maize-v6"]);
  });

  it("evaluates demo-soybean-r4 frost alert with high risk", () => {
    const cropCycle: CropCycle = {
      id: "33333333-3333-4333-8333-333333333333",
      plotId,
      cropCode: "soybean",
      seasonLabel: "2025/26",
      sownOn: "2026-08-01",
      stageCode: "R4",
      stageAsOf: "2026-09-05",
      endedOn: null,
      updatedAt: "2026-09-05T12:00:00Z",
    };
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -1.2 })];
    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: cropCycle },
      event: createEvent("frost", "2026-09-12", hours),
    });

    expect(alert.assessmentState).toBe("evaluated");
    expect(alert.riskLevel).toBe("high");
    expect(alert.inputSnapshot.matchedRuleCodes).toEqual(["demo-soybean-r4"]);
  });

  it("evaluates demo-maize-heat requiring 2 consecutive hours >= 35°C", () => {
    const cropCycle: CropCycle = {
      id: "33333333-3333-4333-8333-333333333333",
      plotId,
      cropCode: "maize",
      seasonLabel: "2025/26",
      sownOn: "2026-08-01",
      stageCode: "VT",
      stageAsOf: "2026-09-05",
      endedOn: null,
      updatedAt: "2026-09-05T12:00:00Z",
    };

    // Non-consecutive: hours at 14:00 and 16:00 (gap at 15:00)
    const gapHours = [
      createHour("2026-09-12T14:00:00Z", { temperatureC: 36 }),
      createHour("2026-09-12T15:00:00Z", { temperatureC: 33 }),
      createHour("2026-09-12T16:00:00Z", { temperatureC: 36 }),
    ];
    const alertGap = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: cropCycle },
      event: createEvent("extreme-heat", "2026-09-12", gapHours),
    });
    expect(alertGap.assessmentState).toBe("no_applicable_rule");

    // 2 consecutive hours
    const consecutiveHours = [
      createHour("2026-09-12T14:00:00Z", { temperatureC: 35.5 }),
      createHour("2026-09-12T15:00:00Z", { temperatureC: 36.2 }),
    ];
    const alertConsecutive = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: cropCycle },
      event: createEvent("extreme-heat", "2026-09-12", consecutiveHours),
    });
    expect(alertConsecutive.assessmentState).toBe("evaluated");
    expect(alertConsecutive.riskLevel).toBe("critical");
    expect(alertConsecutive.inputSnapshot.matchedRuleCodes).toEqual([
      "demo-maize-heat",
    ]);
  });

  it("evaluates demo-storm-v on wind gusts >= 70 km/h", () => {
    const cropCycle: CropCycle = {
      id: "33333333-3333-4333-8333-333333333333",
      plotId,
      cropCode: "maize",
      seasonLabel: "2025/26",
      sownOn: "2026-08-01",
      stageCode: "V6",
      stageAsOf: "2026-09-05",
      endedOn: null,
      updatedAt: "2026-09-05T12:00:00Z",
    };
    const hours = [
      createHour("2026-09-12T18:00:00Z", { windGustKmh: 45 }),
      createHour("2026-09-12T19:00:00Z", { windGustKmh: 75 }),
    ];
    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: cropCycle },
      event: createEvent("severe-storm", "2026-09-12", hours),
    });

    expect(alert.assessmentState).toBe("evaluated");
    expect(alert.riskLevel).toBe("high");
    expect(alert.inputSnapshot.matchedRuleCodes).toEqual(["demo-storm-v"]);
  });

  it("evaluates custom hail rule matching WMO weather code 96/99", () => {
    const cropCycle: CropCycle = {
      id: "33333333-3333-4333-8333-333333333333",
      plotId,
      cropCode: "soybean",
      seasonLabel: "2025/26",
      sownOn: "2026-08-01",
      stageCode: "R4",
      stageAsOf: "2026-09-05",
      endedOn: null,
      updatedAt: "2026-09-05T12:00:00Z",
    };
    const hailRule: RiskRule = {
      code: "custom-soybean-hail",
      hazardKind: "hail",
      cropCode: "soybean",
      stageCodes: ["R4"],
      temperatureHeightM: 2,
      thresholdC: null,
      windGustThresholdKmh: null,
      precipitationThresholdMm: null,
      minimumConsecutiveHours: 1,
      stageMaxAgeDays: 14,
      riskLevel: "critical",
      reviewState: "synthetic",
      evidenceUrl: null,
      reasonTemplate: "Hail alert {code}",
      recommendedActionTemplates: ["Inspect pods"],
    };

    const hours = [createHour("2026-09-12T17:00:00Z", { weatherCode: 96 })];
    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: cropCycle },
      event: createEvent("hail", "2026-09-12", hours),
      rules: [hailRule],
    });

    expect(alert.assessmentState).toBe("evaluated");
    expect(alert.riskLevel).toBe("critical");
    expect(alert.inputSnapshot.matchedRuleCodes).toEqual([
      "custom-soybean-hail",
    ]);
  });

  it("handles LLM generation method by including modelId and promptVersion", () => {
    const cropCycle: CropCycle = {
      id: "33333333-3333-4333-8333-333333333333",
      plotId,
      cropCode: "maize",
      seasonLabel: "2025/26",
      sownOn: "2026-08-01",
      stageCode: "V3",
      stageAsOf: "2026-09-05",
      endedOn: null,
      updatedAt: "2026-09-05T12:00:00Z",
    };
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: cropCycle },
      event: createEvent("frost", "2026-09-12", hours),
      generationMethod: "llm",
      modelId: "gpt-4o",
      promptVersion: "v1.2",
    });

    expect(alert.generationMethod).toBe("llm");
    expect(alert.inputSnapshot.generation.method).toBe("llm");
    expect(alert.inputSnapshot.generation.modelId).toBe("gpt-4o");
    expect(alert.inputSnapshot.generation.promptVersion).toBe("v1.2");
    expect(plotAlertSchema.parse(alert)).toBeDefined();
  });

  it("calculates default validUntil from source freshness deadline", () => {
    const cropCycle: CropCycle = {
      id: "33333333-3333-4333-8333-333333333333",
      plotId,
      cropCode: "maize",
      seasonLabel: "2025/26",
      sownOn: "2026-08-01",
      stageCode: "V3",
      stageAsOf: "2026-09-05",
      endedOn: null,
      updatedAt: "2026-09-05T12:00:00Z",
    };
    const now = "2026-09-12T02:00:00Z";
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const event = createEvent("frost", "2026-09-12", hours);
    // retrievedAt is 2026-09-12T02:00:00Z -> deadline is +60m = 03:00:00Z
    event.evidence.source.retrievedAt = now;
    event.evidence.source.issuedAt = null;

    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: cropCycle },
      event,
      now,
    });

    expect(alert.validUntil).toBe("2026-09-12T03:00:00.000Z");
  });

  it("yields no_applicable_rule when plot crop has no rules for the hazard even if stage is missing", () => {
    // In demo-v1, extreme-heat rules ONLY exist for maize (demo-maize-heat), NOT soybean!
    const soybeanNoStage: CropCycle = {
      id: "33333333-3333-4333-8333-333333333333",
      plotId,
      cropCode: "soybean",
      seasonLabel: "2025/26",
      sownOn: "2026-08-01",
      stageCode: null,
      stageAsOf: null,
      endedOn: null,
      updatedAt: "2026-09-05T12:00:00Z",
    };
    const hours = [createHour("2026-09-12T14:00:00Z", { temperatureC: 38 })];
    const event = createEvent("extreme-heat", "2026-09-12", hours);

    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: soybeanNoStage },
      event,
    });

    // Because no extreme-heat rule exists for soybean, missing stage must yield no_applicable_rule, NOT insufficient_data
    expect(alert.assessmentState).toBe("no_applicable_rule");
    expect(alert.riskLevel).toBeNull();
  });

  it("validates generationSchema mutually exclusive template vs llm invariants", () => {
    // Valid template
    expect(
      generationSchema.parse({
        method: "template",
        modelId: null,
        promptVersion: null,
      }),
    ).toBeDefined();

    // Invalid template with non-null modelId
    expect(() =>
      generationSchema.parse({
        method: "template",
        modelId: "gpt-4",
        promptVersion: null,
      }),
    ).toThrow();

    // Valid llm
    expect(
      generationSchema.parse({
        method: "llm",
        modelId: "gpt-4",
        promptVersion: "v1",
      }),
    ).toBeDefined();

    // Invalid llm with null modelId
    expect(() =>
      generationSchema.parse({
        method: "llm",
        modelId: null,
        promptVersion: "v1",
      }),
    ).toThrow();
  });
});
