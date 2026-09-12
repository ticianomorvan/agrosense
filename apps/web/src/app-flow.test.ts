import {
  type EventCard,
  type Polygon,
  pointInPolygon,
  polygonContainsPolygon,
} from "@agrosense/contracts";
import { describe, expect, it } from "vitest";
import { routeFromPath, workspaceNeedsSignIn } from "./app/routing";
import { timelineEventsForPlot } from "./features/events/timeline";
import {
  boundsFromPoints,
  polygonFromPoints,
  rectangleFromBounds,
} from "./features/onboarding/geometry";

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

  it("leaves loading alone and redirects every settled sessionless workspace", () => {
    expect(workspaceNeedsSignIn("workspace", "loading", false)).toBe(false);
    expect(workspaceNeedsSignIn("workspace", "ready", true)).toBe(false);
    expect(workspaceNeedsSignIn("workspace", "ready", false)).toBe(true);
    expect(workspaceNeedsSignIn("workspace", "unavailable", false)).toBe(true);
    expect(workspaceNeedsSignIn("sign-in", "unavailable", false)).toBe(false);
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

  it("calculates bounding box from placed points", () => {
    expect(boundsFromPoints([])).toBeNull();
    expect(
      boundsFromPoints([
        { lat: -31.4, lng: -64.2 },
        { lat: -31.4, lng: -64.1 },
        { lat: -31.5, lng: -64.1 },
      ]),
    ).toBeNull();

    const points = [
      { lat: -31.4, lng: -64.2 },
      { lat: -31.4, lng: -64.1 },
      { lat: -31.5, lng: -64.1 },
      { lat: -31.5, lng: -64.2 },
    ];
    const bounds = boundsFromPoints(points);
    expect(bounds).toEqual({
      west: "-64.200000",
      east: "-64.100000",
      south: "-31.500000",
      north: "-31.400000",
    });

    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error("Expected bounds");
    const rectangle = rectangleFromBounds(bounds);
    expect(rectangle.ok).toBe(true);
  });

  it("builds a polygon from points", () => {
    expect(polygonFromPoints([])).toBeNull();
    expect(
      polygonFromPoints([
        { lat: -31.4, lng: -64.2 },
        { lat: -31.4, lng: -64.1 },
      ]),
    ).toBeNull();

    const points = [
      { lat: -31.4, lng: -64.2 },
      { lat: -31.4, lng: -64.1 },
      { lat: -31.5, lng: -64.1 },
      { lat: -31.5, lng: -64.2 },
    ];
    const polygon = polygonFromPoints(points);
    expect(polygon).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [-64.2, -31.4],
          [-64.1, -31.4],
          [-64.1, -31.5],
          [-64.2, -31.5],
          [-64.2, -31.4],
        ],
      ],
    });
  });

  it("enforces plot points and boundary are contained inside the farm boundary", () => {
    const farmBoundary: Polygon = {
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
    };

    // Point inside farm
    expect(pointInPolygon([-64.15, -31.45], farmBoundary.coordinates)).toBe(
      true,
    );
    // Point outside farm
    expect(pointInPolygon([-64.25, -31.45], farmBoundary.coordinates)).toBe(
      false,
    );

    // Plot rectangle completely inside
    const insidePlot = rectangleFromBounds({
      west: "-64.18",
      south: "-31.48",
      east: "-64.12",
      north: "-31.42",
    });
    if (!insidePlot.ok) throw new Error("Expected valid rectangle");
    expect(
      polygonContainsPolygon(
        farmBoundary.coordinates,
        insidePlot.boundary.coordinates,
      ),
    ).toBe(true);

    // Plot rectangle extending outside
    const outsidePlot = rectangleFromBounds({
      west: "-64.25",
      south: "-31.48",
      east: "-64.15",
      north: "-31.42",
    });
    if (!outsidePlot.ok) throw new Error("Expected valid rectangle");
    expect(
      polygonContainsPolygon(
        farmBoundary.coordinates,
        outsidePlot.boundary.coordinates,
      ),
    ).toBe(false);
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
