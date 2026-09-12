import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import app from "./app";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./lib/supabase", async (original) => ({
  ...(await original<typeof import("./lib/supabase")>()),
  createServiceClient: () => ({ rpc }),
}));

const env = {
  KAPSO_PHONE_NUMBER_ID: "123456",
  KAPSO_WEBHOOK_SECRET: "test-shared-webhook-secret",
};
const payload = {
  type: "whatsapp.message.delivered",
  phone_number_id: env.KAPSO_PHONE_NUMBER_ID,
  message: {
    id: "wamid.test",
    timestamp: "1789192800",
    to: "5493515551234",
    kapso: { direction: "outbound", status: "delivered" },
  },
};
function request(
  data: unknown = payload,
  options: {
    event?: string;
    bodySuffix?: string;
    bindings?: Partial<typeof env> & { WHATSAPP_AGENT_ENABLED?: string };
    path?: string;
  } = {},
) {
  const body = JSON.stringify(data);
  return app.request(
    options.path ?? "/api/whatsapp/webhook",
    {
      method: "POST",
      body: body + (options.bodySuffix ?? ""),
      headers: {
        "X-Webhook-Signature": createHmac("sha256", env.KAPSO_WEBHOOK_SECRET)
          .update(body)
          .digest("hex"),
        ...(options.event ? { "X-Webhook-Event": options.event } : {}),
      },
    },
    { ...env, ...options.bindings },
  );
}
function persist(error: unknown = null) {
  rpc.mockReturnValue({
    abortSignal: () => Promise.resolve({ data: error ? null : true, error }),
  });
}
afterEach(() => vi.resetAllMocks());

it.each([undefined, "false", "true"])(
  "persists receipts without conversation credentials when agent enabled=%s",
  async (WHATSAPP_AGENT_ENABLED) => {
    persist();
    const response = await request(payload, {
      bindings: { WHATSAPP_AGENT_ENABLED },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, matched: true });
    expect(rpc).toHaveBeenCalledWith("record_notification_receipt", {
      p_phone_number_id: env.KAPSO_PHONE_NUMBER_ID,
      p_message_id: "wamid.test",
      p_status: "delivered",
      p_occurred_at: new Date(1789192800 * 1000).toISOString(),
      p_recipient: "5493515551234",
      p_notification_id: null,
      p_token: null,
    });
  },
);

it.each(["sent", "delivered", "read", "failed"])(
  "routes header-only %s receipts to persistence with the same secret",
  async (status) => {
    persist();
    const response = await request(
      {
        ...payload,
        type: undefined,
        message: {
          ...payload.message,
          kapso: { direction: "outbound", status },
        },
      },
      { event: `whatsapp.message.${status}` },
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "record_notification_receipt",
      expect.objectContaining({ p_status: status }),
    );
  },
);

it("rejects tampered bytes and an unconfigured shared secret before persistence", async () => {
  expect((await request(payload, { bodySuffix: " " })).status).toBe(401);
  expect(
    (await request(payload, { bindings: { KAPSO_WEBHOOK_SECRET: "" } })).status,
  ).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});

it.each(["whatsapp.message.sent", "whatsapp.message.received"])(
  "rejects a conflicting %s header before selecting a handler",
  async (event) => {
    const response = await request(payload, { event });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  },
);

it("rejects a receipt whose signed status differs from its signed event", async () => {
  const response = await request({
    ...payload,
    message: {
      ...payload.message,
      kapso: { direction: "outbound", status: "sent" },
    },
  });
  expect(response.status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it("returns non-200 when receipt persistence fails so Kapso retries", async () => {
  persist({ message: "private DB failure" });
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    error: { code: "RECEIPT_UNAVAILABLE" },
  });
});

it("ignores other business numbers and unrelated events without invoking the agent", async () => {
  for (const data of [
    { ...payload, phone_number_id: "654321" },
    { type: "whatsapp.conversation.created" },
  ]) {
    const response = await request(data);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
  }
  expect(rpc).not.toHaveBeenCalled();
});

it("requires enabled conversation configuration only for incoming messages", async () => {
  const response = await request({ type: "whatsapp.message.received" });
  expect(response.status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});

it("removes the separate notification webhook route", async () => {
  const response = await request(payload, {
    path: "/api/whatsapp/notifications/webhook",
  });
  expect(response.status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
});
