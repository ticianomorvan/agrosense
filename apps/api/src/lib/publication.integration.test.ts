/// <reference types="node" />
import { readdir, readFile } from "node:fs/promises";
import { DEMO_V1_RULESET, riskRuleSchema } from "@agrosense/contracts";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { dispatchNotifications, processWeather } from "../automation/jobs";
import { readNotificationConfig } from "../automation/notification";
import { loadDashboard } from "./dashboard";
import { importDemoSeed } from "./demo-seed";
import { refreshFarm } from "./refresh";
import { createServiceClient, createUserClient } from "./supabase";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const now = "2026-09-12T00:00:00.000Z";
const config = {
  url: "http://127.0.0.1:54321",
  publishableKey: "test-key",
  jwksUrl: "http://127.0.0.1:54321/auth/v1/.well-known/jwks.json",
};

// Exercise the real SDK's RPC serialization and every checked-in migration.
function databaseFetch(role: "service_role" | "authenticated"): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const name = url.pathname.split("/").at(-1);
    if (!name || !/^[a-z_]+$/.test(name) || !url.pathname.includes("/rpc/"))
      throw new Error("Unexpected database request");
    const args = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    const entries = Object.entries(args);
    if (entries.some(([key]) => !/^p_[a-z_]+$/.test(key)))
      throw new Error("Unexpected RPC argument");
    await db.exec(`SET ROLE ${role}`);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
      role === "authenticated" ? owner : "",
    ]);
    try {
      const result = await db.query<{ result: unknown }>(
        `SELECT ${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(",")}) AS result`,
        entries.map(([, value]) =>
          typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : value,
        ),
      );
      return Response.json(result.rows[0]?.result ?? null);
    } catch (error) {
      return Response.json(
        { message: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    } finally {
      await db.exec("RESET ROLE");
    }
  };
}
const serviceClient = createServiceClient(
  {
    SUPABASE_URL: config.url,
    SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
    SUPABASE_JWKS_URL: config.jwksUrl,
    SUPABASE_SECRET_KEY: "test-secret",
  },
  databaseFetch("service_role"),
);
const userClient = createUserClient(
  config,
  "test-token",
  databaseFetch("authenticated"),
);
const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [4, 0],
      [4, 8],
      [0, 8],
      [0, 0],
    ],
  ],
};
const seed = {
  farm: {
    name: "Farm",
    province: "Cordoba",
    locality: null,
    boundary: polygon,
    declaredAreaHa: 100,
  },
  plots: [
    {
      name: "Lote Norte",
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 4],
            [0, 4],
            [0, 0],
          ],
        ],
      },
      samplePoint: { type: "Point", coordinates: [1, 2] },
      declaredAreaHa: 10,
      cropCycle: {
        cropCode: "maize",
        seasonLabel: "2026/27",
        stageCode: "V6",
        stageAsOf: "2026-09-10",
        sownOn: null,
      },
    },
    {
      name: "Lote Centro",
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [2, 0],
            [4, 0],
            [4, 4],
            [2, 4],
            [2, 0],
          ],
        ],
      },
      samplePoint: { type: "Point", coordinates: [3, 2] },
      declaredAreaHa: 12,
      cropCycle: {
        cropCode: "soybean",
        seasonLabel: "2026/27",
        stageCode: "R4",
        stageAsOf: "2026-09-10",
        sownOn: null,
      },
    },
    {
      name: "Lote Sur",
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [0, 4],
            [2, 4],
            [2, 8],
            [0, 8],
            [0, 4],
          ],
        ],
      },
      samplePoint: { type: "Point", coordinates: [1, 6] },
      declaredAreaHa: 9,
      cropCycle: {
        cropCode: "maize",
        seasonLabel: "2026/27",
        stageCode: "V6",
        stageAsOf: "2026-09-10",
        sownOn: null,
      },
    },
  ],
};

beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    INSERT INTO auth.users VALUES ('${owner}');`);
  const dir = new URL("../../../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(new URL(name, dir), "utf8"));
});
afterAll(() => db.close());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("imports alerts with actual event and complete current-cycle snapshots", async () => {
  const imported = await importDemoSeed(
    serviceClient,
    owner,
    seed,
    new Date(now),
  );
  const dashboard = await loadDashboard(userClient, imported.farmId, now);
  expect(dashboard?.events).toHaveLength(2);
  const event = dashboard?.events[0];
  const alert = event?.alerts.find(
    (item) => item.plotId === dashboard?.plots[0]?.id,
  );
  expect(alert?.inputSnapshot.event.id).toBe(event?.id);
  expect(alert?.inputSnapshot.cropCycle).toEqual(
    dashboard?.plots[0]?.activeCropCycle,
  );
  expect(alert?.isStale).toBe(false);
});

it("denies authenticated access to every overload of the refresh RPCs", async () => {
  const result = await db.query<{ permitted: boolean }>(
    `SELECT has_function_privilege('authenticated',oid,'EXECUTE') AS permitted FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('admit_farm_refresh','publish_farm_refresh','fail_farm_refresh')`,
  );
  expect(result.rows.length).toBeGreaterThan(0);
  expect(result.rows.every((row) => !row.permitted)).toBe(true);
});

async function liveFarm() {
  const imported = await importDemoSeed(
    serviceClient,
    owner,
    { ...seed, plots: [seed.plots[0]] },
    new Date(now),
  );
  const approvedRule = riskRuleSchema.parse({
    ...DEMO_V1_RULESET.rules.find((rule) => rule.code === "demo-maize-v6"),
    reviewState: "approved",
    evidenceUrl: "https://example.com/test-rule",
  });
  await db.query(
    "UPDATE farms SET data_mode='live', custom_rules=$2 WHERE id=$1",
    [imported.farmId, JSON.stringify([approvedRule])],
  );
  await db.query("DELETE FROM events WHERE farm_id=$1", [imported.farmId]);
  return imported;
}

function weather(temperature: number) {
  return Response.json({
    hourly: { time: ["2026-09-12T00:00"], temperature_2m: [temperature] },
  });
}

it("publishes generated alerts that the dashboard can read and preserves IDs on refresh", async () => {
  const { farmId } = await liveFarm();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => weather(-2)),
  );
  const result = await refreshFarm(userClient, serviceClient, farmId, owner);
  expect(result).toMatchObject({
    dataVersion: 2,
    eventCount: 1,
    alertCount: 1,
  });
  const first = await loadDashboard(userClient, farmId, now);
  const event = first?.events[0];
  const alert = event?.alerts[0];
  expect(alert).toMatchObject({
    riskLevel: "high",
    ruleVersion: "demo-v1",
    isStale: false,
  });
  expect(alert?.inputSnapshot.cropCycle).toEqual(
    first?.plots.find((plot) => plot.id === alert?.plotId)?.activeCropCycle,
  );
  expect(alert?.inputSnapshot.event.id).toBe(event?.id);

  const later = "2026-09-12T00:02:00.000Z";
  vi.setSystemTime(new Date(later));
  await refreshFarm(userClient, serviceClient, farmId, owner);
  const second = await loadDashboard(userClient, farmId, later);
  expect(second?.events).toHaveLength(1);
  expect(second?.events[0]?.id).toBe(event?.id);
  expect(second?.events[0]?.alerts[0]?.id).toBe(alert?.id);
  expect(second?.events[0]?.alerts[0]?.inputSnapshot.event.id).toBe(event?.id);
  expect(second?.monitoring.status).toBe("fresh");
});

it("atomically cancels withdrawn hazards and replaces their evaluated alerts", async () => {
  const { farmId } = await liveFarm();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => weather(-2)),
  );
  await refreshFarm(userClient, serviceClient, farmId, owner);
  const first = await loadDashboard(userClient, farmId, now);
  const later = "2026-09-12T00:02:00.000Z";
  vi.setSystemTime(new Date(later));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => weather(8)),
  );
  await refreshFarm(userClient, serviceClient, farmId, owner);
  const second = await loadDashboard(userClient, farmId, later);
  expect(second?.events[0]).toMatchObject({
    id: first?.events[0]?.id,
    status: "cancelled",
  });
  expect(second?.events[0]?.alerts[0]).toMatchObject({
    id: first?.events[0]?.alerts[0]?.id,
    assessmentState: "no_applicable_rule",
    riskLevel: null,
    recommendedActions: [],
    reason: "Forecast withdrawn by newer data.",
    isStale: false,
    inputSnapshot: {
      event: {
        id: first?.events[0]?.id,
        status: "cancelled",
        evidence: { hours: [{ temperatureC: 8 }] },
      },
    },
  });
});

it("preserves the last publication when the provider fails", async () => {
  const { farmId } = await liveFarm();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => weather(-2)),
  );
  await refreshFarm(userClient, serviceClient, farmId, owner);
  const first = await loadDashboard(userClient, farmId, now);
  const later = "2026-09-12T00:02:00.000Z";
  vi.setSystemTime(new Date(later));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await expect(
    refreshFarm(userClient, serviceClient, farmId, owner),
  ).rejects.toMatchObject({
    failure: { kind: "unavailable", code: "PROVIDER_UNAVAILABLE" },
  });
  const second = await loadDashboard(userClient, farmId, later);
  expect(second?.farm.dataVersion).toBe(first?.farm.dataVersion);
  expect(second?.forecast).toEqual(first?.forecast);
  expect(second?.events).toEqual(first?.events);
  expect(second?.monitoring.lastErrorCode).toBe("PROVIDER_UNAVAILABLE");
});

it("rejects publication after a concurrent farm edit", async () => {
  const { farmId } = await liveFarm();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await db.query(
        "UPDATE farms SET data_version=data_version+1 WHERE id=$1",
        [farmId],
      );
      return weather(-2);
    }),
  );
  await expect(
    refreshFarm(userClient, serviceClient, farmId, owner),
  ).rejects.toMatchObject({ failure: { kind: "conflict" } });
  const dashboard = await loadDashboard(userClient, farmId, now);
  expect(dashboard?.forecast).toBeNull();
  expect(dashboard?.events).toEqual([]);
  expect(dashboard?.monitoring.lastErrorCode).toBeNull();
});

it("rejects null compare-and-swap tokens and a mismatched owner", async () => {
  const { farmId } = await liveFarm();
  const args = {
    p_owner_id: owner,
    p_farm_id: farmId,
    p_expected_data_version: null,
    p_attempt_at: null,
    p_published_at: now,
    p_forecast: { schemaVersion: 1 },
    p_events: [],
  };
  const rejected = await serviceClient.rpc(
    "publish_farm_refresh",
    args as never,
  );
  expect(rejected.error?.message).toBe("VERSION_CONFLICT");
  const admission = await serviceClient.rpc("admit_farm_refresh", {
    p_owner_id: owner,
    p_farm_id: farmId,
    p_attempt_at: now,
  });
  expect(admission.error).toBeNull();
  for (const tokens of [
    { p_expected_data_version: null, p_attempt_at: now },
    { p_expected_data_version: 1, p_attempt_at: null },
  ]) {
    const result = await serviceClient.rpc("publish_farm_refresh", {
      ...args,
      ...tokens,
    } as never);
    expect(result.error?.message).toBe("VERSION_CONFLICT");
  }
  const notOwned = await serviceClient.rpc("admit_farm_refresh", {
    p_owner_id: "22222222-2222-4222-8222-222222222222",
    p_farm_id: farmId,
    p_attempt_at: now,
  });
  expect(notOwned.error?.message).toBe("NOT_FOUND");
  const direct = await userClient.rpc("publish_farm_refresh", args as never);
  expect(direct.error?.message).toMatch(/permission denied/);
  const dashboard = await loadDashboard(userClient, farmId, now);
  expect(dashboard?.farm.dataVersion).toBe(1);
  expect(dashboard?.forecast).toBeNull();
});

it("runs scheduled weather → rules → outbox → Kapso → delivery with duplicate wakeups", async () => {
  await db.exec("BEGIN");
  try {
    const { farmId } = await liveFarm();
    // Isolate due work from other fixtures; the production claims have no farm input.
    await db.query(
      "UPDATE weather_schedules SET next_run_at=CASE WHEN farm_id=$1 THEN $2::timestamptz ELSE '9999-01-01'::timestamptz END",
      [farmId, now],
    );
    await db.query("UPDATE notification_outbox SET status='cancelled'");
    const contact = await serviceClient.rpc("configure_notification_contact", {
      p_owner_id: owner,
      p_phone_number: "5493515551234",
      p_consented_at: now,
      p_enabled: true,
    });
    expect(contact.error).toBeNull();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    const weatherFetcher = vi.fn(async () => weather(-2));
    vi.stubGlobal("fetch", weatherFetcher);
    const first = await processWeather(serviceClient);
    expect(first).toMatchObject({
      farmId,
      claimed: 1,
      published: 1,
      eventCount: 1,
      alertCount: 1,
    });
    expect(await processWeather(serviceClient)).toEqual({
      claimed: 0,
      published: 0,
    });
    expect(weatherFetcher).toHaveBeenCalledTimes(1);
    const dashboard = await loadDashboard(userClient, farmId, now);
    expect(dashboard?.events[0]?.alerts[0]?.riskLevel).toBe("high");
    const sends: Record<string, unknown>[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.to).toBe("5493515551234");
      expect(body.type).toBe("text");
      expect(body.text.body).toContain("AgroSense: Weather alert");
      sends.push(body);
      return Response.json({
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.integration" }],
      });
    };
    const notificationConfig = readNotificationConfig({
      KAPSO_API_KEY: "test",
      KAPSO_PHONE_NUMBER_ID: "123456",
    });
    const sent = await dispatchNotifications(
      serviceClient,
      notificationConfig,
      { fetcher },
    );
    expect(sent).toMatchObject({ claimed: 1, accepted: 1 });
    expect(
      await dispatchNotifications(serviceClient, notificationConfig, {
        fetcher,
      }),
    ).toMatchObject({ claimed: 0 });
    vi.setSystemTime(new Date("2026-09-12T00:31:00Z"));
    expect(await processWeather(serviceClient)).toMatchObject({
      claimed: 1,
      published: 1,
    });
    expect(
      await dispatchNotifications(serviceClient, notificationConfig, {
        fetcher,
      }),
    ).toMatchObject({ claimed: 0 });
    expect(sends).toHaveLength(1);
    const [, notificationId, token] = String(
      sends[0]?.biz_opaque_callback_data,
    ).split(":");
    const args = {
      p_phone_number_id: "123456",
      p_message_id: "wamid.integration",
      p_status: "delivered",
      p_occurred_at: now,
      p_recipient: "5493515551234",
      p_notification_id: notificationId ?? null,
      p_token: token ?? null,
    };
    expect(
      (await serviceClient.rpc("record_notification_receipt", args)).error,
    ).toBeNull();
    expect(
      (await serviceClient.rpc("record_notification_receipt", args)).error,
    ).toBeNull();
    const status = await userClient.rpc("get_farm_notification_status", {
      p_farm_id: farmId,
    });
    expect(status.error).toBeNull();
    expect(status.data).toMatchObject({
      notifications: [{ status: "delivered", attempts: 1 }],
    });
    expect(JSON.stringify(status.data)).not.toContain("5493515551234");
  } finally {
    await db.exec("ROLLBACK");
  }
});
