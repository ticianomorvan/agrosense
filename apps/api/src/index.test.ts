import {
  healthResponseSchema,
  sessionResponseSchema,
} from "@agrosense/contracts";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

import app from "./app";

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

describe("Session authentication", () => {
  it.each([undefined, "Basic abc", "Bearer", "Bearer a b"])(
    "rejects missing or malformed bearer credentials: %s",
    async (authorization) => {
      const response = await app.request("/api/session", {
        headers: authorization ? { Authorization: authorization } : {},
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    },
  );
  it("reports missing configuration without disclosing settings", async () => {
    const response = await app.request(
      "/api/session",
      { headers: { Authorization: "Bearer token" } },
      {},
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Authentication is temporarily unavailable",
      },
    });
  });
});

it("serves verified sessions and rejects expired tokens through the real middleware", async () => {
  const env = {
    SUPABASE_URL: "https://session.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_JWKS_URL:
      "https://session.supabase.co/auth/v1/.well-known/jwks.json",
  };
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            keys: [
              { ...(await exportJWK(publicKey)), kid: "session", alg: "ES256" },
            ],
          }),
        ),
    ),
  );
  const userId = "11111111-1111-4111-8111-111111111111";
  for (const expired of [false, true]) {
    const token = await new SignJWT({ role: "authenticated" })
      .setSubject(userId)
      .setIssuer(`${env.SUPABASE_URL}/auth/v1`)
      .setAudience("authenticated")
      .setExpirationTime(expired ? 1 : "5m")
      .setProtectedHeader({ alg: "ES256", kid: "session" })
      .sign(privateKey);
    const response = await app.request(
      "/api/session",
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(response.status).toBe(expired ? 401 : 200);
    if (!expired) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(sessionResponseSchema.parse(await response.json())).toEqual({
        userId,
      });
    }
  }
});
it("returns an availability error when JWKS cannot be fetched", async () => {
  const env = {
    SUPABASE_URL: "https://offline.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_JWKS_URL:
      "https://offline.supabase.co/auth/v1/.well-known/jwks.json",
  };
  const { privateKey } = await generateKeyPair("ES256");
  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: "offline" })
    .sign(privateKey);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  const response = await app.request(
    "/api/session",
    { headers: { Authorization: `Bearer ${token}` } },
    env,
  );
  expect(response.status).toBe(503);
});
