import { afterEach, expect, it, vi } from "vitest";
import app from "./index";
import * as dashboard from "./lib/dashboard";

// Authentication has separate integration coverage; isolate HTTP error mapping.
vi.mock("./lib/auth", () => ({
  requireAuth: async (_context: unknown, next: () => Promise<void>) => next(),
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
