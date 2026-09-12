import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const polygon = JSON.stringify({
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ],
  ],
});
let farms, plots, events;
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    INSERT INTO auth.users VALUES ('${a}'), ('${b}');`);
  await db.exec(
    await readFile(
      new URL(
        "../migrations/20260912070000_initial_schema.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../migrations/20260912080000_alert_engine_contract.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  farms = [];
  plots = [];
  events = [];
  for (const owner of [a, b]) {
    const farm = (
      await db.query(
        `INSERT INTO farms(owner_id,name,province,boundary_geojson,declared_area_ha) VALUES ($1,'Farm','Cordoba',$2,100) RETURNING id`,
        [owner, polygon],
      )
    ).rows[0].id;
    farms.push(farm);
    const plot = (
      await db.query(
        `INSERT INTO plots(farm_id,name,boundary_geojson,sample_point_geojson,declared_area_ha) VALUES ($1,'Plot',$2,'{"type":"Point","coordinates":[0.1,0.1]}',10) RETURNING id`,
        [farm, polygon],
      )
    ).rows[0].id;
    plots.push(plot);
    await db.query(
      `INSERT INTO crop_cycles(plot_id,crop_code,season_label) VALUES ($1,'maize','2026/27')`,
      [plot],
    );
    const event = (
      await db.query(
        `INSERT INTO events(farm_id,source_code,source_event_key,title,starts_at,ends_at,retrieved_at,evidence,is_demo) VALUES ($1,'demo','frost:2026-09-12','Frost','2026-09-12','2026-09-13','2026-09-12','{"schemaVersion":1}',true) RETURNING id`,
        [farm],
      )
    ).rows[0].id;
    events.push(event);
    await db.query(
      `INSERT INTO plot_alerts(farm_id,plot_id,event_id,assessment_state,reason,input_snapshot,rule_version,generated_at,valid_until) VALUES ($1,$2,$3,'insufficient_data','Unknown stage','{"schemaVersion":1}','v1','2026-09-12','2026-09-13')`,
      [farm, plot, event],
    );
  }
});
after(() => db.close());

async function asRole(role, owner, fn) {
  await db.exec(`SET ROLE ${role}`);
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [
    owner,
  ]);
  try {
    await fn();
  } finally {
    await db.exec("RESET ROLE");
  }
}
test("RLS isolates both owners across all five tables and denies direct writes", async () => {
  for (const owner of [a, b])
    await asRole("authenticated", owner, async () => {
      for (const table of [
        "farms",
        "plots",
        "crop_cycles",
        "events",
        "plot_alerts",
      ]) {
        assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length, 1);
        for (const action of [
          `DELETE FROM ${table}`,
          `UPDATE ${table} SET id=id`,
          `INSERT INTO ${table} DEFAULT VALUES`,
        ])
          await assert.rejects(db.exec(action), /permission denied/);
      }
      assert.equal(
        (await db.query("SELECT owner_id FROM farms")).rows[0].owner_id,
        owner,
      );
    });
  await asRole("anon", "", async () =>
    assert.rejects(db.exec("SELECT * FROM farms"), /permission denied/),
  );
  await asRole("authenticated", "", async () =>
    assert.equal((await db.query("SELECT * FROM farms")).rows.length, 0),
  );
  await asRole("service_role", "", async () =>
    assert.equal((await db.query("SELECT * FROM farms")).rows.length, 2),
  );
});
test("rejects duplicate open cycles, invalid stages, and incomplete refresh state", async () => {
  await assert.rejects(
    db.query(
      `INSERT INTO crop_cycles(plot_id,crop_code,season_label) VALUES ($1,'soybean','2026/27')`,
      [plots[0]],
    ),
    /unique/,
  );
  await assert.rejects(
    db.query(
      `UPDATE crop_cycles SET stage_code='R6',stage_as_of='2026-09-12' WHERE plot_id=$1`,
      [plots[0]],
    ),
    /check constraint/,
  );
  await assert.rejects(
    db.query(
      `UPDATE farms SET forecast_summary='{"schemaVersion":1}' WHERE id=$1`,
      [farms[0]],
    ),
    /check constraint/,
  );
});
test("rejects cross-farm alerts and invalid risk state", async () => {
  await assert.rejects(
    db.query("UPDATE plot_alerts SET event_id=$1 WHERE plot_id=$2", [
      events[1],
      plots[0],
    ]),
    /foreign key/,
  );
  await assert.rejects(
    db.query(`UPDATE plot_alerts SET risk_level='high' WHERE plot_id=$1`, [
      plots[0],
    ]),
    /check constraint/,
  );
  await db.query(
    `UPDATE plot_alerts SET assessment_state='evaluated', risk_level='critical', recommended_actions='["Suspend spraying"]' WHERE plot_id=$1`,
    [plots[0]],
  );
  await db.query(`UPDATE events SET kind='hail' WHERE id=$1`, [events[0]]);
  await assert.rejects(
    db.query(`UPDATE events SET kind='tornado' WHERE id=$1`, [events[0]]),
    /check constraint/,
  );
});
test("updates timestamps and cascades only event alerts", async () => {
  const before = (
    await db.query("SELECT updated_at FROM farms WHERE id=$1", [farms[0]])
  ).rows[0].updated_at;
  await db.query(`UPDATE farms SET name='Renamed' WHERE id=$1`, [farms[0]]);
  assert.ok(
    (await db.query("SELECT updated_at FROM farms WHERE id=$1", [farms[0]]))
      .rows[0].updated_at > before,
  );
  await assert.rejects(
    db.query("DELETE FROM farms WHERE id=$1", [farms[0]]),
    /foreign key/,
  );
  await db.query("DELETE FROM events WHERE id=$1", [events[0]]);
  assert.equal(
    (await db.query("SELECT * FROM plot_alerts WHERE plot_id=$1", [plots[0]]))
      .rows.length,
    0,
  );
});
