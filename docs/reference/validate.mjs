// Run: node docs/reference/validate.mjs /path/to/temporary/npm-prefix
// Prefix needs @electric-sql/pglite, ajv, ajv-formats; no app dependencies change.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

assert(
  process.argv[2],
  "Pass a temporary npm prefix containing validation dependencies.",
);
const require = createRequire(resolve(process.argv[2], "package.json"));
const { PGlite } = require("@electric-sql/pglite");
const Ajv = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");
const dir = fileURLToPath(new URL(".", import.meta.url));
const api = JSON.parse(readFileSync(resolve(dir, "mvp.openapi.json"), "utf8"));
const example = JSON.parse(
  readFileSync(resolve(dir, "dashboard.example.json"), "utf8"),
);
const sql = readFileSync(resolve(dir, "mvp-schema.sql"), "utf8");
const schemas = JSON.parse(
  JSON.stringify(api.components.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validators = new Map();
for (const name of Object.keys(schemas)) {
  const validate = ajv.compile({ $defs: schemas, $ref: `#/$defs/${name}` });
  validators.set(name, validate);
  for (const value of schemas[name].examples ?? []) {
    assert(
      validate(value),
      `${name} example: ${JSON.stringify(validate.errors)}`,
    );
  }
}
const valid = (name, value) => {
  const validate = validators.get(name);
  assert(validate(value), `${name}: ${JSON.stringify(validate.errors)}`);
};
const invalid = (name, value) =>
  assert.equal(
    validators.get(name)(value),
    false,
    `${name} should reject input`,
  );
valid("DashboardResponse", example);
assert.deepEqual(example, api.components.schemas.DashboardResponse.examples[0]);
invalid("DashboardResponse", { ...example, unexpected: true });
invalid("Position", [-181, 0]);
invalid("Position", [0, 0, 1]);
invalid("ForecastHour", { at: "2026-09-12T06:00:00Z", temperatureC: null });
invalid("UpdateCropCycleRequest", { expectedDataVersion: 1 });
invalid("UpdateCropCycleRequest", { expectedDataVersion: 1, stageCode: "V6" });
invalid("UpdateCropCycleRequest", {
  expectedDataVersion: 1,
  ownerId: example.farm.id,
});
const cycle = example.plots[0].activeCropCycle;
invalid("CropCycle", { ...cycle, stageCode: "R4" });
invalid("CropCycle", { ...cycle, stageAsOf: null });
const alert = example.events[0].alerts[0];
invalid("PlotAlert", { ...alert, riskLevel: null });
invalid("PlotAlert", { ...alert, assessmentState: "insufficient_data" });
invalid("Generation", { method: "llm", modelId: null, promptVersion: null });
invalid("Source", { ...example.events[0].source, isDemo: false });
console.log(
  `PASS: ${validators.size} schemas compile; examples and 13 invalid-input cases checked.`,
);

const db = new PGlite();
let assertions = 0;
const reject = async (query, params, code) => {
  let failure;
  try {
    await db.query(query, params);
  } catch (error) {
    failure = error;
  }
  assert(failure, "Expected database rejection");
  assert.equal(failure.code, code);
  assertions++;
};
try {
  // Isolated test harness only. Real Supabase supplies these objects/roles.
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
  `);
  await db.exec(sql);
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const ownerA = uuid(101),
    ownerB = uuid(102),
    farmA = uuid(201),
    farmB = uuid(202);
  const plotA = uuid(301),
    plotB = uuid(302),
    eventA = uuid(401);
  await db.query("INSERT INTO auth.users(id) VALUES ($1),($2)", [
    ownerA,
    ownerB,
  ]);
  const insertFarm =
    "INSERT INTO public.farms(id,owner_id,name,province,boundary_geojson,declared_area_ha) VALUES ($1,$2,$3,$4,$5,100)";
  await db.query(insertFarm, [
    farmA,
    ownerA,
    "A",
    "Córdoba",
    example.farm.boundary,
  ]);
  await db.query(insertFarm, [
    farmB,
    ownerB,
    "B",
    "Córdoba",
    example.farm.boundary,
  ]);
  const insertPlot =
    "INSERT INTO public.plots(id,farm_id,name,boundary_geojson,sample_point_geojson,declared_area_ha) VALUES ($1,$2,$3,$4,$5,100)";
  await db.query(insertPlot, [
    plotA,
    farmA,
    "A",
    example.plots[0].boundary,
    example.plots[0].samplePoint,
  ]);
  await db.query(insertPlot, [
    plotB,
    farmB,
    "B",
    example.plots[0].boundary,
    example.plots[0].samplePoint,
  ]);
  const insertCycle =
    "INSERT INTO public.crop_cycles(plot_id,crop_code,season_label,stage_code,stage_as_of) VALUES ($1,$2,$3,$4,$5)";
  await db.query(insertCycle, [plotA, "maize", "2026/27", "V6", "2026-09-11"]);
  await reject(
    insertCycle,
    [plotA, "maize", "2026/27", "V3", "2026-09-11"],
    "23505",
  );
  await reject(
    insertCycle,
    [plotB, "maize", "2026/27", "R4", "2026-09-11"],
    "23514",
  );
  await reject(insertCycle, [plotB, "soybean", "2026/27", "R4", null], "23514");
  await db.query(insertCycle, [
    plotB,
    "soybean",
    "2026/27",
    "R4",
    "2026-09-11",
  ]);
  await reject(
    "UPDATE public.farms SET boundary_geojson=$1 WHERE id=$2",
    [{ type: "Polygon" }, farmA],
    "23514",
  );
  await reject(
    "UPDATE public.farms SET forecast_summary=$1 WHERE id=$2",
    [{ schemaVersion: 1 }, farmA],
    "23514",
  );
  const insertEvent = `INSERT INTO public.events(id,farm_id,source_code,source_event_key,title,starts_at,ends_at,retrieved_at,evidence,is_demo)
    VALUES ($1,$2,'demo','demo:frost:2026-09-12','Demo','2026-09-12T06:00:00Z','2026-09-12T08:00:00Z','2026-09-12T04:00:00Z',$3,true)`;
  await db.query(insertEvent, [eventA, farmA, example.events[0].evidence]);
  await reject(
    insertEvent,
    [uuid(402), farmA, example.events[0].evidence],
    "23505",
  );
  const insertAlert = `INSERT INTO public.plot_alerts(farm_id,plot_id,event_id,assessment_state,risk_level,reason,recommendation,input_snapshot,rule_version,generated_at,valid_until)
    VALUES ($1,$2,$3,'evaluated','high','demo','demo',$4,'demo-v1','2026-09-12T04:00:00Z','2026-09-12T05:00:00Z')`;
  await reject(
    insertAlert,
    [farmA, plotB, eventA, alert.inputSnapshot],
    "23503",
  );
  await db.query(insertAlert, [farmA, plotA, eventA, alert.inputSnapshot]);
  await reject(
    "UPDATE public.plot_alerts SET risk_level=NULL WHERE event_id=$1",
    [eventA],
    "23514",
  );
  await reject(
    "UPDATE public.plot_alerts SET valid_until=generated_at WHERE event_id=$1",
    [eventA],
    "23514",
  );
  await reject("DELETE FROM public.farms WHERE id=$1", [farmA], "23001");
  await reject("DELETE FROM auth.users WHERE id=$1", [ownerA], "23001");
  const defaults = (
    await db.query(
      "SELECT data_version, data_mode, forecast_summary, timezone FROM public.farms WHERE id=$1",
      [farmA],
    )
  ).rows[0];
  assert.deepEqual(defaults, {
    data_version: 1,
    data_mode: "demo",
    forecast_summary: null,
    timezone: "America/Argentina/Cordoba",
  });
  await db.exec("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    ownerB,
  ]);
  assert.equal((await db.query("SELECT id FROM public.farms")).rows.length, 1);
  assert.equal((await db.query("SELECT id FROM public.plots")).rows.length, 1);
  assert.equal(
    (await db.query("SELECT id FROM public.crop_cycles")).rows.length,
    1,
  );
  assert.equal((await db.query("SELECT id FROM public.events")).rows.length, 0);
  assert.equal(
    (await db.query("SELECT id FROM public.plot_alerts")).rows.length,
    0,
  );
  await reject(
    "UPDATE public.farms SET name=$1 WHERE id=$2",
    ["Changed", farmB],
    "42501",
  );
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    ownerA,
  ]);
  assert.equal((await db.query("SELECT id FROM public.events")).rows.length, 1);
  assert.equal(
    (await db.query("SELECT id FROM public.plot_alerts")).rows.length,
    1,
  );
  await db.exec("RESET ROLE; SET ROLE anon");
  await reject("SELECT id FROM public.farms", [], "42501");
  await db.exec("RESET ROLE");
  await db.query("DELETE FROM public.events WHERE id=$1", [eventA]);
  assert.equal(
    (await db.query("SELECT id FROM public.plot_alerts")).rows.length,
    0,
  );
  console.log(
    `PASS: DDL executes; defaults, ${assertions} constraint/permission rejections, owner-scoped reads on all five tables, and event-alert cascade verified.`,
  );
} finally {
  await db.close();
}
console.log(
  "Limit: this validates schema structure and isolated PostgreSQL behavior, not deployed Supabase/Auth integration or unimplemented mutation RPCs.",
);
