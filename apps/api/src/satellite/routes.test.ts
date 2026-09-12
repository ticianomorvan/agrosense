import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, expect, it, vi } from "vitest";
import app from "../index";

const farmId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const path = `/api/farms/${farmId}/satellite`;
const window = { from: "2026-09-01T00:00:00Z", to: "2026-09-11T23:59:59Z" };
afterEach(() => vi.unstubAllGlobals());

it("requires authentication before satellite processing", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const response = await app.request(path, {
    method: "POST",
    body: JSON.stringify(window),
  });
  expect(response.status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});
it("uses the verified owner and returns 404 for inaccessible farms before contacting Copernicus", async () => {
  const env = {
    SUPABASE_URL: "https://satellite-test.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_JWKS_URL:
      "https://satellite-test.supabase.co/auth/v1/.well-known/jwks.json",
  };
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const token = await new SignJWT({ role: "authenticated" })
    .setSubject(userId)
    .setIssuer(`${env.SUPABASE_URL}/auth/v1`)
    .setAudience("authenticated")
    .setExpirationTime("5m")
    .setProtectedHeader({ alg: "ES256", kid: "satellite" })
    .sign(privateKey);
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const target = new URL(
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
    );
    if (target.pathname.endsWith("jwks.json"))
      return Response.json({
        keys: [
          { ...(await exportJWK(publicKey)), kid: "satellite", alg: "ES256" },
        ],
      });
    expect(target.origin).toBe(env.SUPABASE_URL);
    expect(target.searchParams.get("owner_id")).toBe(`eq.${userId}`);
    expect(target.searchParams.get("id")).toBe(`eq.${farmId}`);
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetcher);
  const response = await app.request(
    path,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(window),
    },
    env,
  );
  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(fetcher).toHaveBeenCalledTimes(2);
  const invalid = await app.request(
    path,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...window, evalscript: "untrusted" }),
    },
    env,
  );
  expect(invalid.status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
