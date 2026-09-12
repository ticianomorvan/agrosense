import {
  type CropCycle,
  DEMO_V1_RULES,
  type EventSnapshot,
  evaluatePlotAlert,
  type ForecastHour,
  plotAlertSchema,
  type RiskRule,
  resolveRules,
} from "@agrosense/contracts";
import { describe, expect, it } from "vitest";

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

  it("appends brand new custom rules with distinct code", () => {
    const customRule: RiskRule = {
      code: "custom-maize-v4-hail",
      hazardKind: "hail",
      cropCode: "maize",
      stageCodes: ["V4"],
      temperatureHeightM: 2,
      thresholdC: null,
      windGustThresholdKmh: null,
      precipitationThresholdMm: null,
      minimumConsecutiveHours: 1,
      stageMaxAgeDays: 14,
      riskLevel: "high",
      reviewState: "synthetic",
      evidenceUrl: null,
      reasonTemplate: "Hail alert for {code}",
      recommendedActionTemplates: ["Inspect canopy defoliation"],
    };

    const rules = resolveRules(DEMO_V1_RULES, [customRule]);
    expect(rules).toHaveLength(DEMO_V1_RULES.length + 1);
    expect(rules.find((r) => r.code === "custom-maize-v4-hail")).toBeDefined();
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

  it("yields insufficient_data when plot lacks active crop cycle or stage", () => {
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const event = createEvent("frost", "2026-09-12", hours);

    const alertNoCycle = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: null },
      event,
    });
    expect(alertNoCycle.assessmentState).toBe("insufficient_data");
    expect(alertNoCycle.riskLevel).toBeNull();

    const alertNoStage = evaluatePlotAlert({
      plot: {
        id: plotId,
        activeCropCycle: { ...baseCropCycle, stageCode: null, stageAsOf: null },
      },
      event,
    });
    expect(alertNoStage.assessmentState).toBe("insufficient_data");
  });

  it("yields insufficient_data when stageAsOf is in the future relative to forecast date", () => {
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
    expect(alert.reason).toContain("cannot follow event forecast date");
  });

  it("yields insufficient_data when stage observation exceeds stageMaxAgeDays (stale stage)", () => {
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

  it("yields no_applicable_rule when plot stage has no matching rule in catalog", () => {
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const event = createEvent("frost", "2026-09-12", hours);

    // Maize in R1 has no demo frost rule (demo rules are for V3, V6)
    const alert = evaluatePlotAlert({
      plot: {
        id: plotId,
        activeCropCycle: { ...baseCropCycle, stageCode: "R1" },
      },
      event,
    });

    expect(alert.assessmentState).toBe("no_applicable_rule");
    expect(alert.riskLevel).toBeNull();
    expect(alert.recommendedActions).toHaveLength(0);
  });

  it("yields no_applicable_rule when live event lacks approved rules with evidenceUrl", () => {
    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const event = createEvent("frost", "2026-09-12", hours);
    // Mark as live source
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

    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: baseCropCycle },
      event,
    });

    // Synthetic demo rules cannot fire for live events
    expect(alert.assessmentState).toBe("no_applicable_rule");
    expect(alert.riskLevel).toBeNull();
  });
});

describe("Agronomic Rules Engine - Detection & Rule Firing", () => {
  const plotId = "44444444-4444-4444-8444-444444444444";
  const maizeV3: CropCycle = {
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

  it("evaluates demo-maize-v3 frost alert successfully", () => {
    const hours = [
      createHour("2026-09-12T03:00:00Z", { temperatureC: 2 }),
      createHour("2026-09-12T04:00:00Z", { temperatureC: -1.5 }),
      createHour("2026-09-12T05:00:00Z", { temperatureC: 4 }),
    ];
    const event = createEvent("frost", "2026-09-12", hours);

    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: maizeV3 },
      event,
    });

    expect(alert.assessmentState).toBe("evaluated");
    expect(alert.riskLevel).toBe("moderate");
    expect(alert.reason).toBe(
      "Escenario sintético: la regla demo-maize-v3 coincide.",
    );
    expect(alert.recommendedActions).toEqual([
      "Demostración: revisar el lote; no es asesoramiento agronómico.",
    ]);
    expect(alert.inputSnapshot.matchedRuleCodes).toEqual(["demo-maize-v3"]);
    expect(plotAlertSchema.parse(alert)).toBeDefined();
  });

  it("evaluates demo-maize-heat requiring 2 consecutive hours >= 35°C", () => {
    const maizeVT: CropCycle = { ...maizeV3, stageCode: "VT" };

    // Single isolated hour -> should NOT fire
    const isolatedHours = [
      createHour("2026-09-12T13:00:00Z", { temperatureC: 34 }),
      createHour("2026-09-12T14:00:00Z", { temperatureC: 36 }),
      createHour("2026-09-12T15:00:00Z", { temperatureC: 33 }),
    ];
    const alertIsolated = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: maizeVT },
      event: createEvent("extreme-heat", "2026-09-12", isolatedHours),
    });
    expect(alertIsolated.assessmentState).toBe("no_applicable_rule");

    // 2 consecutive hours -> fires critical
    const consecutiveHours = [
      createHour("2026-09-12T14:00:00Z", { temperatureC: 35.5 }),
      createHour("2026-09-12T15:00:00Z", { temperatureC: 36.2 }),
    ];
    const alertConsecutive = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: maizeVT },
      event: createEvent("extreme-heat", "2026-09-12", consecutiveHours),
    });
    expect(alertConsecutive.assessmentState).toBe("evaluated");
    expect(alertConsecutive.riskLevel).toBe("critical");
    expect(alertConsecutive.inputSnapshot.matchedRuleCodes).toEqual([
      "demo-maize-heat",
    ]);
  });

  it("evaluates demo-storm-v on severe gusts >= 70 km/h", () => {
    const maizeV6: CropCycle = { ...maizeV3, stageCode: "V6" };
    const hours = [
      createHour("2026-09-12T18:00:00Z", { windGustKmh: 45 }),
      createHour("2026-09-12T19:00:00Z", { windGustKmh: 78 }),
    ];
    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: maizeV6 },
      event: createEvent("severe-storm", "2026-09-12", hours),
    });

    expect(alert.assessmentState).toBe("evaluated");
    expect(alert.riskLevel).toBe("high");
    expect(alert.inputSnapshot.matchedRuleCodes).toEqual(["demo-storm-v"]);
  });
});

