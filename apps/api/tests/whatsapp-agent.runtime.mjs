import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { convertV4MiniflareOptions, Miniflare, Response } from "miniflare";

test("signed webhook → isolated durable conversation → tool-backed reply, replay and restart", {
  timeout: 30000,
}, async () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const farm = "22222222-2222-4222-8222-222222222222";
  const plot = "33333333-3333-4333-8333-333333333333";
  const sender = "5493511234567";
  const secondSender = "5493519999999";
  const business = "647015955153740";
  const secret = "test_webhook_secret_not_real";
  const supabase = "https://agent-runtime.supabase.co";
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwks = {
    keys: [{ ...(await exportJWK(publicKey)), kid: "runtime", alg: "ES256" }],
  };
  const token = (subject) =>
    new SignJWT({ role: "authenticated" })
      .setSubject(subject)
      .setIssuer(`${supabase}/auth/v1`)
      .setAudience("authenticated")
      .setExpirationTime("5m")
      .setProtectedHeader({ alg: "ES256", kid: "runtime" })
      .sign(privateKey);
  const requests = [],
    sends = [],
    providerErrors = [];
  const answer =
    "North: 3–21 °C at 2 m; 0, 3 and 0.5 mm across three days. Source: Open-Meteo.";
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Cordoba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "agrosense-test",
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
        SUPABASE_PUBLISHABLE_KEY: "public_test",
        SUPABASE_JWKS_URL: `${supabase}/auth/v1/.well-known/jwks.json`,
        SUPABASE_SECRET_KEY: "secret_test",
        KAPSO_API_KEY: "kapso_test",
        KAPSO_PHONE_NUMBER_ID: business,
        KAPSO_ALLOWED_USER_ID: owner,
        WHATSAPP_AGENT_ENABLED: "true",
        KAPSO_WEBHOOK_SECRET: secret,
        OPENROUTER_API_KEY: "openrouter_test",
      },
      // All upstream traffic is intercepted; an unexpected URL fails this test.
      outboundService: async (request) => {
        try {
          const url = new URL(request.url);
          if (url.href === `${supabase}/auth/v1/.well-known/jwks.json`)
            return Response.json(jwks);
          if (url.origin === supabase) {
            assert.equal(request.headers.get("apikey"), "secret_test");
            if (url.pathname === "/rest/v1/farms") {
              assert.equal(url.searchParams.get("owner_id"), `eq.${owner}`);
              return Response.json([
                {
                  id: farm,
                  name: "Farm",
                  province: "Córdoba",
                  locality: null,
                  timezone: "America/Argentina/Cordoba",
                  data_mode: "live",
                },
              ]);
            }
            assert.equal(url.pathname, "/rest/v1/plots");
            assert.equal(url.searchParams.get("farms.owner_id"), `eq.${owner}`);
            if (url.searchParams.has("id"))
              assert.equal(url.searchParams.get("id"), `eq.${plot}`);
            else assert.equal(url.searchParams.get("farm_id"), `eq.${farm}`);
            return Response.json([
              {
                id: plot,
                farm_id: farm,
                name: "North",
                sample_point_geojson: {
                  type: "Point",
                  coordinates: [-64.2, -31.4],
                },
                farms: {
                  owner_id: owner,
                  data_mode: "live",
                  timezone: "America/Argentina/Cordoba",
                },
              },
            ]);
          }
          if (url.origin === "https://api.open-meteo.com") {
            assert.equal(url.searchParams.get("forecast_days"), "3");
            assert.equal(url.searchParams.get("latitude"), "-31.4");
            return Response.json({
              timezone: "America/Argentina/Cordoba",
              daily_units: {
                time: "iso8601",
                temperature_2m_min: "°C",
                temperature_2m_max: "°C",
                precipitation_sum: "mm",
              },
              daily: {
                time: [0, 1, 2].map((index) =>
                  new Date(Date.parse(`${today}T00:00:00Z`) + index * 86400000)
                    .toISOString()
                    .slice(0, 10),
                ),
                temperature_2m_min: [3, 2, 4],
                temperature_2m_max: [18, 19, 21],
                precipitation_sum: [0, 3, 0.5],
              },
            });
          }
          if (url.href === "https://openrouter.ai/api/v1/chat/completions") {
            const body = await request.json();
            requests.push(body);
            assert.equal(
              request.headers.get("Authorization"),
              "Bearer openrouter_test",
            );
            assert.equal(body.model, "deepseek/deepseek-v4.1-flash");
            assert.deepEqual(body.provider, {
              require_parameters: true,
              allow_fallbacks: false,
              sort: "throughput",
            });
            assert.equal(body.max_tokens, 4096);
            assert.equal(body.reasoning.effort, "medium");
            const results = body.messages.filter(
              (item) => item.role === "tool",
            );
            for (const result of results)
              assert.equal(JSON.parse(result.content).ok, true);
            const calls = [
              ["list_farms", {}],
              ["list_plots", { farmId: farm }],
              ["get_forecast", { plotId: plot, days: 3 }],
            ];
            if (results.length < 3) {
              const [name, args] = calls[results.length];
              return Response.json({
                id: `gen_${results.length}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: body.model,
                choices: [
                  {
                    index: 0,
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: null,
                      reasoning_details: [
                        {
                          type: "reasoning.text",
                          id: `rs_${results.length}`,
                          format: "unknown",
                          index: 0,
                          text: `private-test-reasoning-${results.length}`,
                          signature: "opaque-signature",
                        },
                      ],
                      tool_calls: [
                        {
                          id: `call_${results.length}`,
                          type: "function",
                          function: { name, arguments: JSON.stringify(args) },
                        },
                      ],
                    },
                  },
                ],
              });
            }
            const reasoning = body.messages.flatMap(
              (item) => item.reasoning_details ?? [],
            );
            assert.equal(reasoning.length, 3);
            assert.ok(
              reasoning.every(
                (item) =>
                  item.text.startsWith("private-test-reasoning-") &&
                  item.signature === "opaque-signature",
              ),
            );
            assert.equal(JSON.parse(results[2].content).data.days.length, 3);
            return Response.json({
              id: "gen_final",
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: body.model,
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  message: { role: "assistant", content: answer },
                },
              ],
            });
          }
          assert.equal(
            url.href,
            `https://api.kapso.ai/meta/whatsapp/v24.0/${business}/messages`,
          );
          assert.equal(request.headers.get("X-API-Key"), "kapso_test");
          const body = await request.json();
          assert.ok([sender, secondSender].includes(body.to));
          assert.equal(body.text.body, answer);
          sends.push(body);
          return Response.json({
            messaging_product: "whatsapp",
            messages: [{ id: `wamid.reply.${sends.length}` }],
          });
        } catch (error) {
          providerErrors.push(error);
          return Response.json(
            { error: "Mock assertion failed" },
            { status: 500 },
          );
        }
      },
    }),
  );
  try {
    const auth = { Authorization: `Bearer ${await token(owner)}` };
    const event = (id, from = sender) => ({
      phone_number_id: business,
      message: {
        id,
        from,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: "How is the forecast for three days?" },
        kapso: { direction: "inbound", status: "received" },
      },
      conversation: { phone_number_id: business, phone_number: from },
    });
    const webhook = (payload, headers = {}) => {
      const body =
        typeof payload === "string" ? payload : JSON.stringify(payload);
      return mf.dispatchFetch("https://local/api/whatsapp/webhook", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Event": "whatsapp.message.received",
          "X-Webhook-Signature": createHmac("sha256", secret)
            .update(body)
            .digest("hex"),
          ...headers,
        },
      });
    };
    const status = (id, headers = auth, runSender = sender) =>
      mf.dispatchFetch(
        `https://local/api/whatsapp/agent/runs/${id}?sender=${encodeURIComponent(runSender)}`,
        {
          headers,
        },
      );
    assert.equal(
      (
        await mf.dispatchFetch(
          "https://local/api/whatsapp/agent/runs/wamid.1",
          { headers: auth },
        )
      ).status,
      400,
    );
    assert.equal((await status("wamid.1", {})).status, 401);
    assert.equal(
      (
        await status("wamid.1", {
          Authorization: `Bearer ${await token(farm)}`,
        })
      ).status,
      403,
    );
    assert.equal(
      (await webhook(event("bad"), { "X-Webhook-Signature": "0".repeat(64) }))
        .status,
      401,
    );
    assert.equal((await webhook("{")).status, 400);
    assert.equal((await webhook("x".repeat(131073))).status, 413);
    assert.equal(requests.length, 0);
    const initial = event("wamid.1");
    assert.deepEqual(await (await webhook(initial)).json(), {
      accepted: 1,
      duplicates: 0,
      ignored: 0,
    });
    const waitAccepted = async (id, runSender = sender) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const response = await status(id, auth, runSender);
        assert.equal(response.status, 200);
        assert.match(response.headers.get("cache-control"), /no-store/);
        const run = await response.json();
        if (["accepted", "failed", "send_unknown"].includes(run.status)) {
          assert.deepEqual(providerErrors, []);
          assert.equal(
            run.status,
            "accepted",
            JSON.stringify({
              run,
              modelRequests: requests.length,
              sends: sends.length,
            }),
          );
          assert.equal(run.modelSteps, 4);
          assert.deepEqual(
            run.trace.map((item) => item.tool),
            ["list_farms", "list_plots", "get_forecast"],
          );
          assert.ok(run.trace.every((item) => item.ok));
          assert.equal(
            JSON.stringify(run).includes("private-test-reasoning"),
            false,
          );
          return;
        }
        await delay(50);
      }
      assert.fail("Durable alarm did not complete");
    };
    await waitAccepted("wamid.1");
    const name = createHash("sha256")
      .update(JSON.stringify([owner, business, sender]))
      .digest("hex");
    await mf.unsafeEvictDurableObject(
      "agrosense-test",
      "WhatsAppConversation",
      { name },
    );
    assert.deepEqual(
      await (await webhook(initial, { "X-Idempotency-Key": "changed" })).json(),
      { accepted: 0, duplicates: 1, ignored: 0 },
    );
    const changed = structuredClone(initial);
    changed.message.text.body = "Changed content";
    const conflict = await webhook(changed);
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {
      error: {
        code: "MESSAGE_CONFLICT",
        message: "Message ID reused with different content",
      },
    });
    const missing = await status("wamid.absent");
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      error: { code: "NOT_FOUND", message: "Run not found" },
    });
    assert.match(missing.headers.get("cache-control"), /no-store/);
    assert.equal(sends.length, 1);
    assert.equal((await webhook(event("wamid.2"))).status, 200);
    await waitAccepted("wamid.2");
    assert.equal(sends.length, 2);
    assert.equal(requests.length, 8);
    assert.deepEqual(requests[4].messages.slice(1, 3), [
      { role: "user", content: initial.message.text.body },
      { role: "assistant", content: answer },
    ]);

    const isolated = event("wamid.other", secondSender);
    isolated.message.text.body = "Use a separate conversation for me.";
    assert.deepEqual(await (await webhook(isolated)).json(), {
      accepted: 1,
      duplicates: 0,
      ignored: 0,
    });
    assert.equal((await status("wamid.other")).status, 404);
    await waitAccepted("wamid.other", secondSender);
    assert.equal(sends.length, 3);
    assert.deepEqual(
      requests[8].messages.filter((item) =>
        ["user", "assistant"].includes(item.role),
      ),
      [{ role: "user", content: isolated.message.text.body }],
    );
  } finally {
    await mf.dispose();
  }
});
