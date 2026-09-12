import { whatsappMessageResponseSchema } from "@agrosense/contracts";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import app from "./index";

const userId = "11111111-1111-4111-8111-111111111111";
const env = {
  SUPABASE_URL: "https://kapso-tests.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_JWKS_URL:
    "https://kapso-tests.supabase.co/auth/v1/.well-known/jwks.json",
  KAPSO_API_KEY: "kapso_test_secret",
  KAPSO_PHONE_NUMBER_ID: "647015955153740",
  KAPSO_ALLOWED_USER_ID: userId,
};
const body = { to: "5493511234567", text: "Hola desde AgroSense" };
const accepted = {
  messaging_product: "whatsapp",
  contacts: [{ input: body.to, wa_id: body.to }],
  messages: [{ id: "wamid.test" }],
};
let token: string;
let expiredToken: string;
let jwks: unknown;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  jwks = {
    keys: [{ ...(await exportJWK(publicKey)), kid: "kapso", alg: "ES256" }],
  };
  const sign = (expiration: string | number) =>
    new SignJWT({ role: "authenticated" })
      .setSubject(userId)
      .setIssuer(`${env.SUPABASE_URL}/auth/v1`)
      .setAudience("authenticated")
      .setExpirationTime(expiration)
      .setProtectedHeader({ alg: "ES256", kid: "kapso" })
      .sign(privateKey);
  token = await sign("5m");
  expiredToken = await sign(1);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mockProvider(
  handler: (init?: RequestInit) => Promise<Response> = async () =>
    Response.json(accepted),
) {
  const provider = vi.fn(handler);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === env.SUPABASE_JWKS_URL) return Response.json(jwks);
      expect(String(url)).toBe(
        `https://api.kapso.ai/meta/whatsapp/v24.0/${env.KAPSO_PHONE_NUMBER_ID}/messages`,
      );
      return provider(init);
    }),
  );
  return provider;
}

function send(
  payload: unknown = body,
  bindings = env,
  authorization = `Bearer ${token}`,
) {
  return app.request(
    "/api/whatsapp/messages",
    {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    bindings,
  );
}

describe("outbound WhatsApp", () => {
  it("sends with the configured server credential and returns acceptance, not delivery", async () => {
    const provider = mockProvider();
    const response = await send();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(whatsappMessageResponseSchema.parse(await response.json())).toEqual({
      messageId: "wamid.test",
      status: "accepted",
    });
    expect(provider).toHaveBeenCalledTimes(1);
    const init = provider.mock.calls[0]?.[0];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-API-Key")).toBe(env.KAPSO_API_KEY);
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: body.to,
      type: "text",
      text: { body: body.text, preview_url: false },
    });
  });

  it("normalizes an optional leading plus on international numbers", async () => {
    const provider = mockProvider();
    expect((await send({ ...body, to: `+${body.to}` })).status).toBe(200);
    expect(JSON.parse(String(provider.mock.calls[0]?.[0]?.body)).to).toBe(
      body.to,
    );
  });

  it("rejects missing and expired sessions before calling Kapso", async () => {
    const provider = mockProvider();
    for (const authorization of ["", `Bearer ${expiredToken}`]) {
      expect((await send(body, env, authorization)).status).toBe(401);
    }
    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects a verified user who is not the configured operator", async () => {
    const provider = mockProvider();
    const response = await send(body, {
      ...env,
      KAPSO_ALLOWED_USER_ID: "22222222-2222-4222-8222-222222222222",
    });
    expect(response.status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    { KAPSO_API_KEY: "" },
    { KAPSO_API_KEY: "bad\nkey" },
    { KAPSO_PHONE_NUMBER_ID: "" },
    { KAPSO_PHONE_NUMBER_ID: "../../other" },
    { KAPSO_ALLOWED_USER_ID: "" },
    { KAPSO_ALLOWED_USER_ID: "invalid" },
  ])("fails closed for invalid configuration: %j", async (overrides) => {
    const provider = mockProvider();
    const response = await send(body, { ...env, ...overrides });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("KAPSO_UNAVAILABLE");
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    {},
    null,
    { ...body, text: "   " },
    { ...body, text: "a".repeat(4097) },
    { ...body, to: "0351 1234567" },
    { ...body, to: "1234567890123456" },
    { ...body, to: "https://example.com" },
    { ...body, apiKey: "override" },
  ])("rejects invalid request data (case %#)", async (payload) => {
    const provider = mockProvider();
    expect((await send(payload)).status).toBe(422);
    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, unsupported media types and excessive bodies", async () => {
    const provider = mockProvider();
    for (const [contentType, payload, status] of [
      ["application/json", "{", 400],
      ["text/plain", JSON.stringify(body), 415],
      [
        "application/json",
        JSON.stringify({ ...body, text: "a".repeat(17000) }),
        413,
      ],
    ] as const) {
      const response = await app.request(
        "/api/whatsapp/messages",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": contentType,
          },
          body: payload,
        },
        env,
      );
      expect(response.status).toBe(status);
    }
    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects query parameters before calling Kapso", async () => {
    const provider = mockProvider();
    const response = await app.request(
      "/api/whatsapp/messages?sender=override",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      env,
    );
    expect(response.status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    [400, 502, "KAPSO_REJECTED"],
    [401, 502, "KAPSO_REJECTED"],
    [408, 502, "SEND_OUTCOME_UNKNOWN"],
    [429, 503, "KAPSO_RATE_LIMITED"],
    [500, 502, "SEND_OUTCOME_UNKNOWN"],
  ])(
    "maps upstream %i to %i and %s without leaking provider data or retrying",
    async (upstream, status, code) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const provider = mockProvider(async () =>
        Response.json(
          { error: { message: env.KAPSO_API_KEY } },
          { status: Number(upstream) },
        ),
      );
      const response = await send();
      expect(response.status).toBe(status);
      const result = await response.json();
      expect(result.error.code).toBe(code);
      expect(JSON.stringify(result)).not.toContain(env.KAPSO_API_KEY);
      expect(provider).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { ...accepted, messages: [] },
    { ...accepted, messages: [{ id: "" }] },
  ])(
    "reports an unknown outcome for malformed upstream success",
    async (data) => {
      const provider = mockProvider(async () => Response.json(data));
      const response = await send();
      expect(response.status).toBe(502);
      expect((await response.json()).error.code).toBe("SEND_OUTCOME_UNKNOWN");
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );

  it("does not retry network failures", async () => {
    const provider = mockProvider(async () => {
      throw new Error("connection lost");
    });
    const response = await send();
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("SEND_OUTCOME_UNKNOWN");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("reports non-JSON success bodies as unknown outcomes", async () => {
    const provider = mockProvider(
      async () => new Response("<html>unexpected</html>"),
    );
    const response = await send();
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("SEND_OUTCOME_UNKNOWN");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled send after eight seconds and reports an unknown outcome", async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const provider = mockProvider(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
          started();
        }),
    );
    const responsePromise = send();
    await pending;
    await vi.advanceTimersByTimeAsync(8000);
    const response = await responsePromise;
    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe("SEND_OUTCOME_UNKNOWN");
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
