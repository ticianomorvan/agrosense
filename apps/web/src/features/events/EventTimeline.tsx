import type { DashboardResponse, EventCard } from "@agrosense/contracts";
import { DataState } from "../../components/data-state";
import { Badge } from "../../components/ui/badge";
import { formatInstant } from "../fields/presentation";
import { timelineEventsForPlot } from "./timeline";

const kindLabels: Record<EventCard["kind"], string> = {
  frost: "Frost",
  "severe-storm": "Severe storm",
  hail: "Hail",
  "extreme-heat": "Extreme heat",
};

export function EventTimeline({
  data,
  plotId,
}: {
  data: DashboardResponse;
  plotId: string;
}) {
  const events = timelineEventsForPlot(data.events, plotId);
  return (
    <section
      className="min-w-0 space-y-4 rounded-xl border bg-card p-4"
      aria-labelledby="event-timeline-title"
    >
      <div className="space-y-1">
        <h2 id="event-timeline-title">Weather events</h2>
        <p className="text-sm leading-normal text-muted-foreground">
          Dated evidence, newest first. Alerts are delivered through WhatsApp.
        </p>
      </div>
      {events.length === 0 ? (
        <DataState title="No events available for this plot">
          No dated weather event has been recorded. This does not establish safe
          conditions.
        </DataState>
      ) : (
        <ol className="space-y-6">
          {events.map((event) => (
            <li
              className="space-y-2 border-l-2 border-primary pl-3"
              key={event.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={event.status === "cancelled" ? "unknown" : "info"}
                >
                  {eventLabel(event)}
                </Badge>
                <span className="text-sm leading-normal text-muted-foreground">
                  {kindLabels[event.kind]}
                </span>
              </div>
              <h3>{event.title}</h3>
              <dl className="grid gap-1 text-sm leading-normal tabular-nums">
                <div>
                  <dt className="inline text-muted-foreground">Starts: </dt>
                  <dd className="inline">{formatInstant(event.startsAt)}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Ends: </dt>
                  <dd className="inline">{formatInstant(event.endsAt)}</dd>
                </div>
              </dl>
              <p className="text-sm leading-normal text-muted-foreground tabular-nums">
                {event.source.isDemo
                  ? "Demonstration weather"
                  : "Open-Meteo weather"}{" "}
                · Retrieved {formatInstant(event.source.retrievedAt)} · Córdoba
                time (UTC−3)
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function eventLabel(event: EventCard) {
  if (event.status === "cancelled") return "Cancelled";
  if (event.temporalState === "ongoing") return "Ongoing";
  if (event.temporalState === "upcoming") return "Upcoming";
  return "Recent";
}
