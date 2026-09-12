import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  createTokenVerifier,
  createUserClient,
  readSupabaseConfig,
} from "./supabase";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_JWKS_URL:
    "https://example.supabase.co/auth/v1/.well-known/jwks.json",
};
const userId = "11111111-1111-4111-8111-111111111111";

describe("Supabase boundary", () => {
  it("fails closed on missing settings and mismatched JWKS origins", () => {
    expect(() => readSupabaseConfig({})).toThrow();
    expect(() =>
      readSupabaseConfig({
        ...env,
        SUPABASE_JWKS_URL: "https://other.example/jwks",
      }),
    ).toThrow();
  });
  it("verifies signed identity, issuer, audience, expiry, and user role", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "ES256" };
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const verify = createTokenVerifier(readSupabaseConfig(env), fetcher);
    const sign = (overrides: Record<string, unknown> = {}) =>
      new SignJWT({
        sub: userId,
        role: "authenticated",
        iss: `${env.SUPABASE_URL}/auth/v1`,
        aud: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 300,
        ...overrides,
      })
        .setProtectedHeader({ alg: "ES256", kid: "test" })
        .sign(privateKey);
    expect(await verify(await sign())).toEqual({ userId });
    for (const overrides of [
      { iss: "https://wrong.example/auth/v1" },
      { aud: "wrong" },
      { exp: 1 },
      { role: "service_role" },
      { sub: "not-a-user" },
      { exp: undefined },
    ]) {
      await expect(verify(await sign(overrides))).rejects.toThrow();
    }
    const other = await generateKeyPair("ES256");
    const forged = await new SignJWT({ sub: userId, role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "test" })
      .setIssuer(`${env.SUPABASE_URL}/auth/v1`)
      .setAudience("authenticated")
      .setExpirationTime("5m")
      .sign(other.privateKey);
    await expect(verify(forged)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("forwards the user JWT and publishable key to the Data API", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response("[]", { headers: { "content-type": "application/json" } }),
    );
    const client = createUserClient(
      readSupabaseConfig(env),
      "user-jwt",
      fetcher,
    );
    const { error } = await client.from("farms").select("id");
    expect(error).toBeNull();
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer user-jwt");
    expect(headers.get("apikey")).toBe(env.SUPABASE_PUBLISHABLE_KEY);
  });
});
