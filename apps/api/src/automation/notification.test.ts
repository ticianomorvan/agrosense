import { expect, it, vi } from "vitest";
import {
  formatNotificationText,
  readNotificationConfig,
  sendNotification,
} from "./notification";

const env = {
  KAPSO_API_KEY: "test-key",
  KAPSO_PHONE_NUMBER_ID: "123456",
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
    title: "Frost",
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

it("sends a plain text notification to the persisted recipient with a callback token", async () => {
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
  expect(body.type).toBe("text");
  expect(body.biz_opaque_callback_data).toBe(
    `agrosense:${job.id}:${job.token}`,
  );
  expect(body.text.body).toContain("AgroSense: Weather alert");
  expect(body.text.body).toContain("Crop risk unavailable");
  expect(init.redirect).toBe("manual");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("does not require the conversation agent's allowlisted owner or model config", () => {
  expect(() => readNotificationConfig(env)).not.toThrow();
});

it.each([
  [429, "KAPSO_RATE_LIMITED"],
  [400, "KAPSO_REJECTED"],
  [500, "SEND_OUTCOME_UNKNOWN"],
])(
  "preserves the shared adapter's HTTP %s outcome without retrying",
  async (status, code) => {
    const fetcher = vi.fn(
      async () => new Response(null, { status: Number(status) }),
    );
    await expect(
      sendNotification(readNotificationConfig(env), job, fetcher),
    ).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("states a withdrawal with the original event window", () => {
  const text = formatNotificationText({ ...job, kind: "withdrawal" });
  expect(text).toContain("Forecast withdrawn due to newer data.");
  expect(text).toContain("09/12, 03:00–09/12, 05:00 (Córdoba).");
});

it("includes increased crop risk and bounds long assessment details in the final text", () => {
  const text = formatNotificationText({
    ...job,
    kind: "escalation",
    payload: {
      ...job.payload,
      farmName: "a".repeat(100),
      plotName: "b".repeat(100),
      title: "c".repeat(160),
      assessmentState: "evaluated",
      riskLevel: "high",
      reason: "r".repeat(1000),
      recommendedActions: ["s".repeat(1000)],
    },
  });
  expect(text).toContain("Increased risk. Crop risk: high.");
  expect(text).toContain(`${"r".repeat(179)}…`);
  expect(text).toContain(`${"s".repeat(139)}…`);
  expect(text.length).toBeLessThan(1024);
});
