import {
  compareInstants,
  type DashboardResponse,
  deadlineMilliseconds,
  type EventCard,
  type PlotAlert,
} from "@agrosense/contracts";

type EvaluatedAlert = PlotAlert & {
  assessmentState: "evaluated";
  riskLevel: NonNullable<PlotAlert["riskLevel"]>;
};

type StatusVariant = "destructive" | "warning" | "success" | "unknown";

const riskPresentation = {
  critical: { label: "Critical risk", badgeVariant: "destructive", rank: 4 },
  high: { label: "High risk", badgeVariant: "destructive", rank: 3 },
  moderate: { label: "Moderate risk", badgeVariant: "warning", rank: 2 },
  low: { label: "Low risk", badgeVariant: "success", rank: 1 },
} satisfies Record<
  NonNullable<PlotAlert["riskLevel"]>,
  { label: string; badgeVariant: StatusVariant; rank: number }
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
):
  | {
      alert: EvaluatedAlert;
      event: EventCard;
    }
  | undefined {
  return data.events
    .flatMap((event) =>
      event.alerts
        .filter(
          (alert): alert is EvaluatedAlert =>
            alert.riskLevel !== null &&
            alert.plotId === plotId &&
            event.status === "active" &&
            event.temporalState !== "recent" &&
            !isExpired(event.endsAt, data.asOf, now) &&
            !alert.isStale &&
            alert.assessmentState === "evaluated" &&
            !isExpired(alert.validUntil, data.asOf, now),
        )
        .map((alert) => ({ alert, event })),
    )
    .sort(
      (a, b) =>
        riskPresentation[b.alert.riskLevel].rank -
          riskPresentation[a.alert.riskLevel].rank ||
        a.alert.id.localeCompare(b.alert.id),
    )[0];
}
export function plotStatus(
  data: DashboardResponse,
  plotId: string,
  now = Date.now(),
): {
  isCurrent: boolean;
  label: string;
  badgeVariant: StatusVariant;
  reason: string;
  time: string | null;
  assessment?: { alert: PlotAlert; event: EventCard };
} {
  const current = currentAlert(data, plotId, now);
  if (current) {
    return {
      ...riskPresentation[current.alert.riskLevel],
      isCurrent: true,
      reason: current.alert.reason,
      time: current.alert.generatedAt,
      assessment: current,
    };
  }
  const previous = data.events
    .flatMap((event) => event.alerts.map((alert) => ({ event, alert })))
    .filter(({ alert }) => alert.plotId === plotId)
    .sort((a, b) =>
      compareInstants(b.alert.generatedAt, a.alert.generatedAt),
    )[0];
  if (previous)
    return {
      isCurrent: false,
      label: "Risk unavailable",
      badgeVariant: "unknown",
      reason:
        previous.alert.assessmentState === "evaluated"
          ? "The previous evaluation is no longer current. A current risk assessment is unavailable."
          : previous.alert.reason,
      time: previous.alert.generatedAt,
      assessment: previous,
    };
  return {
    isCurrent: false,
    label: "Risk unavailable",
    badgeVariant: "unknown",
    reason:
      data.monitoring.status === "never_refreshed"
        ? "No weather evaluation is available for this field."
        : "No current evaluated alert is available. This does not establish safe conditions.",
    time: null,
  };
}

export function assessmentSource(status: ReturnType<typeof plotStatus>) {
  if (!status.assessment) return "Unavailable";
  return status.assessment.event.source.isDemo
    ? "Demonstration weather and risk data"
    : "Open-Meteo weather";
}

function isExpired(deadline: string, asOf: string, now: number) {
  return (
    compareInstants(deadline, asOf) <= 0 ||
    deadlineMilliseconds(deadline) <= now
  );
}

export function forecastFreshness(data: DashboardResponse, now: number) {
  const deadline = data.monitoring.forecastValidUntil;
  if (!deadline) return "Forecast freshness unavailable.";
  const state = isExpired(deadline, data.asOf, now)
    ? "stale since"
    : "valid until";
  return `Forecast ${state} ${formatInstant(deadline)} (UTC−3).`;
}
