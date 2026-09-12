import type { DashboardResponse } from "@agrosense/contracts";
import { dashboardResponseSchema } from "@agrosense/contracts";
import type { Database } from "./database.types";
import { iso, json } from "./database-utils";
import type { createUserClient } from "./supabase";

type FarmRow = Database["public"]["Tables"]["farms"]["Row"];
type PlotRow = Database["public"]["Tables"]["plots"]["Row"];
type CycleRow = Database["public"]["Tables"]["crop_cycles"]["Row"];
type EventRow = Database["public"]["Tables"]["events"]["Row"];
type AlertRow = Database["public"]["Tables"]["plot_alerts"]["Row"];

type DashboardClient = ReturnType<typeof createUserClient>;

function temporalState(
  asOf: string,
  startsAt: string,
  endsAt: string,
): "upcoming" | "ongoing" | "recent" {
  if (asOf < startsAt) return "upcoming";
  if (asOf < endsAt) return "ongoing";
  return "recent";
}

function alertIsStale(
  alert: AlertRow,
  currentCycle: CycleRow | undefined,
  asOf: string,
): boolean {
  const snapshot = json<{
    cropCycle: { id: string; updatedAt: string } | null;
    ruleSetVersion: string;
  }>(alert.input_snapshot);
  return (
    asOf >= alert.valid_until ||
    snapshot.ruleSetVersion !== alert.rule_version ||
    snapshot.cropCycle?.id !== currentCycle?.id ||
    snapshot.cropCycle?.updatedAt !==
      (currentCycle ? iso(currentCycle.updated_at) : undefined)
  );
}

