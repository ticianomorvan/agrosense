import { afterEach, expect, it, vi } from "vitest";
import { KapsoError } from "../lib/kapso";
import {
  notificationTemplate,
  readNotificationConfig,
  sendNotification,
} from "./notification";

const env = {
  KAPSO_API_KEY: "test-key",
  KAPSO_PHONE_NUMBER_ID: "123456",
  KAPSO_NOTIFICATION_TEMPLATE_NAME: "agrosense_weather_alert",
  KAPSO_NOTIFICATION_TEMPLATE_LANGUAGE: "es_AR",
};
const job = {
  id: "11111111-1111-4111-8111-111111111111",
  token: "22222222-2222-4222-8222-222222222222",
  ownerId: "33333333-3333-4333-8333-333333333333",
  recipient: "5493515551234",
  attempts: 0,
  kind: "hazard" as const,
  payload: {
    farmName: "El Ceibo",
    plotName: "Norte",
    title: "Helada",
    hazardKind: "frost" as const,
    startsAt: "2026-09-12T06:00:00+00:00",
    endsAt: "2026-09-12T08:00:00+00:00",
    generatedAt: "2026-09-12T00:00:00+00:00",
    assessmentState: "no_applicable_rule" as const,
    riskLevel: null,
    reason: "No approved rule",
    recommendedActions: [],
  },
};
afterEach(() => vi.unstubAllGlobals());

it("sends a proactive named template to the persisted recipient with a callback token", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.test" }],
    }),
  );
  const config = readNotificationConfig(env);
  expect(await sendNotification(config, job, fetcher)).toEqual({
    messageId: "wamid.test",
    status: "accepted",
  });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.kapso.ai/meta/whatsapp/v24.0/123456/messages");
  const body = JSON.parse(String(init.body));
  expect(body.to).toBe(job.recipient);
  expect(body.type).toBe("template");
  expect(body.biz_opaque_callback_data).toBe(
    `agrosense:${job.id}:${job.token}`,
  );
  expect(
    body.template.components[0].parameters.map(
      (p: { parameter_name: string }) => p.parameter_name,
    ),
  ).toEqual(["farm", "plot", "hazard", "details"]);
  expect(JSON.stringify(body)).toContain("Riesgo del cultivo no disponible");
  expect(init.redirect).toBe("manual");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("does not require the conversation agent's allowlisted owner or model config", () => {
  expect(() => readNotificationConfig(env)).not.toThrow();
  expect(() =>
    readNotificationConfig({ ...env, KAPSO_NOTIFICATION_TEMPLATE_NAME: "" }),
  ).toThrow();
});

it.each([408, 500, 503])(
  "keeps HTTP %s ambiguous and never retries a send in memory",
  async (status) => {
    const fetcher = vi.fn(async () => new Response(null, { status }));
    await expect(
      sendNotification(readNotificationConfig(env), job, fetcher),
    ).rejects.toMatchObject({ code: "SEND_OUTCOME_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it.each([
  [429, "KAPSO_RATE_LIMITED"],
  [400, "KAPSO_REJECTED"],
  [401, "KAPSO_REJECTED"],
])("classifies explicit HTTP %s rejection", async (status, code) => {
  const fetcher = vi.fn(
    async () => new Response(null, { status: Number(status) }),
  );
  await expect(
    sendNotification(readNotificationConfig(env), job, fetcher),
  ).rejects.toMatchObject({ code });
});

it("never turns malformed success into a retryable rejection", async () => {
  const fetcher = vi.fn(async () => Response.json({ messages: [] }));
  await expect(
    sendNotification(readNotificationConfig(env), job, fetcher),
  ).rejects.toBeInstanceOf(KapsoError);
  await expect(
    sendNotification(readNotificationConfig(env), job, fetcher),
  ).rejects.toMatchObject({ code: "SEND_OUTCOME_UNKNOWN" });
});

it("bounds template parameters and states withdrawal without declaring the plot safe", () => {
  const template = notificationTemplate({ ...job, kind: "withdrawal" });
  expect(template.details).toContain("retirado");
  expect(template.details).not.toContain("seguro");
  const lengthy = notificationTemplate({
    ...job,
    payload: {
      ...job.payload,
      farmName: "a".repeat(100),
      plotName: "b".repeat(100),
      title: "c".repeat(160),
    },
  });
  expect(Object.values(lengthy).join("").length).toBeLessThan(900);
});
