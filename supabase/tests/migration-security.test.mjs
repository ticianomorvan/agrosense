import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;`);

  const dir = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(dir))
    .filter(
      (file) =>
        file.endsWith(".sql") &&
        file <= "20260912101000_refresh_transaction.sql",
    )
    .sort()) {
    await db.exec(await readFile(new URL(name, dir), "utf8"));
  }
});

after(() => db.close());

test("every intermediate refresh RPC remains service-role-only", async () => {
  const rows = (
    await db.query(`SELECT proname,
      has_function_privilege('anon', oid, 'EXECUTE') AS anon_can_execute,
      has_function_privilege('authenticated', oid, 'EXECUTE') AS user_can_execute,
      has_function_privilege('service_role', oid, 'EXECUTE') AS service_can_execute
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('admit_farm_refresh', 'publish_farm_refresh', 'fail_farm_refresh')
    ORDER BY proname`)
  ).rows;

  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => !row.anon_can_execute));
  assert.ok(rows.every((row) => !row.user_can_execute));
  assert.ok(rows.every((row) => row.service_can_execute));
});
