import type { EventEvidence, PlotForecast } from "@agrosense/contracts";
import { describe, expect, it } from "vitest";
import { buildPublication } from "./publication";

const forecast: PlotForecast = {
  plotId: "11111111-1111-4111-8111-111111111111",
  samplePoint: { type: "Point", coordinates: [-64, -31] },
  source: {
    code: "demo",
    url: null,
    issuedAt: null,
    retrievedAt: "2026-09-12T00:00:00.000Z",
    isDemo: true,
  },
  temperatureHeightM: 2,
  hours: [
    {
      at: "2026-09-12T00:00:00.000Z",
      temperatureC: -2,
      windGustKmh: null,
      precipitationMm: null,
      precipitationProbability: null,
      weatherCode: null,
    },
  ],
};

describe("refresh publication", () => {
  it("builds deterministic alerts from event evidence", () => {
    const evidence = {
      schemaVersion: 1,
      scope: "farm_demo",
      plotIds: [forecast.plotId],
      forecastDate: "2026-09-12",
      samplePoint: null,
      source: forecast.source,
      temperatureHeightM: 2,
      detectionThresholdC: 0,
      hours: forecast.hours,
    } satisfies EventEvidence;
    const detect = () => [
      {
        sourceEventKey: "demo:frost:2026-09-12",
        kind: "frost" as const,
        title: "Alerta de Helada (2026-09-12)",
        startsAt: "2026-09-12T00:00:00.000Z",
        endsAt: "2026-09-12T01:00:00.000Z",
        evidence,
      },
    ];
    const cycle = {
      id: "22222222-2222-4222-8222-222222222222",
      plotId: forecast.plotId,
      cropCode: "maize" as const,
      stageCode: "V6",
      stageAsOf: "2026-09-10",
      sownOn: "2026-09-01",
      endedOn: null,
      updatedAt: "2026-09-10T00:00:00.000Z",
    };
    const first = buildPublication({
      forecasts: [forecast],
      cycles: [cycle],
      now: "2026-09-12T00:00:00.000Z",
      detect,
    });
    const second = buildPublication({
      forecasts: [forecast],
      cycles: [cycle],
      now: "2026-09-12T00:00:00.000Z",
      detect,
    });
    expect(first).toEqual(second);
    expect(first[0]?.alerts[0]?.riskLevel).toBe("high");
    expect(first[0]?.alerts[0]?.matchedRuleCodes).toEqual(["demo-maize-v6"]);
  });
});
