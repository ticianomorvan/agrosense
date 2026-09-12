import {
  type AgronomicRule,
  DEFAULT_AGRONOMIC_RULES,
  evaluateAgronomicAlerts,
  type HourlyWeatherData,
  normalizePhenologicalStage,
  type PlotContext,
  resolveRules,
} from "@agrosense/contracts";
import { describe, expect, it } from "vitest";

describe("Agronomic Engine - Stage Normalization", () => {
  it("normalizes maize and soybean stage codes to macro stages", () => {
    expect(normalizePhenologicalStage("VE")).toContain("emergence");
    expect(normalizePhenologicalStage("V3")).toContain("vegetative");
    expect(normalizePhenologicalStage("V6")).toContain("vegetative");
    expect(normalizePhenologicalStage("VT")).toContain("flowering");
    expect(normalizePhenologicalStage("R1")).toContain("flowering");
    expect(normalizePhenologicalStage("R4")).toContain("grain_filling");
    expect(normalizePhenologicalStage("R6")).toContain("grain_filling");
    expect(normalizePhenologicalStage("R7")).toContain("maturity");
    expect(normalizePhenologicalStage("vegetative")).toContain("vegetative");
    expect(normalizePhenologicalStage("flowering")).toContain("flowering");
  });
});

describe("Agronomic Engine - Rule Provider", () => {
  it("uses default rules when no custom rules are provided", () => {
    const rules = resolveRules(DEFAULT_AGRONOMIC_RULES, []);
    expect(rules.length).toBe(DEFAULT_AGRONOMIC_RULES.length);
  });

  it("allows custom rules to override default rules with matching id", () => {
    const customRule: AgronomicRule = {
      id: "rule-maize-vegetative-frost",
      crop: "maize",
      phenologicalStage: "vegetative",
      event: "frost",
      thresholds: { minTemperatureC: -3, minimumConsecutiveHours: 2 },
      severity: "critical",
      recommendedActions: ["Custom extreme frost recovery action"],
      baseConfidence: 0.99,
    };

    const rules = resolveRules(DEFAULT_AGRONOMIC_RULES, [customRule]);
    const overridden = rules.find(
      (r) => r.id === "rule-maize-vegetative-frost",
    );

    expect(overridden?.thresholds.minTemperatureC).toBe(-3);
    expect(overridden?.severity).toBe("critical");
    expect(overridden?.recommendedActions).toContain(
      "Custom extreme frost recovery action",
    );
  });

  it("appends new custom rules with unique ids", () => {
    const customRule: AgronomicRule = {
      id: "custom-my-new-rule",
      crop: "maize",
      phenologicalStage: "vegetative",
      event: "severe-storm",
      thresholds: { windGustKmh: 90 },
      severity: "critical",
      recommendedActions: ["Inspect for catastrophic lodging"],
      baseConfidence: 0.95,
    };

    const rules = resolveRules(DEFAULT_AGRONOMIC_RULES, [customRule]);
    expect(rules.length).toBe(DEFAULT_AGRONOMIC_RULES.length + 1);
    expect(rules.find((r) => r.id === "custom-my-new-rule")).toBeDefined();
  });
});

