import type { EventCard } from "@agrosense/contracts";

export function timelineEventsForPlot(
  events: EventCard[],
  plotId: string,
): EventCard[] {
  return events
    .filter((event) => event.evidence.plotIds.includes(plotId))
    .sort(
      (left, right) =>
        Date.parse(right.startsAt) - Date.parse(left.startsAt) ||
        left.id.localeCompare(right.id),
    );
}
