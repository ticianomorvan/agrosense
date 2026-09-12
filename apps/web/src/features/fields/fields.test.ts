import {
  dashboardResponseSchema,
  satelliteRequestSchema,
} from "@agrosense/contracts";
import { expect, it } from "vitest";
import { demoDashboard } from "./demo";
import { formatInstant, plotStatus } from "./presentation";
import { createLiveSource, dashboardOptions } from "./queries";

it("keeps the demo honest about missing weather and risk", () => {
  const data = dashboardResponseSchema.parse(demoDashboard);
  expect(data.farm.dataMode).toBe("demo");
  expect(data.plots).toHaveLength(3);
  expect(data.forecast).toBeNull();
  for (const plot of data.plots)
    expect(plotStatus(data, plot.id)).toMatchObject({
      label: "Risk unavailable",
      tone: "unknown",
      time: null,
    });
  expect(formatInstant(null)).toBe("Unavailable");
});
it("rejects a crop-stage mismatch and missing nullable properties", () => {
  const wrong = structuredClone(demoDashboard);
  const cycle = wrong.plots[0]?.activeCropCycle;
  if (!cycle) throw new Error("Missing fixture crop cycle");
  cycle.stageCode = "R4";
  expect(dashboardResponseSchema.safeParse(wrong).success).toBe(false);
  const { forecast: _, ...incomplete } = demoDashboard;
  expect(dashboardResponseSchema.safeParse(incomplete).success).toBe(false);
});
it("partitions private dashboard caches by owner and farm", () => {
  const first = createLiveSource("owner-a", "farm-a", async () => "token");
  const second = createLiveSource("owner-b", "farm-a", async () => "token");
  expect(dashboardOptions(first).queryKey).not.toEqual(
    dashboardOptions(second).queryKey,
  );
});
it("rejects reversed, excessive and unexpected satellite request values", () => {
  for (const input of [
    { from: "2026-09-11T00:00:00Z", to: "2026-09-01T00:00:00Z" },
    { from: "2026-01-01T00:00:00Z", to: "2026-09-01T00:00:00Z" },
    { from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z", bbox: [] },
  ])
    expect(satelliteRequestSchema.safeParse(input).success).toBe(false);
});

it("does not present expired, stale or cancelled assessments as current risk", () => {
  const data = structuredClone(demoDashboard);
  const plot = data.plots[0];
  if (!plot) throw new Error("Missing fixture plot");
  const source = {
    code: "demo" as const,
    url: null,
    issuedAt: null,
    retrievedAt: data.asOf,
    isDemo: true,
  };
  const evidence = {
    schemaVersion: 1 as const,
    scope: "farm_demo" as const,
    plotIds: [plot.id],
    forecastDate: "2026-09-12",
    samplePoint: null,
    source,
    temperatureHeightM: 2 as const,
    detectionThresholdC: 0 as const,
    hours: [{ at: "2026-09-12T07:00:00Z", temperatureC: -1 }],
  };
  const event = {
    id: "44444444-4444-4444-8444-444444444444",
    status: "active" as const,
    startsAt: "2026-09-12T07:00:00Z",
    endsAt: "2026-09-12T08:00:00Z",
    evidence,
  };
  data.events = [
    {
      ...event,
      kind: "frost",
      title: "Synthetic test event",
      temporalState: "upcoming",
      source,
      alerts: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          plotId: plot.id,
          eventId: event.id,
          assessmentState: "evaluated",
          riskLevel: "high",
          reason: "Synthetic test reason",
          recommendation: "Synthetic test recommendation",
          ruleVersion: "test",
          generatedAt: data.asOf,
          validUntil: "2026-09-12T07:00:00Z",
          generationMethod: "template",
          isStale: false,
          inputSnapshot: {
            schemaVersion: 1,
            plotId: plot.id,
            cropCycle: plot.activeCropCycle,
            event,
            ruleSetVersion: "test",
            matchedRuleCodes: [],
            generation: {
              method: "template",
              modelId: null,
              promptVersion: null,
            },
          },
        },
      ],
    },
  ];
  expect(plotStatus(data, plot.id).label).toBe("High risk");
  const card = data.events[0];
  const alert = card?.alerts[0];
  if (!card || !alert) throw new Error("Missing test assessment");
  alert.isStale = true;
  expect(plotStatus(data, plot.id).label).toBe("Risk unavailable");
  alert.isStale = false;
  card.status = "cancelled";
  expect(plotStatus(data, plot.id).label).toBe("Risk unavailable");
  card.status = "active";
  data.asOf = alert.validUntil;
  expect(plotStatus(data, plot.id).label).toBe("Risk unavailable");
});
