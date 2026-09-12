import {
  compareInstants,
  type DashboardResponse,
  type EventCard,
  type PlotAlert,
} from "@agrosense/contracts";

type EvaluatedAlert = PlotAlert & {
  assessmentState: "evaluated";
  riskLevel: NonNullable<PlotAlert["riskLevel"]>;
};

const riskRank = { critical: 4, high: 3, moderate: 2, low: 1 };

// Browser clocks have millisecond precision; never expire a sub-ms deadline early.
export function deadlineMilliseconds(instant: string) {
  const submillisecond = /\.\d{3}(\d+)Z$/.exec(instant)?.[1] ?? "";
  return Date.parse(instant) + (/[1-9]/.test(submillisecond) ? 1 : 0);
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
        riskRank[b.alert.riskLevel] - riskRank[a.alert.riskLevel] ||
        a.alert.id.localeCompare(b.alert.id),
    )[0];
}
export function plotStatus(
  data: DashboardResponse,
  plotId: string,
  now = Date.now(),
): {
  isCurrent: boolean;
  reason: string;
  time: string | null;
  assessment?: { alert: PlotAlert; event: EventCard };
} {
  const current = currentAlert(data, plotId, now);
  if (current) {
    return {
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
      reason:
        previous.alert.assessmentState === "evaluated"
          ? "The previous evaluation is no longer current. A current risk assessment is unavailable."
          : previous.alert.reason,
      time: previous.alert.generatedAt,
      assessment: previous,
    };
  return {
    isCurrent: false,
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