export function projectDashboard(
  farm: FarmRow,
  plots: PlotRow[],
  cycles: CycleRow[],
  events: EventRow[],
  alerts: AlertRow[],
  asOf = new Date().toISOString(),
): DashboardResponse {
  const currentCycles = new Map(
    cycles
      .filter((cycle) => cycle.ended_on === null)
      .map((cycle) => [cycle.plot_id, cycle]),
  );
  const plotIds = new Set(plots.map((plot) => plot.id));
  const projectedAlerts = new Map<
    string,
    DashboardResponse["events"][number]["alerts"]
  >();

  for (const alert of alerts) {
    if (!plotIds.has(alert.plot_id)) continue;
    const cycle = currentCycles.get(alert.plot_id);
    const projected = {
      id: alert.id,
      plotId: alert.plot_id,
      eventId: alert.event_id,
      assessmentState: alert.assessment_state as
        | "evaluated"
        | "insufficient_data"
        | "no_applicable_rule",
      riskLevel: alert.risk_level as
        | "low"
        | "moderate"
        | "high"
        | "critical"
        | null,
      reason: alert.reason,
      recommendedActions: json<string[]>(alert.recommended_actions),
      ruleVersion: alert.rule_version,
      generatedAt: iso(alert.generated_at),
      validUntil: iso(alert.valid_until),
      generationMethod: alert.generation_method as "template" | "llm",
      inputSnapshot: json<
        DashboardResponse["events"][number]["alerts"][number]["inputSnapshot"]
      >(alert.input_snapshot),
      isStale: alertIsStale(alert, cycle, asOf),
    };
    const eventAlerts = projectedAlerts.get(alert.event_id) ?? [];
    eventAlerts.push(projected);
    projectedAlerts.set(alert.event_id, eventAlerts);
  }

  const projectedEvents = events
    .map((event) => {
      const evidence = json<DashboardResponse["events"][number]["evidence"]>(
        event.evidence,
      );
      const startsAt = iso(event.starts_at);
      const endsAt = iso(event.ends_at);
      return {
        id: event.id,
        kind: event.kind as "frost" | "severe-storm" | "hail" | "extreme-heat",
        title: event.title,
        startsAt,
        endsAt,
        status: event.status as "active" | "cancelled",
        temporalState: temporalState(asOf, startsAt, endsAt),
        source: evidence.source,
        evidence,
        alerts: projectedAlerts.get(event.id) ?? [],
      };
    })
    .filter((event) => event.alerts.length > 0 || event.status === "active")
    .sort((left, right) => {
      const rank = { ongoing: 0, upcoming: 1, recent: 2 };
      return (
        rank[left.temporalState] - rank[right.temporalState] ||
        (left.temporalState === "recent"
          ? right.startsAt.localeCompare(left.startsAt)
          : left.startsAt.localeCompare(right.startsAt)) ||
        left.id.localeCompare(right.id)
      );
    });

  const forecast = farm.forecast_summary
    ? json<DashboardResponse["forecast"]>(farm.forecast_summary)
    : null;
  const forecastValidUntil = forecast
    ? (forecast.plots
        .map((plot) => {
          const retrievedDeadline = new Date(plot.source.retrievedAt);
          retrievedDeadline.setMinutes(retrievedDeadline.getMinutes() + 60);
          const issuedDeadline = plot.source.issuedAt
            ? new Date(plot.source.issuedAt)
            : null;
          if (issuedDeadline)
            issuedDeadline.setHours(issuedDeadline.getHours() + 6);
          return (
            issuedDeadline && issuedDeadline < retrievedDeadline
              ? issuedDeadline
              : retrievedDeadline
          ).toISOString();
        })
        .sort()[0] ?? null)
    : null;
  const hasStaleActiveAlert = projectedEvents.some(
    (event) =>
      event.status === "active" &&
      event.temporalState !== "recent" &&
      event.alerts.some(
        (alert) => alert.isStale && alert.assessmentState === "evaluated",
      ),
  );
  const status =
    farm.last_error_code !== null
      ? "failed"
      : forecast === null
        ? "never_refreshed"
        : farm.last_success_at === null ||
            (forecastValidUntil !== null && asOf >= forecastValidUntil) ||
            hasStaleActiveAlert
          ? "stale"
          : "fresh";

  const response = {
    schemaVersion: 1 as const,
    asOf,
    farm: {
      id: farm.id,
      name: farm.name,
      province: farm.province,
      locality: farm.locality,
      timezone: farm.timezone as "America/Argentina/Cordoba",
      dataMode: farm.data_mode as "demo" | "live",
      boundary: json<DashboardResponse["farm"]["boundary"]>(
        farm.boundary_geojson,
      ),
      declaredAreaHa: farm.declared_area_ha,
      dataVersion: farm.data_version,
    },
    plots: plots.map((plot) => {
      const activeCycle = currentCycles.get(plot.id);
      return {
        id: plot.id,
        name: plot.name,
        boundary: json<DashboardResponse["plots"][number]["boundary"]>(
          plot.boundary_geojson,
        ),
        samplePoint: json<DashboardResponse["plots"][number]["samplePoint"]>(
          plot.sample_point_geojson,
        ),
        declaredAreaHa: plot.declared_area_ha,
        activeCropCycle: activeCycle
          ? {
              id: activeCycle.id,
              plotId: plot.id,
              cropCode: activeCycle.crop_code as "maize" | "soybean",
              seasonLabel: activeCycle.season_label,
              sownOn: activeCycle.sown_on,
              stageCode: activeCycle.stage_code,
              stageAsOf: activeCycle.stage_as_of,
              endedOn: activeCycle.ended_on,
              updatedAt: iso(activeCycle.updated_at),
            }
          : null,
      };
    }),
    basemap: {
      status: "unavailable" as const,
      reason: "No basemap provider is configured.",
    },
    forecast,
    events: projectedEvents,
    monitoring: {
      status,
      lastAttemptAt: farm.last_attempt_at ? iso(farm.last_attempt_at) : null,
      lastSuccessAt: farm.last_success_at ? iso(farm.last_success_at) : null,
      lastErrorCode: farm.last_error_code as
        | "PROVIDER_TIMEOUT"
        | "PROVIDER_UNAVAILABLE"
        | "INVALID_PROVIDER_DATA"
        | "PAYLOAD_LIMIT_EXCEEDED"
        | "PUBLISH_FAILED"
        | null,
      forecastValidUntil,
    },
  };
  return dashboardResponseSchema.parse(response);
}

export async function loadDashboard(
  client: DashboardClient,
  farmId: string,
  asOf = new Date().toISOString(),
) {
  const snapshotResult = await client.rpc("get_farm_dashboard_snapshot", {
    p_farm_id: farmId,
  });
  if (snapshotResult.error) throw snapshotResult.error;
  const snapshot = json<{
    farm: FarmRow | null;
    plots: PlotRow[];
    crop_cycles: CycleRow[];
    events: EventRow[];
    plot_alerts: AlertRow[];
  }>(snapshotResult.data);
  if (!snapshot.farm) return null;

  return projectDashboard(
    snapshot.farm,
    snapshot.plots,
    snapshot.crop_cycles,
    snapshot.events,
    snapshot.plot_alerts,
    asOf,
  );
}
