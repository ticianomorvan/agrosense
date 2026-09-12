import {
  dashboardResponseSchema,
  forecastHourSchema,
  satelliteRequestSchema,
} from "@agrosense/contracts";
import { expect, it } from "vitest";
import { defaultSatelliteWindow } from "../satellite/SatelliteControls";
import { formatInstant } from "./presentation";
import { createLiveSource, dashboardOptions } from "./queries";

function rectangle(west: number, south: number, east: number, north: number) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}
// Synthetic input used only by tests.
const observed = "2026-09-12T06:00:00Z";
const plotIds = ["22222222-2222-4222-8222-222222222221"];
const dashboardFixture = dashboardResponseSchema.parse({
  schemaVersion: 1,
  asOf: observed,
  farm: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Test farm",
    province: "Córdoba",
    locality: null,
    timezone: "America/Argentina/Cordoba",
    dataMode: "live",
    boundary: rectangle(-64.17, -31.47, -64.154, -31.456),
    declaredAreaHa: 235,
    dataVersion: 1,
  },
  plots: [
    {
      id: plotIds[0],
      name: "North field",
      boundary: rectangle(-64.17, -31.463, -64.154, -31.456),
      samplePoint: { type: "Point", coordinates: [-64.162, -31.4595] },
      declaredAreaHa: 118,
      activeCropCycle: {
        id: "33333333-3333-4333-8333-333333333331",
        plotId: plotIds[0],
        cropCode: "maize",
        seasonLabel: "2026/27",
        sownOn: null,
        stageCode: "V6",
        stageAsOf: "2026-09-11",
        endedOn: null,
        updatedAt: observed,
      },
    },
  ],
  basemap: {
    status: "unavailable",
    reason: "Satellite imagery has not been loaded.",
  },
  forecast: null,
  events: [],
  monitoring: {
    status: "never_refreshed",
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorCode: null,
    forecastValidUntil: null,
  },
});

it("formats observation times in Córdoba and labels missing times", () => {
  expect(formatInstant(null)).toBe("Unavailable");
  expect(formatInstant("2026-09-12T06:00:00Z")).toBe("12 Sept 2026, 03:00");
});
it("rejects a crop-stage mismatch and missing nullable properties", () => {
  const wrong = structuredClone(dashboardFixture);
  const cycle = wrong.plots[0]?.activeCropCycle;
  if (!cycle) throw new Error("Missing fixture crop cycle");
  cycle.stageCode = "R4";
  expect(dashboardResponseSchema.safeParse(wrong).success).toBe(false);
  const { forecast: _, ...incomplete } = dashboardFixture;
  expect(dashboardResponseSchema.safeParse(incomplete).success).toBe(false);
});
it("accepts empty farms and weather events without risk assessments", () => {
  expect(
    dashboardResponseSchema.parse({ ...dashboardFixture, plots: [] }).plots,
  ).toEqual([]);
  const source = {
    code: "open_meteo",
    url: "https://open-meteo.com/",
    issuedAt: null,
    retrievedAt: observed,
    isDemo: false,
  };
  const event = {
    id: "44444444-4444-4444-8444-444444444444",
    kind: "frost",
    title: "Frost forecast",
    status: "active",
    temporalState: "upcoming",
    startsAt: "2026-09-12T07:00:00Z",
    endsAt: "2026-09-12T08:00:00Z",
    source,
    evidence: {
      schemaVersion: 1,
      scope: "plot_forecast",
      plotIds,
      forecastDate: "2026-09-12",
      samplePoint: dashboardFixture.plots[0]?.samplePoint,
      source,
      temperatureHeightM: 2,
      detectionThresholdC: 0,
      hours: [
        {
          at: "2026-09-12T07:00:00Z",
          temperatureC: -1,
          windGustKmh: null,
          precipitationMm: null,
          precipitationProbability: null,
          weatherCode: null,
        },
      ],
    },
    alerts: [],
  };
  const data = dashboardResponseSchema.parse({
    ...dashboardFixture,
    events: [event],
  });
  expect(data.events[0]?.alerts).toEqual([]);
});
it("partitions private dashboard caches by owner and farm", () => {
  const first = createLiveSource("owner-a", "farm-a", async () => "token");
  const second = createLiveSource("owner-b", "farm-a", async () => "token");
  const otherFarm = createLiveSource("owner-a", "farm-b", async () => "token");
  expect(dashboardOptions(first).queryKey).not.toEqual(
    dashboardOptions(second).queryKey,
  );
  expect(dashboardOptions(first).queryKey).not.toEqual(
    dashboardOptions(otherFarm).queryKey,
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

it("prepares a past 30-day imagery window for the initial dashboard", () => {
  expect(defaultSatelliteWindow(new Date("2026-09-12T12:00:00Z"))).toEqual({
    from: "2026-08-13T00:00:00Z",
    to: "2026-09-11T23:59:59Z",
  });
});

it("rejects forecast samples offset from an exact hour by microseconds", () => {
  expect(
    forecastHourSchema.safeParse({
      at: "2026-09-12T07:00:00.000001Z",
      temperatureC: 1,
      windGustKmh: null,
      precipitationMm: null,
      precipitationProbability: null,
      weatherCode: null,
    }).success,
  ).toBe(false);
});
