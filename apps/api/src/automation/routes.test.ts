import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { automationRoutes } from "./routes";

const { rpc, processWeather, dispatchNotifications } = vi.hoisted(() => ({
  rpc: vi.fn(),
  processWeather: vi.fn(),
  dispatchNotifications: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ createServiceClient: () => ({ rpc }) }));
vi.mock("./jobs", () => ({ processWeather, dispatchNotifications }));
const runId = "11111111-1111-4111-8111-111111111111";
const secret = "a".repeat(64);
const env = {
  AUTOMATION_CRON_SECRET: secret,
  KAPSO_API_KEY: "test",
  KAPSO_PHONE_NUMBER_ID: "123456",
  KAPSO_NOTIFICATION_WEBHOOK_SECRET: "test-notification-webhook-secret",
  KAPSO_NOTIFICATION_TEMPLATE_NAME: "agrosense_weather_alert",
  KAPSO_NOTIFICATION_TEMPLATE_LANGUAGE: "en",
};
function configureRpcs() {
  rpc.mockImplementation((name: string) => ({
    abortSignal: () =>
      Promise.resolve({
        data: name === "start_automation_run" ? runId : true,
        error: null,
      }),
  }));
}
afterEach(() => {
  vi.resetAllMocks();
});

it("rejects unauthenticated, user bearer and wrong cron secrets before starting work", async () => {
  for (const authorization of [
    undefined,
    "Bearer user-jwt",
    `Bearer ${"b".repeat(64)}`,
  ]) {
    const response = await automationRoutes.request(
      "/api/internal/weather/refresh",
      {
        method: "POST",
        headers: authorization ? { Authorization: authorization } : {},
      },
      env,
    );
    expect(response.status).toBe(401);
  }
  expect(rpc).not.toHaveBeenCalled();
  expect(processWeather).not.toHaveBeenCalled();
});

it("records authenticated job completion in Supabase and accepts no user-selected targets", async () => {
  configureRpcs();
  processWeather.mockResolvedValue({ claimed: 1, published: 1 });
  const request = (body: string) =>
    automationRoutes.request(
      "/api/internal/weather/refresh",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        body,
      },
      env,
    );
  expect((await request('{"ownerId":"anything"}')).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  const response = await request("{}");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    runId,
    succeeded: true,
    result: { claimed: 1, published: 1 },
  });
  expect(rpc).toHaveBeenLastCalledWith("finish_automation_run", {
    p_id: runId,
    p_succeeded: true,
    p_result: { claimed: 1, published: 1 },
  });
});

it("records failed work without leaking upstream error contents", async () => {
  configureRpcs();
  dispatchNotifications.mockRejectedValue(
    new Error("private provider payload"),
  );
  const response = await automationRoutes.request(
    "/api/internal/notifications/dispatch",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    },
    env,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private provider");
  expect(rpc).toHaveBeenLastCalledWith("finish_automation_run", {
    p_id: runId,
    p_succeeded: false,
    p_result: { errorCode: "AUTOMATION_RUN_FAILED" },
  });
});

it("authenticates raw webhook bytes independently of the conversation agent", async () => {
  configureRpcs();
  const body = JSON.stringify({
    phone_number_id: "123456",
    message: {
      id: "wamid.test",
      timestamp: "1789192800",
      to: "5493515551234",
      kapso: { direction: "outbound", status: "delivered" },
    },
  });
  const headers = {
    "X-Webhook-Event": "whatsapp.message.delivered",
    "X-Webhook-Signature": createHmac(
      "sha256",
      env.KAPSO_NOTIFICATION_WEBHOOK_SECRET,
    )
      .update(body)
      .digest("hex"),
  };
  const request = (text: string) =>
    automationRoutes.request(
      "/api/whatsapp/notifications/webhook",
      { method: "POST", body: text, headers },
      env,
    );
  expect((await request(`${body} `)).status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
  const response = await request(body);
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith(
    "record_notification_receipt",
    expect.objectContaining({
      p_message_id: "wamid.test",
      p_status: "delivered",
    }),
  );
});

it("returns non-200 when receipt persistence fails so Kapso retries", async () => {
  rpc.mockReturnValue({
    abortSignal: () =>
      Promise.resolve({ data: null, error: { message: "private DB failure" } }),
  });
  const body = JSON.stringify({
    phone_number_id: "123456",
    message: {
      id: "wamid.test",
      timestamp: "1789192800",
      kapso: { direction: "outbound", status: "sent" },
    },
  });
  const response = await automationRoutes.request(
    "/api/whatsapp/notifications/webhook",
    {
      method: "POST",
      body,
      headers: {
        "X-Webhook-Event": "whatsapp.message.sent",
        "X-Webhook-Signature": createHmac(
          "sha256",
          env.KAPSO_NOTIFICATION_WEBHOOK_SECRET,
        )
          .update(body)
          .digest("hex"),
      },
    },
    env,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private DB");
});

it("reports unsuccessful completion when the run acknowledgement is lost", async () => {
  rpc.mockImplementation((name: string) => ({
    abortSignal: () =>
      Promise.resolve({
        data: name === "start_automation_run" ? runId : false,
        error: null,
      }),
  }));
  processWeather.mockResolvedValue({ claimed: 0, published: 0 });
  const response = await automationRoutes.request(
    "/api/internal/weather/refresh",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    },
    env,
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ succeeded: false });
});

it("limits actual job body bytes even with a misleading content length", async () => {
  const response = await automationRoutes.request(
    "/api/internal/weather/refresh",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Length": "2" },
      body: " ".repeat(1025),
    },
    env,
  );
  expect(response.status).toBe(413);
  expect(await response.json()).toHaveProperty(
    "error.code",
    "PAYLOAD_TOO_LARGE",
  );
  expect(rpc).not.toHaveBeenCalled();
});
