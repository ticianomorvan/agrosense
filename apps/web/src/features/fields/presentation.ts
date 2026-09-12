import type {
  DashboardResponse,
  EventCard,
  PlotAlert,
} from "@agrosense/contracts";
import type { Tone } from "../../components/ui";

export function formatInstant(value: string | null) {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Argentina/Cordoba",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
export function currentAlert(
  data: DashboardResponse,
  plotId: string,
): { alert: PlotAlert; event: EventCard } | undefined {
  const rank = { high: 3, moderate: 2, low: 1 };
  return data.events
    .flatMap((event) =>
      event.alerts
        .filter(
          (alert) =>
            alert.plotId === plotId &&
            event.status === "active" &&
            event.temporalState !== "recent" &&
            !alert.isStale &&
            alert.assessmentState === "evaluated" &&
            Date.parse(alert.validUntil) > Date.parse(data.asOf),
        )
        .map((alert) => ({ alert, event })),
    )
    .sort(
      (a, b) =>
        rank[b.alert.riskLevel ?? "low"] - rank[a.alert.riskLevel ?? "low"] ||
        a.alert.id.localeCompare(b.alert.id),
    )[0];
}
export function plotStatus(
  data: DashboardResponse,
  plotId: string,
): { label: string; tone: Tone; reason: string; time: string | null } {
  const current = currentAlert(data, plotId);
  if (current) {
    const level = current.alert.riskLevel;
    return {
      label: `${level === "high" ? "High" : level === "moderate" ? "Moderate" : "Low"} risk`,
      tone:
        level === "high" ? "critical" : level === "moderate" ? "warning" : "ok",
      reason: current.alert.reason,
      time: current.alert.generatedAt,
    };
  }
  return {
    label: "Risk unavailable",
    tone: "unknown",
    reason:
      data.monitoring.status === "never_refreshed"
        ? "No weather evaluation is available for this field."
        : "No current evaluated alert is available. This does not establish safe conditions.",
    time: data.monitoring.lastSuccessAt,
  };
}
