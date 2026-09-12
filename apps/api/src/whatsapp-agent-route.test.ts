import { describe, expect, it, vi } from "vitest";
import { conversationName } from "./agent/config";
import type { InboundMessage } from "./agent/inbound";
import app from "./app";

const ownerId = "11111111-1111-4111-8111-111111111111";
const business = "647015955153740";
const secret = "test_webhook_secret_not_real";
const env = {
  SUPABASE_URL: "https://agent-route.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_JWKS_URL:
    "https://agent-route.supabase.co/auth/v1/.well-known/jwks.json",
  SUPABASE_SECRET_KEY: "secret_test",
  KAPSO_API_KEY: "kapso_test",
  KAPSO_PHONE_NUMBER_ID: business,
  KAPSO_ALLOWED_USER_ID: ownerId,
  KAPSO_WEBHOOK_SECRET: secret,
  OPENROUTER_API_KEY: "openrouter_test",
  WHATSAPP_AGENT_ENABLED: "true",
};

function event(id: string, sender: string) {
  return {
    phone_number_id: business,
    message: {
      id,
      from: sender,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: "text",
      text: { body: `Message from ${sender}` },
      kapso: { direction: "inbound", status: "received" },
    },
    conversation: { phone_number_id: business, phone_number: sender },
  };
}

async function signature(body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("WhatsApp agent webhook routing", () => {
  it("admits a mixed batch into one isolated Durable Object per sender", async () => {
    const admissions: Array<{
      name: string;
      ownerId: string;
      messages: InboundMessage[];
    }> = [];
    const getByName = vi.fn((name: string) => ({
      enqueue: async (messages: InboundMessage[], admittedOwnerId: string) => {
        admissions.push({ name, ownerId: admittedOwnerId, messages });
        return { accepted: messages.length, duplicates: 0 };
      },
    }));
    const first = "5493511234567";
    const second = "15551234567";
    const body = JSON.stringify({
      type: "whatsapp.message.received",
      batch: true,
      data: [
        event("wamid.1", first),
        event("wamid.2", second),
        event("wamid.3", first),
      ],
    });

    const response = await app.request(
      "/api/whatsapp/webhook",
      {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Event": "whatsapp.message.received",
          "X-Webhook-Signature": await signature(body),
        },
      },
      {
        ...env,
        WHATSAPP_CONVERSATIONS: { getByName } as never,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: 3,
      duplicates: 0,
      ignored: 0,
    });
    expect(admissions).toHaveLength(2);
    expect(admissions).toEqual(
      expect.arrayContaining([
        {
          name: await conversationName({
            ownerId,
            phoneNumberId: business,
            sender: first,
          }),
          ownerId,
          messages: expect.arrayContaining([
            expect.objectContaining({ messageId: "wamid.1", sender: first }),
            expect.objectContaining({ messageId: "wamid.3", sender: first }),
          ]),
        },
        {
          name: await conversationName({
            ownerId,
            phoneNumberId: business,
            sender: second,
          }),
          ownerId,
          messages: [
            expect.objectContaining({ messageId: "wamid.2", sender: second }),
          ],
        },
      ]),
    );
  });
});