describe("Agronomic Engine - Thresholds & Event Detection", () => {
  const samplePlot: PlotContext = {
    plotId: "plot-101",
    farmId: "farm-55",
    crop: "maize",
    phenologicalStage: "V3",
  };

  it("detects frost when temperature drops below threshold", () => {
    const weatherSeries: HourlyWeatherData[] = [
      { timestamp: "2026-09-15T04:00:00Z", temperatureC: 4 },
      { timestamp: "2026-09-15T05:00:00Z", temperatureC: -1.5 },
      { timestamp: "2026-09-15T06:00:00Z", temperatureC: -2.0 },
      { timestamp: "2026-09-15T07:00:00Z", temperatureC: 3 },
    ];

    const alerts = evaluateAgronomicAlerts(samplePlot, weatherSeries);
    expect(alerts.length).toBe(1);

    const [alert] = alerts;
    expect(alert).toBeDefined();
    if (!alert) return;

    expect(alert.event).toBe("frost");
    expect(alert.severity).toBe("high");
    expect(alert.plotId).toBe("plot-101");
    expect(alert.validFrom).toBe("2026-09-15T05:00:00Z");
    expect(alert.validUntil).toBe("2026-09-15T07:00:00.000Z");
    expect(alert.recommendedActions.length).toBeGreaterThan(0);
    expect(alert.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("does NOT detect frost when temperature remains above threshold", () => {
    const weatherSeries: HourlyWeatherData[] = [
      { timestamp: "2026-09-15T04:00:00Z", temperatureC: 2.5 },
      { timestamp: "2026-09-15T05:00:00Z", temperatureC: 0.5 },
      { timestamp: "2026-09-15T06:00:00Z", temperatureC: 1.0 },
    ];

    const alerts = evaluateAgronomicAlerts(samplePlot, weatherSeries);
    expect(alerts.length).toBe(0);
  });

  it("detects extreme heat during flowering stage", () => {
    const floweringMaize: PlotContext = {
      plotId: "plot-flowering",
      crop: "maize",
      phenologicalStage: "VT",
    };

    const heatWave: HourlyWeatherData[] = [
      { timestamp: "2026-09-15T12:00:00Z", temperatureC: 33 },
      { timestamp: "2026-09-15T13:00:00Z", temperatureC: 36.5 },
      { timestamp: "2026-09-15T14:00:00Z", temperatureC: 37.0 },
      { timestamp: "2026-09-15T15:00:00Z", temperatureC: 32 },
    ];

    const alerts = evaluateAgronomicAlerts(floweringMaize, heatWave);
    expect(alerts.length).toBe(1);
    const [alert] = alerts;
    expect(alert).toBeDefined();
    if (!alert) return;

    expect(alert.event).toBe("extreme-heat");
    expect(alert.severity).toBe("critical");
    expect(alert.validFrom).toBe("2026-09-15T13:00:00Z");
    expect(alert.validUntil).toBe("2026-09-15T15:00:00.000Z");
  });

  it("does not trigger heat alert if consecutive hours threshold is not satisfied", () => {
    const floweringMaize: PlotContext = {
      plotId: "plot-flowering",
      crop: "maize",
      phenologicalStage: "flowering",
    };

    // Only 1 hour over 35°C (rule requires 2 consecutive hours)
    const heatWaveSpike: HourlyWeatherData[] = [
      { timestamp: "2026-09-15T12:00:00Z", temperatureC: 32 },
      { timestamp: "2026-09-15T13:00:00Z", temperatureC: 36.0 },
      { timestamp: "2026-09-15T14:00:00Z", temperatureC: 33.0 },
    ];

    const alerts = evaluateAgronomicAlerts(floweringMaize, heatWaveSpike);
    expect(alerts.length).toBe(0);
  });

  it("detects severe storm with high wind gusts and precipitation", () => {
    const stormPlot: PlotContext = {
      plotId: "plot-storm",
      crop: "maize",
      phenologicalStage: "V6",
    };

    const stormWeather: HourlyWeatherData[] = [
      {
        timestamp: "2026-09-15T18:00:00Z",
        temperatureC: 22,
        windGustKmh: 75,
        precipitationMm: 35,
        precipitationProbability: 40,
      },
    ];

    const alerts = evaluateAgronomicAlerts(stormPlot, stormWeather);
    expect(alerts.length).toBe(1);
    const [alert] = alerts;
    expect(alert).toBeDefined();
    if (!alert) return;

    expect(alert.event).toBe("severe-storm");
    expect(alert.severity).toBe("high");
    expect(alert.recommendedActions).toContain(
      "Survey fields to determine incidence of stalk breakage and lodging.",
    );
  });

  it("triggers multiple distinct hazard alerts when compound weather thresholds are met", () => {
    const stormPlot: PlotContext = {
      plotId: "plot-compound",
      crop: "maize",
      phenologicalStage: "V6",
    };

    // Both high wind gusts (severe-storm) and convective storm with hail (WMO 96)
    const compoundWeather: HourlyWeatherData[] = [
      {
        timestamp: "2026-09-15T18:00:00Z",
        temperatureC: 22,
        windGustKmh: 80,
        precipitationMm: 40,
        weatherCode: 96,
        precipitationProbability: 95,
      },
    ];

    const alerts = evaluateAgronomicAlerts(stormPlot, compoundWeather);
    expect(alerts.length).toBe(2);

    const eventTypes = alerts.map((a) => a.event);
    expect(eventTypes).toContain("severe-storm");
    expect(eventTypes).toContain("hail");
  });

  it("detects hail based on WMO code or convective index", () => {
    const hailPlot: PlotContext = {
      plotId: "plot-hail",
      crop: "soybean",
      phenologicalStage: "R4",
    };

    const hailWeather: HourlyWeatherData[] = [
      {
        timestamp: "2026-09-15T19:00:00Z",
        temperatureC: 19,
        precipitationMm: 25,
        weatherCode: 96, // WMO thunderstorm with hail
        precipitationProbability: 85,
      },
    ];

    const alerts = evaluateAgronomicAlerts(hailPlot, hailWeather);
    expect(alerts.length).toBe(1);
    const [alert] = alerts;
    expect(alert).toBeDefined();
    if (!alert) return;

    expect(alert.event).toBe("hail");
    expect(alert.severity).toBe("critical");
    expect(alert.recommendedActions).toContain(
      "Quantify opened, bruised, and dropped pods per square meter.",
    );
  });

  it("deduplicates alerts and prioritizes higher severity for overlapping rules", () => {
    const plot: PlotContext = {
      plotId: "plot-dedup",
      crop: "maize",
      phenologicalStage: "vegetative",
    };

    // Weather satisfies both a moderate rule and a high rule for frost
    const weather: HourlyWeatherData[] = [
      { timestamp: "2026-09-15T05:00:00Z", temperatureC: -2 },
      { timestamp: "2026-09-15T06:00:00Z", temperatureC: -2 },
    ];

    const customModerateRule: AgronomicRule = {
      id: "rule-moderate-frost",
      crop: "maize",
      phenologicalStage: "vegetative",
      event: "frost",
      thresholds: { minTemperatureC: 0 },
      severity: "moderate",
      recommendedActions: ["Additional moderate advisory"],
      baseConfidence: 0.8,
    };

    const alerts = evaluateAgronomicAlerts(plot, weather, {
      customRules: [customModerateRule],
    });

    // Exactly 1 frost alert should be generated, with 'high' severity and merged actions
    expect(alerts.length).toBe(1);
    const [alert] = alerts;
    expect(alert).toBeDefined();
    if (!alert) return;

    expect(alert.event).toBe("frost");
    expect(alert.severity).toBe("high");
    expect(alert.recommendedActions).toContain("Additional moderate advisory");
  });

  it("handles empty weather data gracefully", () => {
    const alerts = evaluateAgronomicAlerts(samplePlot, []);
    expect(alerts).toEqual([]);
  });
});
