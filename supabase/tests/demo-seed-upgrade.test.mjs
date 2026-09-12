import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationName = "20260912122000_demo_seed_events.sql";
const migrations = new URL("../migrations/", import.meta.url);
const ownerId = "11111111-1111-4111-8111-111111111111";
const farm = {
  name: "Upgrade fixture",
  province: "Cordoba",
  locality: null,
  boundary: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  declaredAreaHa: 10,
};

function event(kind) {
  return {
    sourceEventKey: `demo:${kind}:2026-09-12`,
    kind,
    title: `Demo ${kind}`,
    startsAt: "2026-09-12T12:00:00Z",
    endsAt: "2026-09-12T13:00:00Z",
    retrievedAt: "2026-09-12T11:30:00Z",
    evidence: { schemaVersion: 1 },
    alerts: [],
  };
}

test("upgrades the deployed seed RPC without rewriting its migration or existing data", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
    await db.query("INSERT INTO auth.users VALUES ($1)", [ownerId]);
    for (const name of (await readdir(migrations))
      .filter((name) => name.endsWith(".sql") && name < migrationName)
      .sort()) {
      await db.exec(await readFile(new URL(name, migrations), "utf8"));
    }

    async function importSeed(payload) {
      await db.exec("SET ROLE service_role");
      try {
        const result = await db.query(
          "SELECT public.import_demo_seed($1, $2::jsonb) AS imported",
          [ownerId, JSON.stringify(payload)],
        );
        return result.rows[0].imported;
      } finally {
        await db.exec("RESET ROLE");
      }
    }

    const legacy = await importSeed({
      farm,
      plots: [],
      event: event("frost"),
      alerts: [],
    });
    assert.equal(typeof legacy.eventId, "string");

    await db.exec(await readFile(new URL(migrationName, migrations), "utf8"));
    const current = await importSeed({
      farm,
      plots: [],
      events: [event("frost"), event("extreme-heat")],
    });
    assert.equal(current.eventIds.length, 2);
    assert.notEqual(current.eventIds[0], current.eventIds[1]);
    const rows = (
      await db.query(
        "SELECT id, farm_id, kind FROM public.events ORDER BY kind",
      )
    ).rows;
    assert.deepEqual(
      rows.filter((row) => row.farm_id === legacy.farmId),
      [{ id: legacy.eventId, farm_id: legacy.farmId, kind: "frost" }],
    );
    assert.deepEqual(
      rows
        .filter((row) => row.farm_id === current.farmId)
        .map((row) => row.id)
        .sort(),
      current.eventIds.slice().sort(),
    );
    const [permissions] = (
      await db.query(`SELECT
        has_function_privilege('anon', 'public.import_demo_seed(uuid,jsonb)', 'EXECUTE') AS anon,
        has_function_privilege('authenticated', 'public.import_demo_seed(uuid,jsonb)', 'EXECUTE') AS authenticated,
        has_function_privilege('service_role', 'public.import_demo_seed(uuid,jsonb)', 'EXECUTE') AS service_role`)
    ).rows;
    assert.deepEqual(permissions, {
      anon: false,
      authenticated: false,
      service_role: true,
    });
  } finally {
    await db.close();
  }
});
