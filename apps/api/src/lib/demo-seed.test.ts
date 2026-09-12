import { type Polygon, polygonContainsPolygon } from "@agrosense/contracts";
import { describe, expect, it } from "vitest";
import { importDemoSeed, validateDemoSeed } from "./demo-seed";

const validSeed = {
  farm: {
    name: "Demo",
    province: "Cordoba",
    locality: null,
    boundary: {
      type: "Polygon" as const,
      coordinates: [
        [
          [-64, -31],
          [-63, -31],
          [-63, -30],
          [-64, -30],
          [-64, -31],
        ],
      ],
    },
    declaredAreaHa: 100,
  },
  plots: [
    {
      name: "Plot 1",
      boundary: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-63.9, -30.9],
            [-63.5, -30.9],
            [-63.5, -30.5],
            [-63.9, -30.5],
            [-63.9, -30.9],
          ],
        ],
      },
      samplePoint: {
        type: "Point" as const,
        coordinates: [-63.7, -30.7] as [number, number],
      },
      declaredAreaHa: 20,
      cropCycle: {
        cropCode: "maize" as const,
        seasonLabel: "2026/27",
        sownOn: "2026-09-01",
        stageCode: "V6",
        stageAsOf: "2026-09-10",
      },
    },
  ],
};

describe("demo seed importer", () => {
  const rectangle = (
    left: number,
    bottom: number,
    right: number,
    top: number,
  ): Polygon => ({
    type: "Polygon",
    coordinates: [
      [
        [left, bottom],
        [right, bottom],
        [right, top],
        [left, top],
        [left, bottom],
      ],
    ],
  });

  function seedWithPlots(boundaries: Polygon[]) {
    return {
      ...validSeed,
      farm: { ...validSeed.farm, boundary: rectangle(0, 0, 10, 10) },
      plots: boundaries.map((boundary, index) => ({
        ...validSeed.plots[0],
        name: `Plot ${index}`,
        boundary,
        samplePoint: {
          type: "Point",
          coordinates: boundary.coordinates[0]?.[0],
        },
      })),
    };
  }

  it("accepts shared edges and corners regardless of ring direction", () => {
    const a = rectangle(1, 1, 2, 2);
    const b = rectangle(2, 1, 3, 2);
    const c = rectangle(2, 2, 3, 3);
    expect(() => validateDemoSeed(seedWithPlots([a, b, c]))).not.toThrow();
    expect(() =>
      validateDemoSeed(
        seedWithPlots([
          a,
          { ...b, coordinates: [(b.coordinates[0] ?? []).slice().reverse()] },
        ]),
      ),
    ).not.toThrow();
    const diagonal: Polygon[] = [
      {
        type: "Polygon",
        coordinates: [
          [
            [0.1, 0.2],
            [3.3, 2.1],
            [0.2, 3.2],
            [0.1, 0.2],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [3.3, 2.1],
            [0.1, 0.2],
            [3.2, 0.1],
            [3.3, 2.1],
          ],
        ],
      },
    ];
    expect(() => validateDemoSeed(seedWithPlots(diagonal))).not.toThrow();
    for (const angle of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(
        ([x = 0, y = 0]) =>
          [
            5 + x * Math.cos(angle) - y * Math.sin(angle),
            5 + x * Math.sin(angle) + y * Math.cos(angle),
          ] as [number, number],
      );
      const [a, b, c, d] = corners;
      if (!a || !b || !c || !d) throw new Error("Missing corner");
      expect(() =>
        validateDemoSeed(
          seedWithPlots([
            { type: "Polygon", coordinates: [[a, b, c, a]] },
            { type: "Polygon", coordinates: [[a, c, d, a]] },
          ]),
        ),
      ).not.toThrow();
    }
  });

  it("rejects positive-area overlap, including coincident and nested plots", () => {
    const a = rectangle(1, 1, 4, 4);
    for (const b of [a, rectangle(2, 2, 3, 3), rectangle(3, 1, 5, 4)]) {
      expect(() => validateDemoSeed(seedWithPlots([a, b]))).toThrow(/overlap/);
    }
  });

  it("rejects an edge leaving a concave farm even when all vertices are inside", () => {
    const farm: Polygon["coordinates"] = [
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [3, 4],
        [3, 1],
        [1, 1],
        [1, 4],
        [0, 4],
        [0, 0],
      ],
    ];
    const child: Polygon["coordinates"] = [
      [
        [0.5, 3],
        [3.5, 3],
        [2, 0.5],
        [0.5, 3],
      ],
    ];
    expect(polygonContainsPolygon(farm, child)).toBe(false);
    // The crossing can also pass exactly through boundary vertices.
    expect(
      polygonContainsPolygon(farm, [
        [
          [1, 4],
          [3, 4],
          [2, 0.5],
          [1, 4],
        ],
      ]),
    ).toBe(false);
    expect(
      polygonContainsPolygon(farm, rectangle(0, 0, 1, 4).coordinates),
    ).toBe(true);
    expect(polygonContainsPolygon(farm, farm)).toBe(true);
  });

  it("rejects invalid topology before touching the trusted client", async () => {
    const client = new Proxy(
      {},
      {
        get: () => {
          throw new Error("write attempted");
        },
      },
    );
    expect(() =>
      validateDemoSeed({
        ...validSeed,
        plots: [
          {
            ...validSeed.plots[0],
            samplePoint: { type: "Point", coordinates: [-62, -30] },
          },
        ],
      }),
    ).toThrow();
    await expect(
      importDemoSeed(client as never, "11111111-1111-4111-8111-111111111111", {
        ...validSeed,
        plots: [
          {
            ...validSeed.plots[0],
            samplePoint: { type: "Point", coordinates: [-62, -30] },
          },
        ],
      }),
    ).rejects.toThrow();
  });
});
