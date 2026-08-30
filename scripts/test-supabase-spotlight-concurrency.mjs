import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const workdir = process.env.SUPABASE_LOCAL_WORKDIR
  ? path.resolve(process.env.SUPABASE_LOCAL_WORKDIR)
  : "";
assert.ok(workdir, "SUPABASE_LOCAL_WORKDIR must identify the isolated local Preview workdir.");

const config = readFileSync(path.join(workdir, "supabase", "config.toml"), "utf8");
const projectIdMatch = config.match(/^project_id\s*=\s*"([a-z][a-z0-9-]{7,62})"\s*$/mu);
assert.ok(projectIdMatch, "The isolated local Preview config has no valid project_id.");
const databaseContainer = `supabase_db_${projectIdMatch[1]}`;
const cycleMonth = "2097-01-01";
const selectionTime = "2096-12-31T16:05:00Z";
const accountIds = [
  "72000000-0000-4000-8000-000000000001",
  "72000000-0000-4000-8000-000000000002",
];

function psqlBaseArguments(tuplesOnly = false) {
  return [
    "exec", "-i", databaseContainer,
    "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet",
    ...(tuplesOnly ? ["--tuples-only", "--no-align"] : []),
    "--username", "postgres", "--dbname", "postgres",
  ];
}

function psqlArguments(sql, tuplesOnly = false) {
  return [...psqlBaseArguments(tuplesOnly), "--command", sql];
}

function query(sql, { tuplesOnly = true } = {}) {
  const result = spawnSync("docker", psqlArguments(sql, tuplesOnly), {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "local PostgreSQL query failed");
  return result.stdout.trim();
}

function concurrent(sql, { interactive = false } = {}) {
  const child = spawn(
    "docker",
    interactive ? psqlBaseArguments(true) : psqlArguments(sql, true),
    { cwd: root },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const complete = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Spotlight concurrency session exceeded 12 seconds"));
    }, 12_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
  if (interactive) child.stdin.write(sql);
  return { child, complete };
}

async function waitForSignal(signal, session) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const held = query(`
      select count(distinct locks.pid)
      from pg_catalog.pg_locks as locks
      inner join pg_catalog.pg_stat_activity as activity on activity.pid = locks.pid
      where locks.locktype = 'advisory'
        and locks.classid = 0
        and locks.objid = ${signal}
        and locks.granted
        and activity.application_name = 'mochirii-spotlight-concurrency-first'
    `);
    if (held === "1") return;
    if (session.child.exitCode !== null) {
      const result = await session.complete;
      throw new Error(`Spotlight first session exited before signal with status ${result.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Spotlight first session did not reach the concurrency barrier");
}

async function waitForBlockedSelection(first, second) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const blocked = query(`
      select count(distinct waiting.pid)
      from pg_catalog.pg_stat_activity as second_activity
      inner join pg_catalog.pg_locks as waiting
        on waiting.pid = second_activity.pid
       and waiting.locktype = 'advisory'
       and waiting.granted = false
      inner join pg_catalog.pg_stat_activity as first_activity
        on first_activity.application_name = 'mochirii-spotlight-concurrency-first'
      inner join pg_catalog.pg_locks as held
        on held.pid = first_activity.pid
       and held.locktype = waiting.locktype
       and held.database is not distinct from waiting.database
       and held.classid = waiting.classid
       and held.objid = waiting.objid
       and held.objsubid = waiting.objsubid
       and held.granted = true
      where second_activity.application_name = 'mochirii-spotlight-concurrency-second'
        and second_activity.wait_event_type = 'Lock'
        and second_activity.wait_event = 'advisory'
    `);
    if (blocked === "1") return;
    for (const [label, session] of [["first", first], ["second", second]]) {
      if (session.child.exitCode !== null) {
        const result = await session.complete;
        throw new Error(`Spotlight ${label} session exited before lock proof with status ${result.status}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Spotlight second session did not block on the first session's monthly lock");
}

function heldSelectionTransaction(signal) {
  return `
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '4s';
    set local application_name = 'mochirii-spotlight-concurrency-first';
    select 'RESULT|' || row_to_json(result)::text
    from private.select_monthly_member_spotlight('${selectionTime}'::timestamptz) as result;
    select pg_advisory_xact_lock(${signal});
  `;
}

function selectionTransaction() {
  return `
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '4s';
    set local application_name = 'mochirii-spotlight-concurrency-second';
    select 'RESULT|' || row_to_json(result)::text
    from private.select_monthly_member_spotlight('${selectionTime}'::timestamptz) as result;
    commit;
  `;
}

function resultRecord(result) {
  assert.equal(result.status, 0, "a concurrent Spotlight selector session failed");
  const match = result.stdout.match(/^RESULT\|(\{[^\r\n]+\})$/mu);
  assert.ok(match, "a concurrent Spotlight selector result was not categorical JSON");
  return JSON.parse(match[1]);
}

let first = null;
let second = null;
try {
  query(`
    delete from public.member_spotlight_selections where cycle_month = '${cycleMonth}';
    delete from auth.users where id in ('${accountIds[0]}', '${accountIds[1]}');
    insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      ('${accountIds[0]}', 'authenticated', 'authenticated', 'spotlight-concurrency-a@example.invalid', '', now(), now(), now()),
      ('${accountIds[1]}', 'authenticated', 'authenticated', 'spotlight-concurrency-b@example.invalid', '', now(), now(), now());
    update public.member_profiles
    set member_status = 'active',
        display_name = case id
          when '${accountIds[0]}' then 'Concurrency Alpha'
          else 'Concurrency Beta'
        end
    where id in ('${accountIds[0]}', '${accountIds[1]}');
  `, { tuplesOnly: false });

  const signal = 812081301;
  first = concurrent(heldSelectionTransaction(signal), { interactive: true });
  await waitForSignal(signal, first);
  second = concurrent(selectionTransaction());
  await waitForBlockedSelection(first, second);
  first.child.stdin.end("commit;\n\\quit\n");
  const [firstResult, secondResult] = await Promise.all([first.complete, second.complete]);
  const records = [resultRecord(firstResult), resultRecord(secondResult)];

  assert.equal(records.filter((record) => record.created === true).length, 1, "exactly one caller must create the month");
  assert.equal(records.filter((record) => record.created === false).length, 1, "exactly one caller must replay the month");
  assert.equal(records[0].selected_cycle_month, cycleMonth, "the first caller returned the wrong month");
  assert.equal(records[1].selected_cycle_month, cycleMonth, "the second caller returned the wrong month");
  assert.equal(records[0].selected_winner_name, records[1].selected_winner_name, "concurrent callers returned different winners");
  assert.equal(query(`
    select concat_ws('|', count(*)::text, min(winner_display_name), max(winner_display_name))
    from public.member_spotlight_selections
    where cycle_month = '${cycleMonth}'
  `), `1|${records[0].selected_winner_name}|${records[0].selected_winner_name}`, "concurrent calls did not retain one exact row");
} finally {
  if (first?.child.exitCode === null && !first.child.stdin.writableEnded) {
    first.child.stdin.end("rollback;\n\\quit\n");
  }
  await Promise.allSettled(
    [first?.complete, second?.complete].filter(Boolean),
  );
  query(`
    delete from public.member_spotlight_selections where cycle_month = '${cycleMonth}';
    delete from auth.users where id in ('${accountIds[0]}', '${accountIds[1]}');
  `, { tuplesOnly: false });
}

console.log("Monthly Spotlight concurrency OK (one creator, one replay, one exact winner).");
