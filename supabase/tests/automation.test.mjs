import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";
const now = new Date().toISOString();
const later = (minutes) =>
  new Date(Date.parse(now) + minutes * 60000).toISOString();
const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ],
  ],
};
let farmId;
let plotId;

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    INSERT INTO auth.users VALUES ('${owner}'), ('${otherOwner}');`);
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(await readFile(new URL(name, dir), "utf8"));
  }
  farmId = (
    await db.query(
      "INSERT INTO farms(owner_id,name,province,boundary_geojson,declared_area_ha,data_mode) VALUES ($1,'Farm','Cordoba',$2,100,'live') RETURNING id",
      [owner, JSON.stringify(polygon)],
    )
  ).rows[0].id;
  plotId = (
    await db.query(
      `INSERT INTO plots(farm_id,name,boundary_geojson,sample_point_geojson,declared_area_ha) VALUES ($1,'Plot',$2,'{"type":"Point","coordinates":[0.1,0.1]}',10) RETURNING id`,
      [farmId, JSON.stringify(polygon)],
    )
  ).rows[0].id;
});
after(() => db.close());

async function rollback(fn) {
  await db.exec("BEGIN");
  try {
    await fn();
  } finally {
    await db.exec("ROLLBACK");
  }
}
const scalar = async (sql, args = []) =>
  (await db.query(sql, args)).rows[0]?.result;

test("cron claims a live farm once, recovers abandoned leases and fences old completion", async () => {
  await rollback(async () => {
    await db.query("UPDATE weather_schedules SET next_run_at=$1", [now]);
    const first = await scalar("SELECT claim_weather_farm($1) AS result", [
      now,
    ]);
    assert.equal(first.farmId, farmId);
    assert.equal(first.ownerId, owner);
    assert.equal(
      await scalar("SELECT claim_weather_farm($1) AS result", [now]),
      null,
    );
    const recovered = await scalar("SELECT claim_weather_farm($1) AS result", [
      later(3),
    ]);
    assert.notEqual(recovered.token, first.token);
    assert.equal(
      await scalar("SELECT fail_weather_schedule($1,$2,$3) AS result", [
        farmId,
        first.token,
        later(3),
      ]),
      false,
    );
    assert.equal(
      await scalar("SELECT fail_weather_schedule($1,$2,$3) AS result", [
        farmId,
        recovered.token,
        later(3),
      ]),
      true,
    );
    assert.equal(
      await scalar("SELECT claim_weather_farm($1) AS result", [later(7)]),
      null,
    );
    assert.equal(
      (await scalar("SELECT claim_weather_farm($1) AS result", [later(8)]))
        .farmId,
      farmId,
    );
  });
});

test("publication advances the schedule atomically without a Worker acknowledgement", async () => {
  await rollback(async () => {
    await db.query("UPDATE weather_schedules SET next_run_at=$1", [now]);
    await scalar("SELECT claim_weather_farm($1) AS result", [now]);
    await db.query(
      `UPDATE farms SET last_attempt_at=$2,last_success_at=$2,forecast_summary='{"schemaVersion":1}' WHERE id=$1`,
      [farmId, now],
    );
    assert.equal(
      await scalar("SELECT claim_weather_farm($1) AS result", [later(29)]),
      null,
    );
    assert.equal(
      (await scalar("SELECT claim_weather_farm($1) AS result", [later(30)]))
        .farmId,
      farmId,
    );
  });
});

test("demo farms never become scheduled work", async () => {
  await rollback(async () => {
    await db.query("UPDATE farms SET data_mode='demo' WHERE id=$1", [farmId]);
    assert.equal(
      await scalar("SELECT claim_weather_farm($1) AS result", [later(100)]),
      null,
    );
  });
});

test("scheduler functions cannot be executed by an authenticated or anonymous user", async () => {
  const rows = (
    await db.query(
      `SELECT has_function_privilege('authenticated',oid,'EXECUTE') OR has_function_privilege('anon',oid,'EXECUTE') AS permitted FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('claim_weather_farm','fail_weather_schedule')`,
    )
  ).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => !row.permitted));
});

test("service automation uses narrow RPCs instead of direct table privileges", async () => {
  const tablePrivileges = (
    await db.query(`SELECT relation_name, privilege,
      has_table_privilege('service_role', relation_name, privilege) AS permitted
    FROM unnest(ARRAY[
      'public.weather_schedules',
      'public.notification_contacts',
      'public.notification_outbox',
      'public.notification_receipts',
      'public.automation_runs'
    ]) AS relations(relation_name)
    CROSS JOIN unnest(ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]) AS privileges(privilege)`)
  ).rows;
  assert.ok(tablePrivileges.every((row) => !row.permitted));

  const rpcPrivileges = (
    await db.query(`SELECT proname,
      has_function_privilege('service_role', oid, 'EXECUTE') AS permitted
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'claim_weather_farm',
        'fail_weather_schedule',
        'configure_notification_contact',
        'claim_notification',
        'begin_notification_send',
        'record_notification_receipt',
        'complete_notification_send',
        'start_automation_run',
        'finish_automation_run',
        'prune_automation_history'
      )`)
  ).rows;
  assert.equal(rpcPrivileges.length, 10);
  assert.ok(rpcPrivileges.every((row) => row.permitted));

  assert.equal(
    await scalar(
      `SELECT has_function_privilege(
        'service_role', 'public.get_farm_notification_status(uuid)', 'EXECUTE'
      ) AS result`,
    ),
    false,
  );
});

test("hosted defaults and helper objects cannot widen the explicit API", async () => {
  const baseTablePrivileges = (
    await db.query(`SELECT relation_name, privilege,
      has_table_privilege('service_role', relation_name, privilege) AS permitted
    FROM unnest(ARRAY[
      'public.farms', 'public.plots', 'public.crop_cycles', 'public.events', 'public.plot_alerts'
    ]) AS relations(relation_name)
    CROSS JOIN unnest(ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]) AS privileges(privilege)`)
  ).rows;
  assert.ok(
    baseTablePrivileges.every((row) =>
      row.privilege === "SELECT" ? row.permitted : !row.permitted,
    ),
  );

  const helpers = (
    await db.query(`SELECT proname, role_name,
      has_function_privilege(role_name, oid, 'EXECUTE') AS permitted
    FROM pg_proc
    CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) AS roles(role_name)
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'set_mvp_updated_at',
        'schedule_farm_weather',
        'enqueue_plot_notification',
        'notification_is_current',
        'notification_delivery_rank',
        'apply_notification_receipts'
      )`)
  ).rows;
  assert.equal(helpers.length, 18);
  assert.ok(helpers.every((row) => !row.permitted));

  await rollback(async () => {
    await db.exec(`CREATE TABLE public.future_private_table(id bigint);
      CREATE SEQUENCE public.future_private_sequence;
      CREATE FUNCTION public.future_private_function() RETURNS integer
        LANGUAGE sql AS $$ SELECT 1 $$;`);
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(
        await scalar(
          `SELECT has_table_privilege($1, 'public.future_private_table', 'SELECT') AS result`,
          [role],
        ),
        false,
      );
      assert.equal(
        await scalar(
          `SELECT has_sequence_privilege($1, 'public.future_private_sequence', 'USAGE') AS result`,
          [role],
        ),
        false,
      );
      assert.equal(
        await scalar(
          `SELECT has_function_privilege(
            $1, 'public.future_private_function()', 'EXECUTE'
          ) AS result`,
          [role],
        ),
        false,
      );
    }
  });
});

async function alertFixture() {
  const eventId = (
    await db.query(
      `INSERT INTO events(farm_id,source_code,source_event_key,title,starts_at,ends_at,retrieved_at,evidence,is_demo)
     VALUES ($1,'open_meteo',$2,'Frost',$3,$4,$3,'{"schemaVersion":1}',false) RETURNING id`,
      [
        farmId,
        `open_meteo:frost:${plotId}:${now.slice(0, 10)}`,
        now,
        later(120),
      ],
    )
  ).rows[0].id;
  const alertId = (
    await db.query(
      `INSERT INTO plot_alerts(farm_id,plot_id,event_id,assessment_state,reason,input_snapshot,rule_version,generated_at,valid_until)
     VALUES ($1,$2,$3,'no_applicable_rule','No approved rule','{"schemaVersion":1,"cropCycle":null}','demo-v1',$4,$5) RETURNING id`,
      [farmId, plotId, eventId, now, later(60)],
    )
  ).rows[0].id;
  return { eventId, alertId };
}

async function contact() {
  await scalar(
    "SELECT configure_notification_contact($1,$2,$3,true) AS result",
    [owner, "5493515551234", now],
  );
}

test("alert and notification intent commit together; repeat publication keeps one intent", async () => {
  await rollback(async () => {
    const { alertId } = await alertFixture();
    assert.equal(
      (await db.query("SELECT * FROM notification_outbox")).rows.length,
      1,
    );
    await db.query(
      "UPDATE plot_alerts SET generated_at=$2,valid_until=$3 WHERE id=$1",
      [alertId, later(1), later(61)],
    );
    assert.equal(
      (await db.query("SELECT * FROM notification_outbox")).rows.length,
      1,
    );
    // Contact absence never prevents the alert commit, and never fabricates a recipient.
    assert.equal(
      await scalar("SELECT claim_notification($1) AS result", [later(2)]),
      null,
    );
  });
  assert.equal(
    (await db.query("SELECT * FROM notification_outbox")).rows.length,
    0,
  );
});

test("only an opted-in current owner receives a claim; revocation fences a leased send", async () => {
  await rollback(async () => {
    await alertFixture();
    await contact();
    const job = await scalar("SELECT claim_notification($1) AS result", [
      later(1),
    ]);
    assert.equal(job.recipient, "5493515551234");
    assert.equal(job.ownerId, owner);
    assert.equal(
      await scalar("SELECT claim_notification($1) AS result", [later(1)]),
      null,
    );
    await scalar(
      "SELECT configure_notification_contact($1,$2,$3,false) AS result",
      [owner, "5493515551234", now],
    );
    assert.equal(
      await scalar("SELECT begin_notification_send($1,$2,$3,$4) AS result", [
        job.id,
        job.token,
        "123456",
        later(1),
      ]),
      false,
    );
  });
});

test("a crash before sending reclaims a lease; a crash after sending becomes unknown", async () => {
  await rollback(async () => {
    await alertFixture();
    await contact();
    const first = await scalar("SELECT claim_notification($1) AS result", [
      later(1),
    ]);
    const second = await scalar("SELECT claim_notification($1) AS result", [
      later(4),
    ]);
    assert.notEqual(second.token, first.token);
    assert.equal(
      await scalar("SELECT begin_notification_send($1,$2,$3,$4) AS result", [
        first.id,
        first.token,
        "123456",
        later(4),
      ]),
      false,
    );
    assert.equal(
      await scalar("SELECT begin_notification_send($1,$2,$3,$4) AS result", [
        second.id,
        second.token,
        "123456",
        later(4),
      ]),
      true,
    );
    assert.equal(
      await scalar("SELECT claim_notification($1) AS result", [later(7)]),
      null,
    );
    assert.equal(
      (
        await db.query("SELECT status FROM notification_outbox WHERE id=$1", [
          first.id,
        ])
      ).rows[0].status,
      "unknown",
    );
  });
});

test("withdrawn and stale assessments cannot start a send", async () => {
  await rollback(async () => {
    const { eventId } = await alertFixture();
    await contact();
    const job = await scalar("SELECT claim_notification($1) AS result", [
      later(1),
    ]);
    await db.query("UPDATE events SET status='cancelled' WHERE id=$1", [
      eventId,
    ]);
    assert.equal(
      await scalar("SELECT begin_notification_send($1,$2,$3,$4) AS result", [
        job.id,
        job.token,
        "123456",
        later(1),
      ]),
      false,
    );
  });
  await rollback(async () => {
    await alertFixture();
    await contact();
    assert.equal(
      await scalar("SELECT claim_notification($1) AS result", [later(61)]),
      null,
    );
  });
});

async function sendingJob() {
  await alertFixture();
  await contact();
  const job = await scalar("SELECT claim_notification($1) AS result", [
    later(1),
  ]);
  await scalar("SELECT begin_notification_send($1,$2,$3,$4) AS result", [
    job.id,
    job.token,
    "123456",
    later(1),
  ]);
  return job;
}
const complete = (job, outcome, messageId = null, code = null, at = later(1)) =>
  scalar("SELECT complete_notification_send($1,$2,$3,$4,$5,$6) AS result", [
    job.id,
    job.token,
    outcome,
    messageId,
    code,
    at,
  ]);
const receipt = (job, status, token = job.token) =>
  scalar("SELECT record_notification_receipt($1,$2,$3,$4,$5,$6,$7) AS result", [
    "123456",
    "wamid.test",
    status,
    later(1),
    "5493515551234",
    job.id,
    token,
  ]);

test("delivery receipts reconcile a lost response and cannot regress delivered/read", async () => {
  await rollback(async () => {
    const job = await sendingJob();
    await complete(job, "unknown", null, "SEND_OUTCOME_UNKNOWN");
    await receipt(job, "delivered");
    await receipt(job, "delivered");
    await receipt(job, "sent");
    await receipt(job, "failed");
    assert.equal(
      (
        await db.query("SELECT status FROM notification_outbox WHERE id=$1", [
          job.id,
        ])
      ).rows[0].status,
      "delivered",
    );
    await receipt(job, "read");
    await complete(job, "accepted", "wamid.test");
    assert.equal(
      (
        await db.query("SELECT status FROM notification_outbox WHERE id=$1", [
          job.id,
        ])
      ).rows[0].status,
      "read",
    );
    assert.equal(
      await scalar("SELECT claim_notification($1) AS result", [later(10)]),
      null,
    );
  });
});

test("callbacks arriving before an HTTP response are retained and matched by provider ID", async () => {
  await rollback(async () => {
    const job = await sendingJob();
    await scalar(
      "SELECT record_notification_receipt($1,$2,$3,$4,$5,NULL,NULL) AS result",
      ["123456", "wamid.early", "delivered", later(1), "5493515551234"],
    );
    await complete(job, "accepted", "wamid.early");
    assert.equal(
      (
        await db.query("SELECT status FROM notification_outbox WHERE id=$1", [
          job.id,
        ])
      ).rows[0].status,
      "delivered",
    );
  });
});

test("only explicit rate limits retry, with a new attempt token and bounded attempts", async () => {
  await rollback(async () => {
    let job = await sendingJob();
    const first = job;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await complete(
        job,
        "retry",
        null,
        "KAPSO_RATE_LIMITED",
        later(attempt * 5),
      );
      const next = await scalar("SELECT claim_notification($1) AS result", [
        later(attempt * 5 + 5),
      ]);
      if (attempt === 5) {
        assert.equal(next, null);
        break;
      }
      assert.notEqual(next.token, job.token);
      job = next;
      await scalar("SELECT begin_notification_send($1,$2,$3,$4) AS result", [
        job.id,
        job.token,
        "123456",
        later(attempt * 5 + 5),
      ]);
    }
    assert.equal(await complete(first, "accepted", "wamid.old"), false);
    const row = (
      await db.query(
        "SELECT status, attempts FROM notification_outbox WHERE id=$1",
        [job.id],
      )
    ).rows[0];
    assert.deepEqual(row, { status: "failed", attempts: 5 });
  });
});

test("a wrong callback token or recipient cannot bind a provider message", async () => {
  await rollback(async () => {
    const job = await sendingJob();
    await receipt(job, "delivered", "33333333-3333-4333-8333-333333333333");
    await scalar(
      "SELECT record_notification_receipt($1,$2,$3,$4,$5,$6,$7) AS result",
      [
        "123456",
        "wamid.wrong-recipient",
        "delivered",
        later(1),
        "5493515559999",
        job.id,
        job.token,
      ],
    );
    assert.equal(
      (
        await db.query(
          "SELECT provider_message_id FROM notification_outbox WHERE id=$1",
          [job.id],
        )
      ).rows[0].provider_message_id,
      null,
    );
  });
});

test("a forecast update preserves a rate-limited retry with current evidence", async () => {
  await rollback(async () => {
    const job = await sendingJob();
    await complete(job, "retry", null, "KAPSO_RATE_LIMITED");
    await db.query("UPDATE plot_alerts SET generated_at=$1,valid_until=$2", [
      later(2),
      later(62),
    ]);
    const retry = await scalar("SELECT claim_notification($1) AS result", [
      later(3),
    ]);
    assert.ok(retry);
    assert.equal(retry.id, job.id);
    assert.equal(retry.attempts, 1);
    assert.equal(Date.parse(retry.payload.generatedAt), Date.parse(later(2)));
    assert.notEqual(retry.token, job.token);
  });
});

test("escalation and withdrawal each notify once after an accepted hazard", async () => {
  await rollback(async () => {
    const job = await sendingJob();
    await complete(job, "accepted", "wamid.hazard");
    await db.query(
      `UPDATE plot_alerts SET assessment_state='evaluated',risk_level='high',recommended_actions='["Check field"]',generated_at=$1`,
      [later(2)],
    );
    const escalation = await scalar("SELECT claim_notification($1) AS result", [
      later(3),
    ]);
    assert.equal(escalation.kind, "escalation");
    await scalar("SELECT begin_notification_send($1,$2,$3,$4) AS result", [
      escalation.id,
      escalation.token,
      "123456",
      later(3),
    ]);
    await complete(escalation, "accepted", "wamid.escalation", null, later(3));
    await db.query("UPDATE events SET status='cancelled'");
    await db.query("UPDATE plot_alerts SET generated_at=$1", [later(4)]);
    const withdrawal = await scalar("SELECT claim_notification($1) AS result", [
      later(5),
    ]);
    assert.equal(withdrawal.kind, "withdrawal");
    await scalar("SELECT begin_notification_send($1,$2,$3,$4) AS result", [
      withdrawal.id,
      withdrawal.token,
      "123456",
      later(5),
    ]);
    await complete(withdrawal, "accepted", "wamid.withdrawal", null, later(5));
    await db.query("UPDATE plot_alerts SET generated_at=$1", [later(6)]);
    assert.equal(
      await scalar("SELECT claim_notification($1) AS result", [later(7)]),
      null,
    );
    assert.equal(
      (await db.query("SELECT id FROM notification_outbox")).rows.length,
      3,
    );
  });
});

test("owner transfer and rule changes invalidate an already leased notification", async () => {
  for (const change of [
    () =>
      db.query("UPDATE farms SET owner_id=$1 WHERE id=$2", [
        otherOwner,
        farmId,
      ]),
    () =>
      db.query(
        `UPDATE farms SET custom_rules='[{"changed":true}]' WHERE id=$1`,
        [farmId],
      ),
  ]) {
    await rollback(async () => {
      await alertFixture();
      await contact();
      const job = await scalar("SELECT claim_notification($1) AS result", [
        later(1),
      ]);
      await change();
      assert.equal(
        await scalar("SELECT begin_notification_send($1,$2,$3,$4) AS result", [
          job.id,
          job.token,
          "123456",
          later(1),
        ]),
        false,
      );
    });
  }
});

test("owner delivery status is readable through RLS without exposing recipients or payloads", async () => {
  await rollback(async () => {
    await alertFixture();
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      owner,
    ]);
    await db.exec("SET LOCAL ROLE authenticated");
    const status = await scalar(
      "SELECT get_farm_notification_status($1) AS result",
      [farmId],
    );
    assert.equal(status.notifications.length, 1);
    assert.equal("recipient" in status.notifications[0], false);
    assert.equal("payload" in status.notifications[0], false);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      otherOwner,
    ]);
    assert.equal(
      await scalar("SELECT get_farm_notification_status($1) AS result", [
        farmId,
      ]),
      null,
    );
    assert.equal(
      await scalar(
        "SELECT has_column_privilege('authenticated','notification_outbox','recipient','SELECT') AS result",
      ),
      false,
    );
    assert.equal(
      await scalar(
        "SELECT has_table_privilege('authenticated','notification_contacts','SELECT') AS result",
      ),
      false,
    );
  });
});
