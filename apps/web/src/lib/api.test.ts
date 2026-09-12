import { healthResponseSchema } from "@agrosense/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, apiUrl, getJson, shouldRetry } from "./api";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("uses the configured Worker origin for API requests", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "https://agrosense.example.workers.dev");
  const fetcher = vi.fn(async () =>
    Response.json({ status: "ok", service: "agrosense-api" }),
  );
  vi.stubGlobal("fetch", fetcher);

  await getJson("/api/health", healthResponseSchema);

  expect(fetcher).toHaveBeenCalledWith(
    "https://agrosense.example.workers.dev/api/health",
    expect.any(Object),
  );
});

it("keeps local API requests relative when no Worker origin is configured", () => {
  expect(apiUrl("/api/health", undefined)).toBe("/api/health");
  expect(apiUrl("/api/health", "  ")).toBe("/api/health");
});

it.each([
  "http://agrosense.example.workers.dev",
  "https://user@example.com",
  "https://api.example.com/v1",
  "https://api.example.com?target=other",
])("rejects an unsafe API base URL: %s", (baseUrl) => {
  expect(() => apiUrl("/api/health", baseUrl)).toThrow(
    "VITE_API_BASE_URL must be an HTTPS origin",
  );
});

it("validates successful responses before returning data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status: "wrong" })),
  );
  await expect(
    getJson("/api/health", healthResponseSchema),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

it("does not expose server error bodies or retry authentication failures", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("private upstream detail", { status: 401 })),
  );
  await expect(
    getJson("/api/health", healthResponseSchema),
  ).rejects.toMatchObject({
    status: 401,
    message: "Sign in to load your farm.",
  });
  expect(shouldRetry(0, new ApiError("AUTH", "Sign in", 401))).toBe(false);
  expect(shouldRetry(0, new ApiError("SERVER", "Unavailable", 503))).toBe(true);
  expect(shouldRetry(1, new ApiError("SERVER", "Unavailable", 503))).toBe(
    false,
  );
});

it("passes cancellation to fetch and preserves abort errors", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetcher = vi.fn(async (_url, init) => {
    throw init.signal.reason;
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    getJson("/api/health", healthResponseSchema, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});
