import { dashboardResponseSchema, pointSchema } from "@agrosense/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectDashboard } from "./dashboard";
import type { Database } from "./database.types";
import {
  detectThreatEvents,
  fetchOpenMeteoPlotForecast,
} from "./weather-provider";

afterEach(() => vi.unstubAllGlobals());

type Farm = Database["public"]["Tables"]["farms"]["Row"];
type Plot = Database["public"]["Tables"]["plots"]["Row"];
type Cycle = Database["public"]["Tables"]["crop_cycles"]["Row"];
type Event = Database["public"]["Tables"]["events"]["Row"];
type Alert = Database["public"]["Tables"]["plot_alerts"]["Row"];

const farmId = "11111111-1111-4111-8111-111111111111";
const plotId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";
const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ],
  ],
};
const point = { type: "Point", coordinates: [0.2, 0.2] };
const source = {
  code: "demo",
  url: null,
  issuedAt: null,
  retrievedAt: "2026-09-12T00:00:00.000Z",
  isDemo: true,
};
const evidence = {
  schemaVersion: 1,
  scope: "farm_demo",
  plotIds: [plotId],
  forecastDate: "2026-09-12",
  samplePoint: null,
  source,
  temperatureHeightM: 2,
  detectionThresholdC: 0,
  hours: [
    {
      at: "2026-09-12T02:00:00.000Z",
      temperatureC: -1,
      windGustKmh: null,
      precipitationMm: null,
      precipitationProbability: null,
      weatherCode: null,
    },
  ],
};

const farm: Farm = {
  id: farmId,
  owner_id: "44444444-4444-4444-8444-444444444444",
  name: "Demo farm",
  province: "Cordoba",
  locality: null,
  timezone: "America/Argentina/Cordoba",
  data_mode: "demo",
  boundary_geojson: polygon,
  declared_area_ha: 100,
  data_version: 1,
  forecast_summary: null,
  last_attempt_at: null,
  last_success_at: null,
  last_error_code: null,
  created_at: "2026-09-11T00:00:00.000Z",
  updated_at: "2026-09-11T00:00:00.000Z",
};
const plot: Plot = {
  id: plotId,
  farm_id: farmId,
  name: "North",
  boundary_geojson: polygon,
  sample_point_geojson: point,
  declared_area_ha: 10,
  created_at: "2026-09-11T00:00:00.000Z",
  updated_at: "2026-09-11T00:00:00.000Z",
};
const cycle: Cycle = {
  id: "55555555-5555-4555-8555-555555555555",
  plot_id: plotId,
  crop_code: "maize",
  season_label: "2026/27",
  sown_on: null,
  stage_code: null,
  stage_as_of: null,
  ended_on: null,
  created_at: "2026-09-11T00:00:00.000Z",
  updated_at: "2026-09-11T00:00:00.000Z",
};
const event: Event = {
  id: eventId,
  farm_id: farmId,
  source_code: "demo",
  source_event_key: "demo:frost:2026-09-12",
  kind: "frost",
  title: "Frost",
  starts_at: "2026-09-12T02:00:00.000Z",
  ends_at: "2026-09-12T03:00:00.000Z",
  issued_at: null,
  retrieved_at: "2026-09-12T00:00:00.000Z",
  source_url: null,
  status: "active",
  evidence,
  is_demo: true,
  created_at: "2026-09-12T00:00:00.000Z",
  updated_at: "2026-09-12T00:00:00.000Z",
};
const alert: Alert = {
  id: "66666666-6666-4666-8666-666666666666",
  farm_id: farmId,
  plot_id: plotId,
  event_id: eventId,
  assessment_state: "insufficient_data",
  risk_level: null,
  reason: "Unknown stage",
  recommended_actions: [],
  input_snapshot: {
    schemaVersion: 1,
    plotId,
    cropCycle: null,
    event: {
      id: eventId,
      status: "active",
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      evidence,
    },
    ruleSetVersion: "demo-v1",
    matchedRuleCodes: [],
    generation: { method: "template", modelId: null, promptVersion: null },
  },
  rule_version: "demo-v1",
  generated_at: "2026-09-12T00:00:00.000Z",
  valid_until: "2026-09-13T00:00:00.000Z",
  generation_method: "template",
  created_at: "2026-09-12T00:00:00.000Z",
  updated_at: "2026-09-12T00:00:00.000Z",
};

