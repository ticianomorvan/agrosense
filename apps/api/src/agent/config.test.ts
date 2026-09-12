import { describe, expect, it } from "vitest";
import { conversationName, readAgentConfig } from "./config";

const env = {
  SUPABASE_URL: "https://agent-config.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_JWKS_URL:
    "https://agent-config.supabase.co/auth/v1/.well-known/jwks.json",
  SUPABASE_SECRET_KEY: "secret_test",
  KAPSO_API_KEY: "kapso_test",
  KAPSO_PHONE_NUMBER_ID: "647015955153740",
  KAPSO_ALLOWED_USER_ID: "11111111-1111-4111-8111-111111111111",
  KAPSO_WEBHOOK_SECRET: "test_webhook_secret",
  OPENROUTER_API_KEY: "openrouter_test",
  WHATSAPP_AGENT_ENABLED: "true",
};

describe("WhatsApp agent configuration", () => {
  it("enables the agent without a fixed producer phone number", () => {
    const config = readAgentConfig(env);
    expect(config).toMatchObject({
      ownerId: env.KAPSO_ALLOWED_USER_ID,
      phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
      webhookSecret: env.KAPSO_WEBHOOK_SECRET,
    });
    expect(config).not.toHaveProperty("sender");
  });

  it("isolates conversation names by actual inbound sender", async () => {
    const base = {
      ownerId: env.KAPSO_ALLOWED_USER_ID,
      phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
    };
    const [first, second] = await Promise.all([
      conversationName({ ...base, sender: "5493511234567" }),
      conversationName({ ...base, sender: "15551234567" }),
    ]);
    expect(first).not.toBe(second);
  });
});
