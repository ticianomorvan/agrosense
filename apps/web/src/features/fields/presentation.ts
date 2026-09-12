import type {
  DashboardResponse,
  EventCard,
  PlotAlert,
} from "@agrosense/contracts";

type StatusVariant = "destructive" | "secondary" | "outline";

const riskPresentation = {
  high: { label: "High risk", badgeVariant: "destructive" },
  moderate: { label: "Moderate risk", badgeVariant: "secondary" },
  low: { label: "Low risk", badgeVariant: "outline" },
} satisfies Record<
  NonNullable<PlotAlert["riskLevel"]>,
  { label: string; badgeVariant: StatusVariant }
>;

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
  now = Date.now(),
): { alert: PlotAlert; event: EventCard } | undefined {
  const rank = { high: 3, moderate: 2, low: 1 };
  const asOf = Math.max(Date.parse(data.asOf), now);
  return data.events
    .flatMap((event) =>
      event.alerts
        .filter(
          (alert) =>
            alert.plotId === plotId &&
            event.status === "active" &&
            event.temporalState !== "recent" &&
            Date.parse(event.endsAt) > asOf &&
            !alert.isStale &&
            alert.assessmentState === "evaluated" &&
            Date.parse(alert.validUntil) > asOf,
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
  now = Date.now(),
): {
  label: string;
  badgeVariant: StatusVariant;
  reason: string;
  time: string | null;
} {
  const current = currentAlert(data, plotId, now);
  if (current) {
    return {
      ...riskPresentation[current.alert.riskLevel ?? "low"],
      reason: current.alert.reason,
      time: current.alert.generatedAt,
    };
  }
  const previous = data.events
    .flatMap((event) => event.alerts)
    .filter(
      (alert) =>
        alert.plotId === plotId && alert.assessmentState === "evaluated",
    )
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0];
  if (previous)
    return {
      label: "Risk unavailable",
      badgeVariant: "outline",
      reason:
        "The previous evaluation is no longer current. A current risk assessment is unavailable.",
      time: previous.generatedAt,
    };
  return {
    label: "Risk unavailable",
    badgeVariant: "outline",
    reason:
      data.monitoring.status === "never_refreshed"
        ? "No weather evaluation is available for this field."
        : "No current evaluated alert is available. This does not establish safe conditions.",
    time: data.monitoring.lastSuccessAt,
  };
}