describe("dashboard projection", () => {
  it("projects the documented response and derives temporal state", () => {
    const response = projectDashboard(
      farm,
      [plot],
      [cycle],
      [event],
      [alert],
      "2026-09-12T01:00:00.000Z",
    );
    expect(
      dashboardResponseSchema.parse(response).events[0]?.temporalState,
    ).toBe("upcoming");
    expect(response.basemap.status).toBe("unavailable");
    expect(response.monitoring.status).toBe("never_refreshed");
  });

  it("marks an evaluated alert stale when its cycle changed", () => {
    const evaluated = {
      ...alert,
      assessment_state: "evaluated" as const,
      risk_level: "high" as const,
      recommended_actions: ["Review the plot"],
      input_snapshot: {
        schemaVersion: 1,
        plotId,
        event: {
          id: eventId,
          status: "active",
          startsAt: event.starts_at,
          endsAt: event.ends_at,
          evidence,
        },
        ruleSetVersion: "demo-v1",
        matchedRuleCodes: [],
        generation: { method: "template", modelId: null, promptVersion: null },
        cropCycle: {
          id: "77777777-7777-4777-8777-777777777777",
          plotId,
          cropCode: "maize",
          seasonLabel: "2026/27",
          sownOn: null,
          stageCode: null,
          stageAsOf: null,
          endedOn: null,
          updatedAt: "2026-09-10T00:00:00.000Z",
        },
      },
    };
    const response = projectDashboard(
      farm,
      [plot],
      [cycle],
      [event],
      [evaluated],
      "2026-09-12T01:00:00.000Z",
    );
    expect(response.events[0]?.alerts[0]?.isStale).toBe(true);
  });
});

it("preserves adapter measurements and all four hazards through the dashboard contract", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        hourly: {
          time: [
            "2026-09-12T00:00",
            "2026-09-12T01:00",
            "2026-09-12T02:00",
            "2026-09-12T03:00",
          ],
          temperature_2m: [0, 35, 10, 10],
          wind_gusts_10m: [null, null, 60, null],
          precipitation: [null, null, 24.99, null],
          precipitation_probability: [null, null, 80, null],
          weather_code: [null, null, null, 96],
        },
      }),
    ),
  );
  const forecast = await fetchOpenMeteoPlotForecast({
    plotId,
    samplePoint: pointSchema.parse(point),
  });
  const detected = detectThreatEvents(forecast);
  const storedEvents: Event[] = detected.map((threat, index) => ({
    ...event,
    id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
    source_event_key: threat.sourceEventKey,
    kind: threat.kind,
    title: threat.title,
    starts_at: threat.startsAt,
    ends_at: threat.endsAt,
    source_code: forecast.source.code,
    source_url: forecast.source.url,
    issued_at: forecast.source.issuedAt,
    retrieved_at: forecast.source.retrievedAt,
    is_demo: false,
    evidence: { ...threat.evidence, samplePoint: point },
  }));
  const result = projectDashboard(
    {
      ...farm,
      data_mode: "live",
      last_attempt_at: forecast.source.retrievedAt,
      last_success_at: forecast.source.retrievedAt,
      forecast_summary: {
        schemaVersion: 1,
        fetchedAt: forecast.source.retrievedAt,
        windowStart: "2026-09-12T00:00:00.000Z",
        windowEnd: "2026-09-12T04:00:00.000Z",
        plots: [{ ...forecast, samplePoint: point }],
      },
    },
    [plot],
    [],
    storedEvents,
    [],
    forecast.source.retrievedAt,
  );
  expect(result.forecast?.plots[0]?.hours).toEqual(forecast.hours);
  expect(result.events).toHaveLength(4);
  for (const threat of detected) {
    expect(
      result.events.find((item) => item.kind === threat.kind)?.evidence,
    ).toEqual(threat.evidence);
  }
});

