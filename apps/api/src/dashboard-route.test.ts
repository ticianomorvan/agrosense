import { afterEach, expect, it, vi } from "vitest";
import app from "./index";
import * as dashboard from "./lib/dashboard";
import * as refresh from "./lib/refresh";

// Authentication has separate integration coverage; isolate HTTP error mapping.
vi.mock("./lib/auth", () => ({
  requireAuth: async (_context: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("./lib/supabase", () => ({
  createServiceClient: vi.fn(() => ({})),
}));
afterEach(() => vi.restoreAllMocks());

it("returns a non-cacheable 413 for a dashboard payload limit", async () => {
  vi.spyOn(dashboard, "loadDashboard").mockRejectedValue(
    new dashboard.DashboardPayloadLimitError(),
  );
  const response = await app.request(
    "/api/farms/11111111-1111-4111-8111-111111111111/dashboard",
  );
  expect(response.status).toBe(413);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({
    error: {
      code: "PAYLOAD_LIMIT_EXCEEDED",
      message: "Dashboard exceeds its payload limits",
    },
  });
});

it("maps refresh cooldowns and rejects unsupported input", async () => {
  vi.spyOn(refresh, "refreshFarm").mockRejectedValue(
    new refresh.RefreshError({ kind: "rate_limited", retryAfter: 42 }),
  );
  const farmId = "11111111-1111-4111-8111-111111111111";

  const unsupported = await app.request(
    `/api/farms/${farmId}/refresh?force=1`,
    {
      method: "POST",
    },
  );
  expect(unsupported.status).toBe(400);

  const response = await app.request(`/api/farms/${farmId}/refresh`, {
    method: "POST",
  });
  expect(response.status).toBe(429);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("retry-after")).toBe("42");
  expect(await response.json()).toEqual({
    error: {
      code: "RATE_LIMITED",
      message: "Farm refresh is cooling down",
    },
  });
});
