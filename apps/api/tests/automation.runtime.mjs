import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare, Response } from "miniflare";

test("Worker authenticates Supabase jobs, dispatches a text notification once and verifies delivery receipts", {
  timeout: 30000,
}, async () => {
  const secret = "a".repeat(64);
  const webhookSecret = "runtime_notification_webhook_secret";
  const id = "11111111-1111-4111-8111-111111111111";
  const token = "22222222-2222-4222-8222-222222222222";
  const now = new Date().toISOString();
  const supabase = "https://automation-runtime.supabase.co";
  const calls = [],
    sends = [],
    errors = [];
  let claimed = false;
  let state = "pending";
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
      compatibilityDate: "2026-09-12",
      durableObjects: {
        WHATSAPP_CONVERSATIONS: {
          className: "WhatsAppConversation",
          useSQLite: true,
        },
      },
      bindings: {
        SUPABASE_URL: supabase,
        SUPABASE_SECRET_KEY: "secret_test",
        SUPABASE_PUBLISHABLE_KEY: "public_test",
        SUPABASE_JWKS_URL: `${supabase}/auth/v1/.well-known/jwks.json`,
        AUTOMATION_CRON_SECRET: secret,
        KAPSO_API_KEY: "kapso_test",
        KAPSO_PHONE_NUMBER_ID: "123456",
        KAPSO_NOTIFICATION_WEBHOOK_SECRET: webhookSecret,
      },
      outboundService: async (request) => {
        try {
          const url = new URL(request.url);
          const body = await request.json();
          if (url.origin === supabase) {
            assert.equal(request.headers.get("apikey"), "secret_test");
            const rpc = url.pathname.replace("/rest/v1/rpc/", "");
            calls.push(rpc);
            switch (rpc) {
              case "start_automation_run":
                return Response.json(id);
              case "finish_automation_run":
                return Response.json(true);
              case "claim_weather_farm":
                return Response.json(null);
              case "claim_notification": {
                if (claimed) return Response.json(null);
                claimed = true;
                return Response.json({
                  id,
                  token,
                  ownerId: id,
                  recipient: "5493515551234",
                  kind: "hazard",
                  attempts: 0,
                  payload: {
                    farmName: "Farm",
                    plotName: "Plot",
                    title: "Frost",
                    hazardKind: "frost",
                    startsAt: now,
                    endsAt: new Date(Date.now() + 3600000).toISOString(),
                    generatedAt: now,
                    assessmentState: "no_applicable_rule",
                    riskLevel: null,
                    reason: "No approved rule",
                    recommendedActions: [],
                  },
                });
              }
              case "begin_notification_send":
                assert.equal(body.p_token, token);
                state = "sending";
                return Response.json(true);
              case "complete_notification_send":
                assert.equal(body.p_outcome, "accepted");
                assert.equal(body.p_message_id, "wamid.runtime");
                state = "accepted";
                return Response.json(true);
              case "record_notification_receipt":
                assert.equal(body.p_notification_id, id);
                assert.equal(body.p_token, token);
                assert.equal(body.p_status, "delivered");
                state = "delivered";
                return Response.json(true);
              default:
                throw new Error(`Unexpected RPC ${rpc}`);
            }
          }
          assert.equal(
            url.href,
            "https://api.kapso.ai/meta/whatsapp/v24.0/123456/messages",
          );
          assert.equal(request.headers.get("X-API-Key"), "kapso_test");
          assert.equal(state, "sending");
          assert.equal(body.type, "text");
          assert.match(body.text.body, /AgroSense: Weather alert/);
          assert.equal(
            body.biz_opaque_callback_data,
            `agrosense:${id}:${token}`,
          );
          sends.push(body);
          return Response.json({
            messaging_product: "whatsapp",
            messages: [{ id: "wamid.runtime" }],
          });
        } catch (error) {
          errors.push(error);
          return Response.json(
            { error: "unexpected request" },
            { status: 500 },
          );
        }
      },
    }),
  );
  try {
    const job = (path, bearer = secret) =>
      mf.dispatchFetch(`https://worker.test/api/internal/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}` },
        body: "{}",
      });
    assert.equal((await job("weather/refresh", "b".repeat(64))).status, 401);
    assert.equal(calls.length, 0);
    assert.equal((await job("weather/refresh")).status, 200);
    assert.ok(calls.includes("claim_weather_farm"));
    assert.equal((await job("notifications/dispatch")).status, 200);
    assert.equal(state, "accepted");
    assert.equal((await job("notifications/dispatch")).status, 200);
    assert.equal(sends.length, 1);
    const body = JSON.stringify({
      phone_number_id: "123456",
      message: {
        id: "wamid.runtime",
        to: "5493515551234",
        timestamp: String(Math.floor(Date.now() / 1000)),
        biz_opaque_callback_data: `agrosense:${id}:${token}`,
        kapso: { direction: "outbound", status: "delivered" },
      },
    });
    const headers = {
      "X-Webhook-Event": "whatsapp.message.delivered",
      "X-Webhook-Signature": createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex"),
    };
    const receipt = (text) =>
      mf.dispatchFetch(
        "https://worker.test/api/whatsapp/notifications/webhook",
        { method: "POST", body: text, headers },
      );
    assert.equal((await receipt(`${body} `)).status, 401);
    assert.equal((await receipt(body)).status, 200);
    assert.equal(state, "delivered");
    assert.equal(errors.length, 0, String(errors[0]));
  } finally {
    await mf.dispose();
  }
});
