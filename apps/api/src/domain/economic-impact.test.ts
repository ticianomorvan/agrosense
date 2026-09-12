import {
  type CropCycle,
  estimateEconomicImpact,
  evaluatePlotAlert,
  type ForecastHour,
} from "@agrosense/contracts";
import { describe, expect, it } from "vitest";

describe("estimateEconomicImpact", () => {
  it("calculates expected loss for maize under frost at high risk", () => {
    // 100 ha * 8.5 t/ha = 850 t * 180 USD/t * 0.20 = 30,600 USD
    const impact = estimateEconomicImpact({
      areaHa: 100,
      cropCode: "maize",
      hazardKind: "frost",
      riskLevel: "high",
    });

    expect(impact.currency).toBe("USD");
    expect(impact.expectedYieldTonsPerHa).toBe(8.5);
    expect(impact.expectedPriceUsdPerTon).toBe(180);
    expect(impact.damageRate).toBe(0.2);
    expect(impact.exposedProductionTons).toBe(850);
    expect(impact.estimatedLossUsd).toBe(30600);
    expect(impact.methodologyVersion).toBe("demo-v1");
  });

  it("calculates expected loss for soybean under extreme-heat at critical risk", () => {
    // 50 ha * 3.2 t/ha = 160 t * 360 USD/t * 0.55 = 31,680 USD
    const impact = estimateEconomicImpact({
      areaHa: 50,
      cropCode: "soybean",
      hazardKind: "extreme-heat",
      riskLevel: "critical",
    });

    expect(impact.currency).toBe("USD");
    expect(impact.expectedYieldTonsPerHa).toBe(3.2);
    expect(impact.expectedPriceUsdPerTon).toBe(360);
    expect(impact.damageRate).toBe(0.55);
    expect(impact.exposedProductionTons).toBe(160);
    expect(impact.estimatedLossUsd).toBe(31680);
    expect(impact.methodologyVersion).toBe("demo-v1");
  });

  it("evaluates plot alert and populates lossEstimate when plot area and active crop cycle exist", () => {
    const plotId = "44444444-4444-4444-8444-444444444444";
    const now = "2026-09-12T00:00:00Z";
    const hours: ForecastHour[] = [
      {
        at: "2026-09-12T04:00:00Z",
        temperatureC: -2,
        windGustKmh: null,
        precipitationMm: null,
        precipitationProbability: null,
        weatherCode: null,
      },
    ];

    const cycle: CropCycle = {
      id: "22222222-2222-4222-8222-222222222222",
      plotId,
      cropCode: "maize",
      seasonLabel: "2026/27",
      sownOn: "2026-08-01",
      stageCode: "V6",
      stageAsOf: "2026-09-05",
      endedOn: null,
      updatedAt: "2026-09-05T12:00:00Z",
    };

    const alert = evaluatePlotAlert({
      plot: { id: plotId, areaHa: 100, activeCropCycle: cycle },
      event: {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "frost",
        status: "active",
        startsAt: "2026-09-12T04:00:00Z",
        endsAt: "2026-09-12T05:00:00Z",
        evidence: {
          schemaVersion: 1,
          scope: "farm_demo",
          plotIds: [plotId],
          forecastDate: "2026-09-12",
          samplePoint: null,
          source: {
            code: "demo",
            url: null,
            issuedAt: null,
            retrievedAt: now,
            isDemo: true,
          },
          temperatureHeightM: 2,
          detectionThresholdC: 0,
          hours,
        },
      },
      now,
    });

    expect(alert.assessmentState).toBe("evaluated");
    expect(alert.riskLevel).toBe("high");
    expect(alert.lossEstimate).toBeDefined();
    expect(alert.lossEstimate?.estimatedLossUsd).toBe(30600);
    expect(alert.inputSnapshot.lossEstimate).toBeDefined();
    expect(alert.inputSnapshot.lossEstimate?.estimatedLossUsd).toBe(30600);
  });

  it("yields null lossEstimate when plot area is omitted or crop cycle is missing", () => {
    const plotId = "44444444-4444-4444-8444-444444444444";
    const now = "2026-09-12T00:00:00Z";
    const hours: ForecastHour[] = [
      {
        at: "2026-09-12T04:00:00Z",
        temperatureC: -2,
        windGustKmh: null,
        precipitationMm: null,
        precipitationProbability: null,
        weatherCode: null,
      },
    ];

    const alertNoArea = evaluatePlotAlert({
      plot: { id: plotId, activeCropCycle: null },
      event: {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "frost",
        status: "active",
        startsAt: "2026-09-12T04:00:00Z",
        endsAt: "2026-09-12T05:00:00Z",
        evidence: {
          schemaVersion: 1,
          scope: "farm_demo",
          plotIds: [plotId],
          forecastDate: "2026-09-12",
          samplePoint: null,
          source: {
            code: "demo",
            url: null,
            issuedAt: null,
            retrievedAt: now,
            isDemo: true,
          },
          temperatureHeightM: 2,
          detectionThresholdC: 0,
          hours,
        },
      },
      now,
    });

    expect(alertNoArea.lossEstimate).toBeNull();
    expect(alertNoArea.inputSnapshot.lossEstimate).toBeNull();
  });
});
