import {
  authConfigResponseSchema,
  createFarmResponseSchema,
  createPlotResponseSchema,
  farmListResponseSchema,
  type Polygon,
} from "@agrosense/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "./app";
import * as onboarding from "./lib/onboarding";

const userId = "11111111-1111-4111-8111-111111111111";
const farmId = "22222222-2222-4222-8222-222222222222";
const plotId = "33333333-3333-4333-8333-333333333333";
const boundary: Polygon = {
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

vi.mock("./lib/auth", () => ({
  requireAuth: async (
    context: {
      set: (key: "userId" | "supabase", value: unknown) => void;
    },
    next: () => Promise<void>,
  ) => {
    context.set("userId", userId);
    context.set("supabase", {});
    await next();
  },
}));
vi.mock("./lib/supabase", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/supabase")>();
  return { ...original, createServiceClient: vi.fn(() => ({})) };
});

afterEach(() => vi.restoreAllMocks());

describe("onboarding routes", () => {
  it("exposes only browser-safe Supabase configuration", async () => {
    const response = await app.request(
      "/api/auth/config",
      {},
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        SUPABASE_JWKS_URL:
          "https://example.supabase.co/auth/v1/.well-known/jwks.json",
        SUPABASE_SECRET_KEY: "must-not-leak",
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(authConfigResponseSchema.parse(JSON.parse(body))).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_test",
    });
    expect(body).not.toContain("must-not-leak");
  });

  it("lists only the farms returned by the owner-scoped data source", async () => {
    vi.spyOn(onboarding, "listFarms").mockResolvedValue({
      farms: [
        {
          id: farmId,
          name: "Las Acacias",
          province: "Córdoba",
          locality: "Río Cuarto",
          dataMode: "live",
        },
      ],
    });

    const response = await app.request("/api/farms");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(
      farmListResponseSchema.parse(await response.json()).farms,
    ).toHaveLength(1);
  });

  it("creates a farm from a strict validated body", async () => {
    const created = {
      id: farmId,
      name: "Las Acacias",
      province: "Córdoba",
      locality: null,
      timezone: "America/Argentina/Cordoba" as const,
      dataMode: "live" as const,
      boundary,
      declaredAreaHa: 120,
      dataVersion: 1,
      customRules: [],
    };
    vi.spyOn(onboarding, "createFarm").mockResolvedValue(created);

    const response = await app.request("/api/farms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Las Acacias",
        province: "Córdoba",
        locality: null,
        boundary,
        declaredAreaHa: 120,
      }),
    });

    expect(response.status).toBe(201);
    expect(createFarmResponseSchema.parse(await response.json())).toEqual(
      created,
    );
    expect(onboarding.createFarm).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      expect.objectContaining({ name: "Las Acacias" }),
    );
  });

  it("rejects malformed farm input without calling the mutation boundary", async () => {
    const create = vi.spyOn(onboarding, "createFarm");
    const response = await app.request("/api/farms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Farm", province: "Córdoba", extra: true }),
    });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a plot and crop cycle atomically", async () => {
    const activeCropCycle = {
      id: "44444444-4444-4444-8444-444444444444",
      plotId,
      cropCode: "maize" as const,
      seasonLabel: "2026/27",
      sownOn: "2026-09-01",
      stageCode: "V3" as const,
      stageAsOf: "2026-09-10",
      endedOn: null,
      updatedAt: "2026-09-12T12:00:00.000000Z",
    };
    const created = {
      farmId,
      dataVersion: 2,
      plot: {
        id: plotId,
        name: "North field",
        boundary,
        samplePoint: {
          type: "Point" as const,
          coordinates: [-64.15, -31.45] as const,
        },
        declaredAreaHa: 80,
        activeCropCycle,
      },
    };
    vi.spyOn(onboarding, "createPlot").mockResolvedValue(created);

    const response = await app.request(`/api/farms/${farmId}/plots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "North field",
        boundary,
        samplePoint: { type: "Point", coordinates: [-64.15, -31.45] },
        declaredAreaHa: 80,
        cropCycle: {
          cropCode: "maize",
          seasonLabel: "2026/27",
          sownOn: "2026-09-01",
          stageCode: "V3",
          stageAsOf: "2026-09-10",
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(createPlotResponseSchema.parse(await response.json())).toEqual(
      created,
    );
  });
});
