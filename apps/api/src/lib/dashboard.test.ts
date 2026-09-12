import { dashboardResponseSchema } from "@agrosense/contracts";
import { describe, expect, it } from "vitest";
import { projectDashboard } from "./dashboard";
import type { Database } from "./database.types";

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
  hours: [{ at: "2026-09-12T02:00:00.000Z", temperatureC: -1 }],
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
