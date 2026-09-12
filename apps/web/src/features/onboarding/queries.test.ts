import {
  createFarmResponseSchema,
  createPlotResponseSchema,
  farmListResponseSchema,
  type Polygon,
} from "@agrosense/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createOnboardingSource, farmsOptions } from "./queries";

beforeEach(() => vi.stubEnv("VITE_API_BASE_URL", ""));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const farmId = "11111111-1111-4111-8111-111111111111";
const plotId = "22222222-2222-4222-8222-222222222222";
const boundary = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-64.2, -31.5],
      [-64.1, -31.5],
      [-64.1, -31.4],
      [-64.2, -31.4],
      [-64.2, -31.5],
    ],
  ],
} satisfies Polygon;
const farm = createFarmResponseSchema.parse({
  id: farmId,
  name: "Las Acacias",
  province: "Córdoba",
  locality: null,
  timezone: "America/Argentina/Cordoba",
  dataMode: "live",
  boundary,
  declaredAreaHa: 120,
  dataVersion: 1,
});

it("partitions the private farm list cache by owner", () => {
  const first = createOnboardingSource("owner-a", async () => "token-a");
  const second = createOnboardingSource("owner-b", async () => "token-b");
  expect(farmsOptions(first).queryKey).not.toEqual(
    farmsOptions(second).queryKey,
  );
});

it("authenticates and validates farm list and creation requests", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        farmListResponseSchema.parse({
          farms: [
            {
              id: farm.id,
              name: farm.name,
              province: farm.province,
              locality: farm.locality,
              dataMode: farm.dataMode,
            },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(Response.json(farm, { status: 201 }));
  vi.stubGlobal("fetch", fetcher);
  const source = createOnboardingSource("owner-a", async () => "token-a");

  await source.loadFarms(new AbortController().signal);
  await source.createFarm({
    name: farm.name,
    province: farm.province,
    locality: farm.locality,
    boundary,
    declaredAreaHa: farm.declaredAreaHa,
  });

  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    "/api/farms",
    expect.objectContaining({
      headers: expect.objectContaining({}),
      method: "GET",
    }),
  );
  expect(fetcher.mock.calls[0]?.[1]?.headers.get("Authorization")).toBe(
    "Bearer token-a",
  );
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
    method: "POST",
    body: JSON.stringify({
      name: farm.name,
      province: farm.province,
      locality: farm.locality,
      boundary,
      declaredAreaHa: farm.declaredAreaHa,
    }),
  });
});

it("posts a plot only to the selected farm", async () => {
  const created = createPlotResponseSchema.parse({
    farmId,
    dataVersion: 2,
    plot: {
      id: plotId,
      name: "North field",
      boundary,
      samplePoint: { type: "Point", coordinates: [-64.15, -31.45] },
      declaredAreaHa: 60,
      activeCropCycle: {
        id: "33333333-3333-4333-8333-333333333333",
        plotId,
        cropCode: "maize",
        seasonLabel: "2026/27",
        sownOn: null,
        stageCode: null,
        stageAsOf: null,
        endedOn: null,
        updatedAt: "2026-09-12T12:00:00Z",
      },
    },
  });
  const fetcher = vi.fn(async () => Response.json(created, { status: 201 }));
  vi.stubGlobal("fetch", fetcher);
  const source = createOnboardingSource("owner-a", async () => "token-a");
  const request = {
    name: created.plot.name,
    boundary,
    samplePoint: created.plot.samplePoint,
    declaredAreaHa: created.plot.declaredAreaHa,
    cropCycle: {
      cropCode: "maize" as const,
      seasonLabel: "2026/27",
      sownOn: null,
      stageCode: null,
      stageAsOf: null,
    },
  };

  await expect(source.createPlot(farmId, request)).resolves.toEqual(created);
  expect(fetcher).toHaveBeenCalledWith(
    `/api/farms/${farmId}/plots`,
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify(request),
    }),
  );
});