describe("dashboard freshness", () => {
  const snapshotCycle = {
    id: cycle.id,
    plotId,
    cropCode: cycle.crop_code,
    seasonLabel: cycle.season_label,
    sownOn: null,
    stageCode: null,
    stageAsOf: null,
    endedOn: null,
    updatedAt: cycle.updated_at,
  };
  const snapshot = {
    schemaVersion: 1,
    plotId,
    cropCycle: snapshotCycle,
    event: {
      id: eventId,
      status: event.status,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      evidence,
    },
    ruleSetVersion: "demo-v1",
    matchedRuleCodes: [],
    generation: { method: "template", modelId: null, promptVersion: null },
  };

  it.each([
    ["2026-09-11T00:00:00Z", "2026-09-11T00:00:00.000+00:00", false],
    ["2026-09-11T00:00:00.123456Z", "2026-09-10T21:00:00.123456-03:00", false],
    ["2026-09-11T00:00:00.123456Z", "2026-09-11T00:00:00.123457+00:00", true],
  ])("compares snapshot %s with stored %s", (savedAt, updatedAt, stale) => {
    const response = projectDashboard(
      farm,
      [plot],
      [{ ...cycle, updated_at: updatedAt }],
      [event],
      [
        {
          ...alert,
          input_snapshot: {
            ...snapshot,
            cropCycle: { ...snapshotCycle, updatedAt: savedAt },
          },
        },
      ],
      "2026-09-12T00:30:00Z",
    );
    expect(response.events[0]?.alerts[0]?.isStale).toBe(stale);
  });

  it("preserves microseconds in the public cycle timestamp", () => {
    const response = projectDashboard(
      farm,
      [plot],
      [{ ...cycle, updated_at: "2026-09-11T00:00:00.123456+00:00" }],
      [],
      [],
    );
    expect(response.plots[0]?.activeCropCycle?.updatedAt).toBe(
      "2026-09-11T00:00:00.123456Z",
    );
  });

  it.each([
    ["2026-09-12T00:30:00.123455Z", false],
    ["2026-09-12T00:30:00.123456Z", true],
    ["2026-09-12T00:30:00.123457Z", true],
  ])("expires an alert at its exact deadline: %s", (asOf, stale) => {
    const response = projectDashboard(
      farm,
      [plot],
      [],
      [event],
      [{ ...alert, valid_until: "2026-09-11T21:30:00.123456-03:00" }],
      asOf,
    );
    expect(response.events[0]?.alerts[0]?.isStale).toBe(stale);
  });

  const refreshedFarm: Farm = {
    ...farm,
    last_attempt_at: source.retrievedAt,
    last_success_at: source.retrievedAt,
    forecast_summary: {
      schemaVersion: 1,
      fetchedAt: source.retrievedAt,
      windowStart: "2026-09-12T02:00:00Z",
      windowEnd: "2026-09-12T03:00:00Z",
      plots: [
        {
          plotId,
          samplePoint: point,
          source,
          temperatureHeightM: 2,
          hours: evidence.hours,
        },
      ],
    },
  };

  it.each(["insufficient_data", "no_applicable_rule"])(
    "marks monitoring stale when a %s assessment loses its crop context",
    (assessmentState) => {
      const response = projectDashboard(
        refreshedFarm,
        [plot],
        [cycle],
        [event],
        [{ ...alert, assessment_state: assessmentState }],
        "2026-09-12T00:30:00Z",
      );
      expect(response.events[0]?.alerts[0]?.isStale).toBe(true);
      expect(response.monitoring.status).toBe("stale");
    },
  );

  it.each([
    ["2026-09-12T00:59:59.999Z", "fresh"],
    ["2026-09-12T01:00:00Z", "stale"],
  ])("derives forecast freshness at %s", (asOf, status) => {
    expect(
      projectDashboard(refreshedFarm, [plot], [], [], [], asOf).monitoring
        .status,
    ).toBe(status);
  });
});

