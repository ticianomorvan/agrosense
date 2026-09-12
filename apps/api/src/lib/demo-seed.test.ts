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
