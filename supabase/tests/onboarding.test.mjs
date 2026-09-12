import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";
const boundary = {
  type: "Polygon",
  coordinates: [
    [
      [-64.2, -31.5],
      [-64.1, -31.5],
      [-64.1, -31.4],
      [-64.2, -31.4],
      [-64.2, -31.5],
    ],
  ],
};

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    INSERT INTO auth.users VALUES ('${owner}'), ('${otherOwner}');`);
  for (const migration of [
    "20260912070000_initial_schema.sql",
    "20260912100000_backend_completion.sql",
    "20260912120000_onboarding.sql",
  ]) {
    await db.exec(
      await readFile(
        new URL(`../migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  }
});
after(() => db.close());

async function asRole(role, identity, callback) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
    identity,
  ]);
  try {
    return await callback();
  } finally {
    await db.exec("RESET ROLE");
  }
}

test("creates an owner-scoped live farm and an atomic plot/crop cycle", async () => {
  const farmPayload = {
    name: "Las Acacias",
    province: "Córdoba",
    locality: null,
    boundary,
    declaredAreaHa: 120,
  };
  const farm = await asRole("service_role", "", async () =>
    db.query("SELECT create_user_farm($1,$2) AS result", [
      owner,
      JSON.stringify(farmPayload),
    ]),
  );
  const createdFarm = farm.rows[0].result;
  assert.equal(createdFarm.name, "Las Acacias");
  assert.equal(createdFarm.dataMode, "live");
  assert.equal(createdFarm.dataVersion, 1);

  const plotPayload = {
    name: "North field",
    boundary,
    samplePoint: { type: "Point", coordinates: [-64.15, -31.45] },
    declaredAreaHa: 80,
    cropCycle: {
      cropCode: "maize",
      seasonLabel: "2026/27",
      sownOn: "2026-09-01",
      stageCode: "V3",
      stageAsOf: "2026-09-10",
    },
  };
  const plot = await asRole("service_role", "", async () =>
    db.query("SELECT create_farm_plot($1,$2,$3,$4) AS result", [
      owner,
      createdFarm.id,
      1,
      JSON.stringify(plotPayload),
    ]),
  );
  assert.equal(plot.rows[0].result.dataVersion, 2);
  assert.equal(plot.rows[0].result.plot.activeCropCycle.cropCode, "maize");
  assert.equal(
    (await db.query("SELECT count(*)::integer AS count FROM plots")).rows[0]
      .count,
    1,
  );
  assert.equal(
    (await db.query("SELECT count(*)::integer AS count FROM crop_cycles"))
      .rows[0].count,
    1,
  );
});

test("denies browser execution and rejects wrong-owner or stale writes", async () => {
  await assert.rejects(
    asRole("authenticated", owner, () =>
      db.query("SELECT create_user_farm($1,$2)", [owner, JSON.stringify({})]),
    ),
    /permission denied/,
  );
  const farmId = (
    await db.query("SELECT id FROM farms WHERE owner_id=$1 LIMIT 1", [owner])
  ).rows[0].id;
  const payload = {
    name: "Second field",
    boundary,
    samplePoint: { type: "Point", coordinates: [-64.15, -31.45] },
    declaredAreaHa: 20,
    cropCycle: {
      cropCode: "soybean",
      seasonLabel: "2026/27",
      sownOn: null,
      stageCode: null,
      stageAsOf: null,
    },
  };
  await assert.rejects(
    asRole("service_role", "", () =>
      db.query("SELECT create_farm_plot($1,$2,$3,$4)", [
        otherOwner,
        farmId,
        2,
        JSON.stringify(payload),
      ]),
    ),
    /Farm not found/,
  );
  await assert.rejects(
    asRole("service_role", "", () =>
      db.query("SELECT create_farm_plot($1,$2,$3,$4)", [
        owner,
        farmId,
        1,
        JSON.stringify(payload),
      ]),
    ),
    /Farm changed during setup/,
  );
  assert.equal(
    (await db.query("SELECT count(*)::integer AS count FROM plots")).rows[0]
      .count,
    1,
  );
});
