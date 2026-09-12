import type { EventCard } from "@agrosense/contracts";
import { describe, expect, it } from "vitest";
import { routeFromPath } from "./app/routing";
import { timelineEventsForPlot } from "./features/events/timeline";
import { rectangleFromBounds } from "./features/onboarding/geometry";

describe("application route", () => {
  it.each([
    ["/", "landing"],
    ["/sign-in", "sign-in"],
    ["/app", "workspace"],
    ["/app/farms/one", "workspace"],
    ["/unknown", "landing"],
  ] as const)("maps %s to %s", (path, expected) => {
    expect(routeFromPath(path)).toBe(expected);
  });
});

describe("onboarding geometry", () => {
  it("builds a closed rectangle and centered forecast point", () => {
    expect(
      rectangleFromBounds({
        west: "-64.20",
        south: "-31.50",
        east: "-64.10",
        north: "-31.40",
      }),
    ).toEqual({
      ok: true,
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [-64.2, -31.5],
            [-64.1, -31.5],
            [-64.1, -31.4],
            [-64.2, -31.4],
            [-64.2, -31.5],
          ],
        ],
      },
      samplePoint: { type: "Point", coordinates: [-64.15, -31.45] },
    });
  });

  it.each([
    [{ west: "", south: "-31.5", east: "-64.1", north: "-31.4" }],
    [{ west: "-64.1", south: "-31.5", east: "-64.2", north: "-31.4" }],
    [{ west: "-64.2", south: "-31.4", east: "-64.1", north: "-31.5" }],
    [{ west: "-181", south: "-31.5", east: "-180.9", north: "-31.4" }],
    [{ west: "-64.2", south: "-91", east: "-64.1", north: "-90.9" }],
  ])("rejects incomplete or reversed bounds", (bounds) => {
    expect(rectangleFromBounds(bounds).ok).toBe(false);
  });
});

describe("event timeline", () => {
  it("filters to the selected plot and sorts most recent first", () => {
    const plotId = "11111111-1111-4111-8111-111111111111";
    const otherPlotId = "22222222-2222-4222-8222-222222222222";
    const event = (id: string, startsAt: string, plotIds: string[]) =>
      ({ id, startsAt, evidence: { plotIds } }) as EventCard;
    const events = [
      event("old", "2026-09-10T09:00:00Z", [plotId]),
      event("other", "2026-09-12T09:00:00Z", [otherPlotId]),
      event("new", "2026-09-11T09:00:00Z", [plotId]),
    ];

    expect(timelineEventsForPlot(events, plotId).map(({ id }) => id)).toEqual([
      "new",
      "old",
    ]);
  });
});
