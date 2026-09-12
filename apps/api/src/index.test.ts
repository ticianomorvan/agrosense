import { healthResponseSchema } from "@agrosense/contracts";
import { describe, expect, it } from "vitest";
import app from "./index";

describe("API contract", () => {
  it("responds to the SPA with the shared health contract", async () => {
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(healthResponseSchema.parse(await response.json()).status).toBe("ok");
  });

  it.each(["/api", "/api/missing"])(
    "returns a JSON 404 for %s",
    async (path) => {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Route not found" },
      });
    },
  );
});
