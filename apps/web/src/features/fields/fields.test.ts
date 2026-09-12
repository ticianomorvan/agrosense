import {
  compareInstants,
  dashboardResponseSchema,
  deadlineMilliseconds,
  forecastHourSchema,
  satelliteRequestSchema,
} from "@agrosense/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultSatelliteWindow } from "../satellite/SatelliteControls";
import { subscribeToRiskClock } from "./clock";
import {
  assessmentSource,
  currentAlert,
  formatInstant,
  plotStatus,
} from "./presentation";
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(dashboardFixture.asOf));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("presents missing weather and risk as unavailable", () => {
  const data = dashboardResponseSchema.parse(dashboardFixture);
  expect(data.forecast).toBeNull();
  for (const plot of data.plots)
    expect(plotStatus(data, plot.id)).toMatchObject({
      label: "Risk unavailable",
      badgeVariant: "unknown",
      time: null,
    });
  expect(formatInstant(null)).toBe("Unavailable");
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

it("prepares a past 30-day imagery window for the initial dashboard", () => {
  expect(defaultSatelliteWindow(new Date("2026-09-12T12:00:00Z"))).toEqual({
    from: "2026-08-13T00:00:00Z",
    to: "2026-09-11T23:59:59Z",
  });
});

it("does not present expired, stale or cancelled assessments as current risk", () => {
  const data = createAlertDashboard();
  const plot = data.plots[0];
  if (!plot) throw new Error("Missing fixture plot");
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

function createAlertDashboard() {
  const data = structuredClone(dashboardFixture);
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
          recommendedActions: ["Synthetic test recommendation"],
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
  return data;
}

it("expires risk and recommendations when wall time reaches validUntil without a new response", () => {
  const data = createAlertDashboard();
  const alert = data.events[0]?.alerts[0];
  if (!alert) throw new Error("Missing test alert");
  const originalAsOf = data.asOf;
  vi.setSystemTime(Date.parse(alert.validUntil) - 1);
  expect(currentAlert(data, alert.plotId)?.alert.recommendedActions).toEqual([
    "Synthetic test recommendation",
  ]);
  vi.advanceTimersByTime(1);
  expect(currentAlert(data, alert.plotId)).toBeUndefined();
  expect(plotStatus(data, alert.plotId)).toMatchObject({
    label: "Risk unavailable",
    reason:
      "The previous evaluation is no longer current. A current risk assessment is unavailable.",
    time: alert.generatedAt,
  });
  expect(data.asOf).toBe(originalAsOf);
});

it("stops current recommendations when the event ends before the assessment expires", () => {
  const data = createAlertDashboard();
  const event = data.events[0];
  const alert = event?.alerts[0];
  if (!event || !alert) throw new Error("Missing test event");
  alert.validUntil = "2026-09-12T09:00:00Z";
  vi.setSystemTime(Date.parse(event.endsAt) - 1);
  expect(currentAlert(data, alert.plotId)).toBeDefined();
  vi.advanceTimersByTime(1);
  expect(currentAlert(data, alert.plotId)).toBeUndefined();
});

it("notifies at each deadline without a fetch and cancels timers on cleanup", () => {
  const data = createAlertDashboard();
  const event = data.events[0];
  const alert = event?.alerts[0];
  if (!event || !alert) throw new Error("Missing test event");
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
  const onTimeChange = vi.fn(
    (now: number) => plotStatus(data, alert.plotId, now).label,
  );
  const stop = subscribeToRiskClock(data, onTimeChange);
  vi.advanceTimersByTime(Date.parse(alert.validUntil) - Date.now() - 1);
  expect(onTimeChange).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onTimeChange).toHaveLastReturnedWith("Risk unavailable");
  vi.advanceTimersByTime(Date.parse(event.endsAt) - Date.now());
  expect(onTimeChange).toHaveBeenCalledTimes(2);
  stop();
  expect(vi.getTimerCount()).toBe(0);

  vi.setSystemTime(new Date(data.asOf));
  const cancelBeforeExpiry = subscribeToRiskClock(data, onTimeChange);
  expect(vi.getTimerCount()).toBe(1);
  cancelBeforeExpiry();
  vi.advanceTimersByTime(3 * 3600000);
  expect(onTimeChange).toHaveBeenCalledTimes(2);
});

it("rechecks immediately on visibility and focus after suspended timers, then removes listeners", () => {
  const data = createAlertDashboard();
  const alert = data.events[0]?.alerts[0];
  if (!alert) throw new Error("Missing test alert");
  const tab = new EventTarget();
  const documentState = Object.assign(new EventTarget(), {
    visibilityState: "hidden",
  });
  vi.stubGlobal("window", tab);
  vi.stubGlobal("document", documentState);
  const onTimeChange = vi.fn((now: number) =>
    currentAlert(data, alert.plotId, now),
  );
  const stop = subscribeToRiskClock(data, onTimeChange);
  // Move the clock without firing timers, as with a suspended page.
  vi.setSystemTime(new Date(alert.validUntil));
  documentState.dispatchEvent(new Event("visibilitychange"));
  expect(onTimeChange).not.toHaveBeenCalled();
  documentState.visibilityState = "visible";
  documentState.dispatchEvent(new Event("visibilitychange"));
  expect(onTimeChange).toHaveLastReturnedWith(undefined);
  tab.dispatchEvent(new Event("focus"));
  expect(onTimeChange).toHaveBeenCalledTimes(2);
  stop();
  documentState.dispatchEvent(new Event("visibilitychange"));
  tab.dispatchEvent(new Event("focus"));
  expect(onTimeChange).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves the supplied explanation and source for incomplete assessments", () => {
  const data = createAlertDashboard();
  const alert = data.events[0]?.alerts[0];
  if (!alert) throw new Error("Missing test assessment");
  alert.assessmentState = "insufficient_data";
  alert.riskLevel = null;
  alert.recommendedActions = [];
  alert.reason = "Declared growth stage is unavailable.";
  const status = plotStatus(data, alert.plotId);
  expect(status).toMatchObject({
    label: "Risk unavailable",
    reason: alert.reason,
    time: alert.generatedAt,
  });
  expect(status.assessment?.alert).toBe(alert);
  expect(assessmentSource(status)).toBe("Demonstration weather and risk data");
  expect(currentAlert(data, alert.plotId)).toBeUndefined();
});
it("retains expired evidence without restoring the recommendation", () => {
  const data = createAlertDashboard();
  const alert = data.events[0]?.alerts[0];
  if (!alert) throw new Error("Missing test assessment");
  vi.setSystemTime(new Date(alert.validUntil));
  const status = plotStatus(data, alert.plotId);
  expect(status.assessment?.alert.reason).toBe(alert.reason);
  expect(status.label).toBe("Risk unavailable");
  expect(currentAlert(data, alert.plotId)).toBeUndefined();
});
it("does not label a successful farm refresh as a plot evaluation", () => {
  const data = structuredClone(dashboardFixture);
  data.monitoring.lastSuccessAt = data.asOf;
  const plot = data.plots[0];
  if (!plot) throw new Error("Missing test plot");
  expect(plotStatus(data, plot.id).time).toBeNull();
});
it("notifies when forecast freshness expires even without alerts", () => {
  const data = structuredClone(dashboardFixture);
  data.monitoring.forecastValidUntil = "2026-09-12T07:00:00Z";
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
  const changed = vi.fn();
  const stop = subscribeToRiskClock(data, changed);
  vi.advanceTimersByTime(3600000);
  expect(changed).toHaveBeenCalledExactlyOnceWith(Date.now());
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("ranks critical risk above high and retains multiple recommended actions", () => {
  const data = createAlertDashboard();
  const critical = structuredClone(data.events[0]);
  const assessment = critical?.alerts[0];
  if (!critical || !assessment) throw new Error("Missing test assessment");
  critical.kind = "extreme-heat";
  assessment.riskLevel = "critical";
  assessment.recommendedActions = [
    "First supplied action",
    "Second supplied action",
  ];
  data.events.push(critical);
  expect(plotStatus(data, assessment.plotId)).toMatchObject({
    label: "Critical risk",
    badgeVariant: "destructive",
    isCurrent: true,
  });
  expect(
    currentAlert(data, assessment.plotId)?.alert.recommendedActions,
  ).toEqual(assessment.recommendedActions);
});
it("accepts empty farms and active events without assessments", () => {
  const data = createAlertDashboard();
  const event = data.events[0];
  if (!event) throw new Error("Missing test event");
  event.alerts = [];
  expect(dashboardResponseSchema.parse(data).events[0]?.alerts).toEqual([]);
  expect(
    dashboardResponseSchema.parse({ ...dashboardFixture, plots: [] }).plots,
  ).toEqual([]);
});
it("does not expire a PostgreSQL deadline before its fractional instant", () => {
  const data = createAlertDashboard();
  const alert = data.events[0]?.alerts[0];
  if (!alert) throw new Error("Missing test alert");
  data.asOf = "2026-09-12T07:00:00.123455Z";
  alert.validUntil = "2026-09-12T07:00:00.123456Z";
  vi.setSystemTime(Date.parse(data.asOf));
  expect(currentAlert(data, alert.plotId)).toBeDefined();
  expect(deadlineMilliseconds(alert.validUntil)).toBe(Date.now() + 1);
  vi.advanceTimersByTime(1);
  expect(currentAlert(data, alert.plotId)).toBeUndefined();
  expect(
    compareInstants("2026-09-12T07:00:00Z", "2026-09-12T07:00:00.000000Z"),
  ).toBe(0);
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
