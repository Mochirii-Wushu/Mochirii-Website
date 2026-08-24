import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

function psqlArguments(sql, tuplesOnly = false) {
  return [
    "exec", "-i", databaseContainer,
    "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet",
    ...(tuplesOnly ? ["--tuples-only", "--no-align"] : []),
    "--username", "postgres", "--dbname", "postgres",
    "--command", sql,
  ];
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

function concurrent(sql) {
  const child = spawn("docker", psqlArguments(sql), { cwd: root });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const complete = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("concurrent PostgreSQL session exceeded 8 seconds"));
    }, 8_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
  return { child, complete };
}

function interactive() {
  const argumentsWithoutCommand = psqlArguments("", false).slice(0, -2);
  const child = spawn("docker", argumentsWithoutCommand, { cwd: root });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const complete = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("interactive PostgreSQL session exceeded 8 seconds"));
    }, 8_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
  return {
    child,
    complete,
    write(sql) {
      assert.equal(child.exitCode, null, "interactive PostgreSQL session already exited");
      child.stdin.write(sql);
    },
    close() {
      child.stdin.end();
    },
  };
}

async function waitForSignal(signal, childSession) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const held = query(`
      select count(*)
      from pg_locks
      where locktype = 'advisory'
        and classid = 0
        and objid = ${signal}
        and granted
    `);
    if (held === "1") return;
    if (childSession.child.exitCode !== null) {
      const result = await childSession.complete;
      throw new Error(`concurrent session exited before signal ${signal} with status ${result.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`concurrent session did not acquire signal ${signal}`);
}

async function waitForBlockedGrantPastExpiry(applicationName, childSession) {
  assert.match(applicationName, /^[a-z0-9-]+$/u, "invalid PostgreSQL application-name canary");
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const blockedPastExpiry = query(`
      select count(*)
      from pg_stat_activity as activity
      where activity.application_name = '${applicationName}'
        and activity.wait_event_type = 'Lock'
        and cardinality(pg_blocking_pids(activity.pid)) > 0
        and clock_timestamp() >= activity.xact_start + interval '700 milliseconds'
    `);
    if (blockedPastExpiry === "1") return;
    if (childSession.child.exitCode !== null) {
      const result = await childSession.complete;
      throw new Error(`grant session exited before the lock/expiry barrier with status ${result.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("grant session did not remain lock-blocked through its expiry instant");
}

function serviceTransaction(subject, expectedRevision, active, discordVerified, signal, pause = true) {
  const verifiedAt = discordVerified ? "transaction_timestamp() - interval '1 day'" : "null";
  const expiresAt = discordVerified ? "transaction_timestamp() + interval '6 days'" : "null";
  return `
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '4s';
    set local role service_role;
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    select * from public.commit_member_entitlement_snapshot_core_v1(
      '${subject}', ${expectedRevision}, ${active}, ${discordVerified}, ${verifiedAt}, ${expiresAt}
    );
    reset role;
    ${signal ? `select pg_advisory_xact_lock(${signal});` : ""}
    ${pause ? "select pg_sleep(1.2);" : ""}
    commit;
  `;
}

function expiryTransaction(signal, pause = true, horizonDays = 7) {
  return `
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '4s';
    select * from private.process_member_entitlement_expiries_core_v1(
      clock_timestamp() + make_interval(days => ${horizonDays}), 100
    );
    ${signal ? `select pg_advisory_xact_lock(${signal});` : ""}
    ${pause ? "select pg_sleep(1.2);" : ""}
    commit;
  `;
}

function refreshHoldingSubjectLock(subject, expectedRevision, signal) {
  return `
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '4s';
    set local role service_role;
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    select * from public.commit_member_entitlement_snapshot_core_v1(
      '${subject}', ${expectedRevision}, true, true,
      transaction_timestamp(), transaction_timestamp() + interval '7 days'
    );
    reset role;
    select pg_advisory_xact_lock(${signal});
    select pg_sleep(1.2);
    commit;
  `;
}

function nearExpiryGrantWaitingForSubjectLock(subject, expectedRevision, applicationName) {
  return `
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '4s';
    set local application_name = '${applicationName}';
    set local role service_role;
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    select * from public.commit_member_entitlement_snapshot_core_v1(
      '${subject}', ${expectedRevision}, true, true,
      transaction_timestamp() - interval '7 days' + interval '700 milliseconds',
      transaction_timestamp() + interval '700 milliseconds'
    );
    reset role;
    commit;
  `;
}

function beginSubjectLockHold(subject, signal) {
  return `
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '4s';
    select 1
    from private.member_entitlement_subject_locks
    where subject = '${subject}'
    for update;
    select pg_advisory_xact_lock(${signal});
  `;
}

function expectConflict(result, message) {
  assert.notEqual(result.status, 0, message);
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.match(combined, /Member entitlement revision conflict/u, message);
  assert.doesNotMatch(combined, /deadlock detected|lock timeout/u, message);
}

function snapshot(subject) {
  const result = query(`
    select concat_ws('|',
      state.revision::text,
      state.active::text,
      state.discord_verified::text,
      (select count(*)::text from private.member_entitlement_events as event
       where event.subject = state.subject),
      (select count(*)::text
       from private.member_entitlement_event_targets as target
       join private.member_entitlement_events as event on event.event_id = target.event_id
       where event.subject = state.subject),
      (select count(*)::text from private.member_entitlement_expiry_due as due
       where due.subject = state.subject),
      (select count(*)::text
       from private.member_entitlement_events as event
       where event.event_id = state.event_id
         and row(state.subject, state.revision, state.active, state.discord_verified,
                 state.verified_at, state.expires_at, state.entitled_at_effective_time, state.effective_at)
           is distinct from
             row(event.subject, event.revision, event.active, event.discord_verified,
                 event.verified_at, event.expires_at, event.entitled_at_effective_time, event.effective_at))
    )
    from private.member_entitlement_state as state
    where state.subject = '${subject}'
  `);
  assert.ok(result, `missing state for concurrency subject ${subject}`);
  return result;
}

const subject = randomUUID();

try {
  query(`update private.member_entitlement_runtime_control
         set producer_enabled = true, expiry_sweeper_enabled = true where singleton`, { tuplesOnly: false });

  const firstSignal = 812081201;
  const first = concurrent(serviceTransaction(subject, 0, true, false, firstSignal));
  await waitForSignal(firstSignal, first);
  const duplicate = concurrent(serviceTransaction(subject, 0, true, false, 0, false));
  expectConflict(await duplicate.complete, "simultaneous first materialization did not fail closed");
  assert.equal((await first.complete).status, 0, "first materialization session failed");
  assert.equal(snapshot(subject), "1|true|false|1|2|0|0");

  const transitionSignal = 812081202;
  const transition = concurrent(serviceTransaction(subject, 1, true, true, transitionSignal));
  await waitForSignal(transitionSignal, transition);
  const competing = concurrent(serviceTransaction(subject, 1, false, false, 0, false));
  expectConflict(await competing.complete, "simultaneous state transition did not fail closed");
  assert.equal((await transition.complete).status, 0, "winning transition session failed");
  assert.equal(snapshot(subject), "2|true|true|2|4|1|0");

  const expirySignal = 812081203;
  const expiry = concurrent(expiryTransaction(expirySignal));
  await waitForSignal(expirySignal, expiry);
  const staleRefresh = concurrent(serviceTransaction(subject, 2, true, true, 0, false));
  expectConflict(await staleRefresh.complete, "commit-versus-expiry race did not fail closed");
  assert.equal((await expiry.complete).status, 0, "expiry session failed");
  assert.equal(snapshot(subject), "3|true|false|3|6|0|0");

  query(serviceTransaction(subject, 3, true, true, 0, false), { tuplesOnly: false });
  const refreshSignal = 812081205;
  const refresh = concurrent(refreshHoldingSubjectLock(subject, 4, refreshSignal));
  await waitForSignal(refreshSignal, refresh);
  const waitingExpiry = concurrent(expiryTransaction(0, false, 6));
  assert.equal((await refresh.complete).status, 0, "winning refresh session failed");
  assert.equal((await waitingExpiry.complete).status, 0, "waiting expiry session failed");
  assert.equal(
    snapshot(subject),
    "5|true|true|5|10|1|0",
    "a refreshed future due row survives a competing expiry statement",
  );

  const staleGrantSignal = 812081206;
  const staleGrantApplication = "mochirii-near-expiry-grant";
  const lockHolder = interactive();
  lockHolder.write(beginSubjectLockHold(subject, staleGrantSignal));
  await waitForSignal(staleGrantSignal, lockHolder);
  const staleGrant = concurrent(nearExpiryGrantWaitingForSubjectLock(subject, 5, staleGrantApplication));
  await waitForBlockedGrantPastExpiry(staleGrantApplication, staleGrant);
  lockHolder.write("commit;\n\\q\n");
  lockHolder.close();
  assert.equal((await lockHolder.complete).status, 0, "subject-lock holder failed");
  const staleGrantResult = await staleGrant.complete;
  assert.notEqual(staleGrantResult.status, 0, "a grant that expires while waiting for the subject lock must fail closed");
  assert.match(`${staleGrantResult.stdout}\n${staleGrantResult.stderr}`, /Verified entitlement timestamps are invalid/u);
  assert.doesNotMatch(`${staleGrantResult.stdout}\n${staleGrantResult.stderr}`, /deadlock detected|lock timeout/u);
  assert.equal(snapshot(subject), "5|true|true|5|10|1|0");

  const workerSignal = 812081204;
  const workerOne = concurrent(expiryTransaction(workerSignal));
  await waitForSignal(workerSignal, workerOne);
  const workerTwo = concurrent(expiryTransaction(0, false));
  assert.equal((await workerTwo.complete).status, 0, "second expiry worker failed instead of skipping locked work");
  assert.equal((await workerOne.complete).status, 0, "first expiry worker failed");
  assert.equal(snapshot(subject), "6|true|false|6|12|0|0");

  assert.equal(query(`
    select count(*)
    from private.member_entitlement_events as event
    left join lateral (
      select array_agg(target.consumer order by target.consumer) as consumers
      from private.member_entitlement_event_targets as target
      where target.event_id = event.event_id
    ) as required on true
    where event.subject = '${subject}'
      and required.consumers is distinct from array['forums', 'social']::text[]
  `), "0", "a concurrent event lacks the exact consumer target set");
} finally {
  query(`update private.member_entitlement_runtime_control
         set producer_enabled = false, expiry_sweeper_enabled = false where singleton`, { tuplesOnly: false });
}

console.log("Member entitlement concurrency OK (first-write, transition, both commit/expiry orders, dual-worker)." );
