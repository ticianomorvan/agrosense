import type {
  CropCycle,
  EventEvidence,
  PlotForecast,
} from "@agrosense/contracts";
import { describe, expect, it } from "vitest";
import { buildPublication } from "./publication";
import { detectThreatEvents } from "./weather-provider";

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
      seasonLabel: "2026/27",
      stageCode: "V6" as const,
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
    expect(first[0]?.alerts[0]).toMatchObject({
      ruleVersion: "demo-v1",
      inputSnapshot: { matchedRuleCodes: ["demo-maize-v6"], cropCycle: cycle },
    });
  });

  const cycle: CropCycle = {
    id: "22222222-2222-4222-8222-222222222222",
    plotId: forecast.plotId,
    cropCode: "maize",
    seasonLabel: "2026/27",
    stageCode: "V6",
    stageAsOf: "2026-09-10",
    sownOn: "2026-09-01",
    endedOn: null,
    updatedAt: "2026-09-10T00:00:00.000000Z",
  };
  const build = (forecasts: PlotForecast[], cycles = [cycle]) =>
    buildPublication({
      forecasts,
      cycles,
      now: "2026-09-12T00:00:00.000Z",
      detect: detectThreatEvents,
    });

  it("does not evaluate live hazards with synthetic rules", () => {
    const live: PlotForecast = {
      ...forecast,
      source: {
        ...forecast.source,
        code: "open_meteo",
        isDemo: false,
        url: "https://open-meteo.com",
      },
    };
    expect(build([live])[0]?.alerts[0]).toMatchObject({
      assessmentState: "no_applicable_rule",
      riskLevel: null,
      recommendedActions: [],
    });
  });

  it("treats old observations as insufficient even when sowing is unknown", () => {
    expect(
      build(
        [forecast],
        [{ ...cycle, sownOn: null, stageAsOf: "2026-08-01" }],
      )[0]?.alerts[0],
    ).toMatchObject({
      assessmentState: "insufficient_data",
      riskLevel: null,
      recommendedActions: [],
    });
  });

  it("groups demo evidence and snapshots across all affected plots", () => {
    const second = {
      ...forecast,
      plotId: "33333333-3333-4333-8333-333333333333",
    };
    const events = build([forecast, second]);
    expect(events).toHaveLength(1);
    expect(events[0]?.evidence.plotIds).toEqual([
      forecast.plotId,
      second.plotId,
    ]);
    expect(events[0]?.alerts).toHaveLength(2);
    for (const alert of events[0]?.alerts ?? []) {
      expect(alert).toMatchObject({
        inputSnapshot: { event: { evidence: events[0]?.evidence } },
      });
    }
  });

  it("withdraws a covered hazard and clears its evaluated risk", () => {
    const previousEvents = build([forecast]);
    const clear = {
      ...forecast,
      source: { ...forecast.source, retrievedAt: "2026-09-12T00:02:00.000Z" },
      hours: forecast.hours.map((h) => ({ ...h, temperatureC: 8 })),
    };
    const params = {
      forecasts: [clear],
      cycles: [cycle],
      now: "2026-09-12T00:02:00.000Z",
      detect: detectThreatEvents,
      previousEvents,
    };
    const events = buildPublication(params);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      status: "cancelled",
      startsAt: previousEvents[0]?.startsAt,
      endsAt: previousEvents[0]?.endsAt,
    });
    expect(events[0]?.alerts[0]).toMatchObject({
      assessmentState: "no_applicable_rule",
      riskLevel: null,
      recommendedActions: [],
      reason: "Forecast withdrawn by newer data.",
      inputSnapshot: {
        event: {
          status: "cancelled",
          evidence: { source: clear.source, hours: clear.hours },
        },
      },
    });
  });

  it("preserves an event when newer evidence only covers part of its interval", () => {
    const extended: PlotForecast = {
      ...forecast,
      hours: [
        ...forecast.hours,
        {
          ...forecast.hours[0],
          temperatureC: -2,
          windGustKmh: null,
          precipitationMm: null,
          precipitationProbability: null,
          weatherCode: null,
          at: "2026-09-12T01:00:00.000Z",
        },
      ],
    };
    const previousEvents = build([extended]);
    const clear = {
      ...forecast,
      source: { ...forecast.source, retrievedAt: "2026-09-12T00:02:00.000Z" },
      hours: forecast.hours.map((h) => ({ ...h, temperatureC: 8 })),
    };
    const params = {
      forecasts: [clear],
      cycles: [cycle],
      now: "2026-09-12T00:02:00.000Z",
      detect: detectThreatEvents,
      previousEvents,
    };
    expect(buildPublication(params)).toEqual([]);
  });
});
