import { describe, expect, it } from "vitest";
import { normalizeInbound, verifyWebhookSignature } from "./inbound";

const secret = "webhook-test-secret";
const now = new Date("2026-09-12T12:00:00Z");
const config = { phoneNumberId: "647015955153740", sender: "5493511234567" };
const event = (id = "wamid.inbound", text = "¿Cómo viene el tiempo?") => ({
  message: {
    id,
    timestamp: String(now.getTime() / 1000),
    type: "text",
    from: config.sender,
    text: { body: text },
    kapso: { direction: "inbound", status: "received", origin: "cloud_api" },
  },
  conversation: {
    id: "conv_1",
    phone_number: `+${config.sender}`,
    phone_number_id: config.phoneNumberId,
  },
  phone_number_id: config.phoneNumberId,
});
async function sign(body: Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new Uint8Array(body)),
  );
  return [...signature]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("Kapso webhook primitives", () => {
  it("verifies the exact UTF-8 bytes, including accents and whitespace", async () => {
    const raw = new TextEncoder().encode(JSON.stringify(event(), null, 2));
    const signature = await sign(raw);
    expect(await verifyWebhookSignature(raw, signature, secret)).toBe(true);
    expect(
      await verifyWebhookSignature(
        new TextEncoder().encode(JSON.stringify(event())),
        signature,
        secret,
      ),
    ).toBe(false);
    expect(await verifyWebhookSignature(raw, signature, "wrong-secret")).toBe(
      false,
    );
  });

  it.each([undefined, "", "sha256=abc", "a".repeat(63), "g".repeat(64)])(
    "rejects missing or malformed signatures (case %#)",
    async (signature) => {
      expect(
        await verifyWebhookSignature(new Uint8Array(), signature, secret),
      ).toBe(false);
    },
  );

  it("normalizes an authorized v2 text message", () => {
    expect(
      normalizeInbound(event(), "whatsapp.message.received", config, now),
    ).toEqual([
      {
        messageId: "wamid.inbound",
        phoneNumberId: config.phoneNumberId,
        sender: config.sender,
        text: "¿Cómo viene el tiempo?",
        sentAt: now.toISOString(),
      },
    ]);
  });

  it("accepts the conversation phone when from is absent, and rejects mismatches", () => {
    const payload = event();
    const { from: _from, ...message } = payload.message;
    expect(
      normalizeInbound(
        { ...payload, message },
        "whatsapp.message.received",
        config,
        now,
      ),
    ).toHaveLength(1);
    expect(
      normalizeInbound(
        { ...payload, message: { ...message, from: "15551234567" } },
        "whatsapp.message.received",
        config,
        now,
      ),
    ).toEqual([]);
  });

  it("preserves Kapso batch order even when timestamps match and IDs sort differently", () => {
    const later = event("wamid.2", "And tomorrow?");
    const batch = {
      type: "whatsapp.message.received",
      batch: true,
      data: [later, event("wamid.1")],
    };
    expect(
      normalizeInbound(batch, "whatsapp.message.received", config, now).map(
        (message) => message.messageId,
      ),
    ).toEqual(["wamid.2", "wamid.1"]);
    expect(() =>
      normalizeInbound(
        { ...batch, data: Array.from({ length: 21 }, () => event()) },
        "whatsapp.message.received",
        config,
        now,
      ),
    ).toThrow();
  });

  it.each([
    { ...event(), phone_number_id: "99999" },
    {
      ...event(),
      message: { ...event().message, from: "15551234567" },
      conversation: { ...event().conversation, phone_number: "15551234567" },
    },
    {
      ...event(),
      message: { ...event().message, type: "image", text: undefined },
    },
    {
      ...event(),
      message: {
        ...event().message,
        kapso: { direction: "outbound", status: "sent", origin: "cloud_api" },
      },
    },
    {
      ...event(),
      message: {
        ...event().message,
        kapso: {
          direction: "inbound",
          status: "received",
          origin: "history_sync",
        },
      },
    },
    {
      ...event(),
      message: {
        ...event().message,
        timestamp: String(now.getTime() / 1000 - 86401),
      },
    },
    {
      ...event(),
      message: {
        ...event().message,
        timestamp: String(now.getTime() / 1000 + 301),
      },
    },
  ])(
    "ignores unsupported, unauthorized, stale or echoed messages (case %#)",
    (payload) => {
      expect(
        normalizeInbound(payload, "whatsapp.message.received", config, now),
      ).toEqual([]);
    },
  );

  it("does not trust an unsigned event header to turn an outbound body into an inbound event", () => {
    const payload = event();
    payload.message.kapso.direction = "outbound";
    expect(
      normalizeInbound(payload, "whatsapp.message.received", config, now),
    ).toEqual([]);
    expect(
      normalizeInbound(event(), "whatsapp.message.sent", config, now),
    ).toEqual([]);
  });
});