describe("Agronomic Rules Engine - Multi-match & Lexicographical Tie-breaking", () => {
  const plotId = "44444444-4444-4444-8444-444444444444";
  const maizeV3: CropCycle = {
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

  it("picks higher risk when multiple rules fire with different severity", () => {
    const ruleModerate: RiskRule = {
      code: "rule-b-moderate",
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
      reasonTemplate: "Reason {code}",
      recommendedActionTemplates: ["Action moderate"],
    };

    const ruleCritical: RiskRule = {
      code: "rule-z-critical",
      hazardKind: "frost",
      cropCode: "maize",
      stageCodes: ["V3"],
      temperatureHeightM: 2,
      thresholdC: -2,
      windGustThresholdKmh: null,
      precipitationThresholdMm: null,
      minimumConsecutiveHours: 1,
      stageMaxAgeDays: 14,
      riskLevel: "critical",
      reviewState: "synthetic",
      evidenceUrl: null,
      reasonTemplate: "Reason {code}",
      recommendedActionTemplates: ["Action critical"],
    };

    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -3 })];
    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: maizeV3 },
      event: createEvent("frost", "2026-09-12", hours),
      rules: [ruleModerate, ruleCritical],
    });

    expect(alert.riskLevel).toBe("critical");
    expect(alert.reason).toBe("Reason rule-z-critical");
    expect(alert.recommendedActions).toEqual(["Action critical"]);
    expect(alert.inputSnapshot.matchedRuleCodes).toEqual([
      "rule-b-moderate",
      "rule-z-critical",
    ]);
  });

  it("breaks ties with lexicographically smallest rule code when risk levels are equal", () => {
    const ruleA: RiskRule = {
      code: "alpha-rule",
      hazardKind: "frost",
      cropCode: "maize",
      stageCodes: ["V3"],
      temperatureHeightM: 2,
      thresholdC: -1,
      windGustThresholdKmh: null,
      precipitationThresholdMm: null,
      minimumConsecutiveHours: 1,
      stageMaxAgeDays: 14,
      riskLevel: "high",
      reviewState: "synthetic",
      evidenceUrl: null,
      reasonTemplate: "Reason {code}",
      recommendedActionTemplates: ["Alpha action"],
    };

    const ruleB: RiskRule = {
      code: "beta-rule",
      hazardKind: "frost",
      cropCode: "maize",
      stageCodes: ["V3"],
      temperatureHeightM: 2,
      thresholdC: -1,
      windGustThresholdKmh: null,
      precipitationThresholdMm: null,
      minimumConsecutiveHours: 1,
      stageMaxAgeDays: 14,
      riskLevel: "high",
      reviewState: "synthetic",
      evidenceUrl: null,
      reasonTemplate: "Reason {code}",
      recommendedActionTemplates: ["Beta action"],
    };

    const hours = [createHour("2026-09-12T04:00:00Z", { temperatureC: -2 })];
    const alert = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: maizeV3 },
      event: createEvent("frost", "2026-09-12", hours),
      rules: [ruleB, ruleA], // Provided in reverse order
    });

    // alpha-rule is lexicographically smaller than beta-rule
    expect(alert.riskLevel).toBe("high");
    expect(alert.reason).toBe("Reason alpha-rule");
    expect(alert.recommendedActions).toEqual(["Alpha action"]);
    expect(alert.inputSnapshot.matchedRuleCodes).toEqual([
      "alpha-rule",
      "beta-rule",
    ]);
  });
});