describe("dashboard payload limits", () => {
  it("rejects a response whose UTF-8 encoding exceeds one MiB", () => {
    const oversized = {
      ...alert,
      assessment_state: "evaluated",
      risk_level: "high" as const,
      recommended_actions: ["é".repeat(512 * 1024)],
    };
    expect(() =>
      projectDashboard(farm, [plot], [], [event], [oversized]),
    ).toThrow("Dashboard exceeds its payload limits");
  });

  it.each([
    [2500, false],
    [2501, true],
  ])(
    "bounds aggregate polygon positions: %i per polygon",
    (positions, exceeds) => {
      const vertices = Array.from({ length: positions - 1 }, (_, index) => {
        const angle = (2 * Math.PI * index) / (positions - 1);
        return [Math.cos(angle), Math.sin(angle)];
      });
      const boundary = {
        type: "Polygon",
        coordinates: [[...vertices, vertices[0] ?? [1, 0]]],
      };
      const project = () =>
        projectDashboard(
          { ...farm, boundary_geojson: boundary },
          [{ ...plot, boundary_geojson: boundary }],
          [],
          [],
          [],
        );
      if (exceeds)
        expect(project).toThrow("Dashboard exceeds its payload limits");
      else expect(project).not.toThrow();
    },
  );
});

describe("dashboard polygon contract", () => {
  const dashboard = projectDashboard(farm, [plot], [], [], []);
  const acceptsRing = (ring: number[][]) =>
    dashboardResponseSchema.safeParse({
      ...dashboard,
      farm: {
        ...dashboard.farm,
        boundary: { type: "Polygon", coordinates: [ring] },
      },
    }).success;

  it.each([
    { name: "empty ring", ring: [] },
    {
      name: "too few positions",
      ring: [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
    },
    {
      name: "open ring",
      ring: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
    {
      name: "collinear vertices",
      ring: [
        [0, 0],
        [1, 0],
        [2, 0],
        [0, 0],
      ],
    },
    {
      name: "crossing edges",
      ring: [
        [0, 0],
        [2, 2],
        [0, 2],
        [2, 0],
        [0, 0],
      ],
    },
    {
      name: "repeated interior vertex",
      ring: [
        [0, 0],
        [2, 0],
        [1, 1],
        [2, 0],
        [0, 2],
        [0, 0],
      ],
    },
    {
      name: "vertex touching another edge",
      ring: [
        [0, 0],
        [2, 0],
        [2, 2],
        [1, 0],
        [0, 2],
        [0, 0],
      ],
    },
    {
      name: "adjacent overlapping edges",
      ring: [
        [0, 0],
        [2, 0],
        [1, 0],
        [2, 2],
        [0, 0],
      ],
    },
    {
      name: "overlap across closing vertex",
      ring: [
        [1, 0],
        [2, 0],
        [2, 2],
        [3, 0],
        [1, 0],
      ],
    },
  ])("rejects $name", ({ ring }) => {
    expect(acceptsRing(ring)).toBe(false);
  });

  it.each([
    {
      name: "clockwise triangle",
      ring: [
        [0, 0],
        [0, 1],
        [1, 0],
        [0, 0],
      ],
    },
    {
      name: "counterclockwise triangle",
      ring: [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 0],
      ],
    },
    {
      name: "concave field",
      ring: [
        [0, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 2],
        [0, 2],
        [0, 0],
      ],
    },
    {
      name: "straight intermediate vertex",
      ring: [
        [0, 0],
        [1, 0],
        [2, 0],
        [2, 2],
        [0, 0],
      ],
    },
    {
      name: "small field away from the origin",
      ring: [
        [-64, -31],
        [-63.99999999, -31],
        [-64, -30.99999999],
        [-64, -31],
      ],
    },
  ])("accepts $name", ({ ring }) => {
    expect(acceptsRing(ring)).toBe(true);
  });

  it("rejects rings over the position limit", () => {
    const ring = Array.from({ length: 5000 }, (_, index) => [
      Math.cos((index / 5000) * Math.PI * 2),
      Math.sin((index / 5000) * Math.PI * 2),
    ]);
    ring.push([1, 0]);
    expect(acceptsRing(ring)).toBe(false);
  });
});
