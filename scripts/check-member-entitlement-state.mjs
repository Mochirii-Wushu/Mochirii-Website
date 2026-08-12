import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationNames = readdirSync(path.join(root, "supabase", "migrations"))
  .filter((name) => name.endsWith("_member_entitlement_state_foundation.sql"));
assert.equal(migrationNames.length, 1, "exactly one entitlement foundation migration is required");

const migrationPath = path.join(root, "supabase", "migrations", migrationNames[0]);
const migration = readFileSync(migrationPath, "utf8").replaceAll("\r\n", "\n");
const testPath = path.join(root, "supabase", "tests", "member_entitlement_state_foundation_test.sql");
const test = readFileSync(testPath, "utf8").replaceAll("\r\n", "\n");
const documentationPath = path.join(
  root,
  "docs",
  "integrations",
  "member-entitlement-state-foundation.v1.md",
);
const documentation = readFileSync(documentationPath, "utf8").replaceAll("\r\n", "\n");
const documentationCompact = documentation.replace(/\s+/gu, " ");

const tables = [
  "member_entitlement_runtime_control",
  "member_entitlement_subject_locks",
  "member_entitlement_events",
  "member_entitlement_state",
  "member_entitlement_event_targets",
  "member_entitlement_expiry_due",
];

const indexes = [
  "member_entitlement_events_subject_effective_idx",
  "member_entitlement_expiry_due_order_idx",
];

const policies = tables.map((table) => `${table}_client_deny`);

const triggers = ["member_entitlement_events_append_only"];

const functions = [
  "private.reject_member_entitlement_event_mutation",
  "public.commit_member_entitlement_snapshot_core_v1",
  "private.process_member_entitlement_expiries_core_v1",
  "private.run_member_entitlement_expiry_sweep_v1",
];

function validateMigration(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  const createdTables = [...normalized.matchAll(
    /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:[a-z0-9_]+\.)?[a-z0-9_]+)\s*\(/giu,
  )].map((match) => match[1].toLowerCase());
  assert.equal(
    [...normalized.matchAll(
      /create\s+(?:(?:global|local)\s+)?(?:(?:temp(?:orary)?|unlogged|foreign)\s+)*table\b/giu,
    )].length,
    createdTables.length,
    "every regular, temporary, unlogged, or foreign table creation must use the exact reviewed form",
  );
  assert.deepEqual(
    createdTables,
    tables.map((table) => `private.${table}`),
    "every table created by the foundation migration must be in the exact ordered inventory",
  );

  const createdIndexes = [...normalized.matchAll(
    /create\s+(?:unique\s+)?(?:nulls\s+(?:not\s+)?distinct\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?((?:[a-z0-9_]+\.)?[a-z0-9_]+)\s+on\s+((?:[a-z0-9_]+\.)?[a-z0-9_]+)/giu,
  )].map((match) => `${match[1].toLowerCase()}:${match[2].toLowerCase()}`);
  assert.equal(
    [...normalized.matchAll(/create\s+(?:unique\s+)?(?:nulls\s+(?:not\s+)?distinct\s+)?index\b/giu)].length,
    createdIndexes.length,
    "every index created by the dedicated migration must use the exact reviewed form",
  );
  assert.deepEqual(
    createdIndexes,
    [
      "member_entitlement_events_subject_effective_idx:private.member_entitlement_events",
      "member_entitlement_expiry_due_order_idx:private.member_entitlement_expiry_due",
    ],
    "every index created by the foundation migration must be in the exact ordered inventory",
  );

  const createdPolicies = [...normalized.matchAll(
    /create\s+policy\s+((?:[a-z0-9_]+\.)?[a-z0-9_]+)\s+on\s+((?:[a-z0-9_]+\.)?[a-z0-9_]+)/giu,
  )].map((match) => `${match[1].toLowerCase()}:${match[2].toLowerCase()}`);
  assert.equal(
    [...normalized.matchAll(/create\s+policy\b/giu)].length,
    createdPolicies.length,
    "every policy created by the dedicated migration must use the exact reviewed form",
  );
  assert.deepEqual(
    createdPolicies,
    policies.map((policy, index) => `${policy}:private.${tables[index]}`),
    "every policy created by the foundation migration must be in the exact ordered inventory",
  );

  const createdTriggers = [...normalized.matchAll(
    /create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+((?:[a-z0-9_]+\.)?[a-z0-9_]+)\b/giu,
  )].map((match) => match[1].toLowerCase());
  assert.equal(
    [...normalized.matchAll(/create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\b/giu)].length,
    createdTriggers.length,
    "every row or statement trigger created by the dedicated migration must use the exact reviewed form",
  );
  assert.deepEqual(createdTriggers, triggers, "entitlement triggers must be the exact ordered inventory");
  assert.equal(
    [...normalized.matchAll(/create\s+event\s+trigger\b/giu)].length,
    0,
    "the foundation migration must create no event trigger",
  );
  assert.equal(
    [...normalized.matchAll(/create\s+(?:(?:temporary|temp|unlogged)\s+)?sequence\b/giu)].length,
    0,
    "the foundation migration must create no sequence",
  );

  const createdRoutines = [...normalized.matchAll(
    /create\s+(?:or\s+replace\s+)?(function|procedure)\s+((?:[a-z0-9_]+\.)?[a-z0-9_]+)\s*\(/giu,
  )].map((match) => `${match[1].toLowerCase()}:${match[2].toLowerCase()}`);
  assert.equal(
    [...normalized.matchAll(/create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/giu)].length,
    createdRoutines.length,
    "every routine created by the dedicated migration must use a reviewable unquoted identifier",
  );
  assert.deepEqual(
    createdRoutines,
    functions.map((name) => `function:${name}`),
    "every function or procedure created by the foundation migration must be in the exact ordered inventory",
  );

  assert.equal(
    [...normalized.matchAll(
      /create\s+(?:or\s+replace\s+)?(?:(?:temp(?:orary)?|recursive|materialized)\s+)*view\b/giu,
    )].length,
    0,
    "the foundation migration must create no ordinary, temporary, recursive, or materialized view",
  );

  for (const table of tables) {
    assert.equal(
      [...normalized.matchAll(new RegExp(`alter table private\\.${table} enable row level security`, "gu"))].length,
      1,
      `RLS must be enabled exactly once for ${table}`,
    );
    assert.equal(
      [...normalized.matchAll(new RegExp(`revoke all on table private\\.${table} from public, anon, authenticated, service_role`, "gu"))].length,
      1,
      `direct privileges must be revoked exactly once for ${table}`,
    );
  }

  assert.ok(
    !/grant\s+.+\s+on\s+schema\s+private\b/iu.test(normalized),
    "the foundation migration must not change private schema grants",
  );

  assert.equal(
    [...normalized.matchAll(
      /entitled_at_effective_time boolean generated always as \(active and discord_verified\) stored not null/gu,
    )].length,
    2,
    "both derived entitlement columns must use the exact non-null conjunction",
  );
  assert.equal(
    [...normalized.matchAll(/foreign key \(event_id, subject, revision\)/gu)].length,
    1,
    "current state must have the exact composite immutable-event foreign key",
  );
  assert.equal(
    [...normalized.matchAll(
      /subject uuid primary key references private\.member_entitlement_state\(subject\) on delete cascade/gu,
    )].length,
    1,
    "expiry work must have the exact state-owned cascading foreign key",
  );
  assert.equal(
    [...normalized.matchAll(
      /constraint member_entitlement_state_subject_lock_fkey\s+foreign key \(subject\)\s+references private\.member_entitlement_subject_locks \(subject\)\s+on delete restrict/gu,
    )].length,
    1,
    "current state must have the exact restrictive stable subject-lock foreign key",
  );

  for (const snippet of [
    "producer_enabled boolean not null default false",
    "expiry_sweeper_enabled boolean not null default false",
    "social_dispatcher_enabled boolean not null default false",
    "forums_dispatcher_enabled boolean not null default false",
    "social_login_enabled boolean not null default false",
    "forums_login_enabled boolean not null default false",
    "entitled_at_effective_time boolean generated always as (active and discord_verified) stored not null",
    "revision between 1 and 9223372036854775807",
    "unique (subject, revision)",
    "foreign key (event_id, subject, revision)",
    "references private.member_entitlement_events (event_id, subject, revision)",
    "references private.member_entitlement_subject_locks (subject)",
    "subject uuid primary key references private.member_entitlement_state(subject) on delete cascade",
    "p_expected_revision bigint",
    "Member entitlement revision conflict.",
    "for update of subject_lock skip locked",
    "where due.subject = v_subject\n      and due.due_at <= p_now\n    for update",
    "v_claims_role is distinct from 'service_role'",
    "v_legacy_role is distinct from v_claims_role",
    "set search_path = ''",
    "grant execute on function public.commit_member_entitlement_snapshot_core_v1(uuid, bigint, boolean, boolean, timestamptz, timestamptz)",
    "revoke all on function private.run_member_entitlement_expiry_sweep_v1()",
    "This migration creates no cron.job.",
  ]) {
    assert.ok(normalized.includes(snippet), `migration is missing: ${snippet}`);
  }

  for (const forbidden of [
    /alter\s+table\s+private\.member_entitlement_[a-z_]+\s+disable\s+row\s+level\s+security/iu,
    /alter\s+table\s+private\.member_entitlement_[a-z_]+\s+no\s+force\s+row\s+level\s+security/iu,
    /alter\s+table\s+private\.member_entitlement_[a-z_]+\s+add\s+(?:column\s+)?/iu,
    /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:public|private)\./iu,
    /alter\s+default\s+privileges\b/iu,
    /(?:create|alter|drop)\s+publication\b/iu,
    /grant\s+.+\s+on\s+(?:table\s+)?private\.member_entitlement_/iu,
    /grant\s+.+\s+on\s+(?:sequence|all\s+sequences)/iu,
    /grant\s+execute\s+on\s+function\s+private\.(?:process|run)_member_entitlement/iu,
    /grant\s+execute\s+on\s+function\s+public\.commit_member_entitlement_snapshot_core_v1[\s\S]{0,300}?\bto\s+(?!service_role\b)/iu,
    /alter\s+function\s+(?:public|private)\..*member_entitlement/iu,
    /update\s+private\.member_entitlement_runtime_control[\s\S]{0,300}?=\s*true/iu,
    /cron\.schedule/iu,
    /pg_net/iu,
    /net\.http/iu,
    /x-mochirii-/iu,
    /hmac/iu,
    /discourse_user_id/iu,
    /binding_revision/iu,
    /high_watermark/iu,
    /member_verifications/iu,
    /auth\.identities/iu,
    /member_auth_identities/iu,
    /provider_metadata/iu,
    /raw_payload/iu,
    /profile_url/iu,
    /\b(?:email|email_address|headers|payload|token|secret|signature)\b\s+(?:text|jsonb|bytea)/iu,
  ]) {
    assert.ok(!forbidden.test(normalized), `migration contains forbidden active or contradictory surface: ${forbidden}`);
  }
}

validateMigration(migration);

for (const hostileAppend of [
  "alter table private.member_entitlement_state disable row level security;",
  "grant select on table private.member_entitlement_events to service_role;",
  "alter table private.member_entitlement_state add column payload jsonb;",
  "update private.member_entitlement_runtime_control set producer_enabled = true;",
  "select cron.schedule('member-entitlement', '* * * * *', 'select 1');",
  "alter function public.commit_member_entitlement_snapshot_core_v1(uuid,bigint,boolean,boolean,timestamptz,timestamptz) security invoker;",
  "grant execute on function private.run_member_entitlement_expiry_sweep_v1() to service_role;",
  "create policy member_entitlement_state_public_read on private.member_entitlement_state for select using (true);",
  "create index member_entitlement_state_extra_idx on private.member_entitlement_state (updated_at);",
  "create index worker_extra on private.member_entitlement_state (updated_at);",
  "create unique nulls not distinct index worker_nulls_extra on private.member_entitlement_state (updated_at);",
  "create sequence private.worker_sequence;",
  "create unlogged sequence private.worker_unlogged_sequence;",
  "create sequence private.\"QuotedWorkerSequence\";",
  "create policy worker_allow on private.member_entitlement_state for select using (true);",
  "create trigger worker_trigger before update on private.member_entitlement_state for each row execute function private.reject_member_entitlement_event_mutation();",
  "create constraint trigger worker_constraint after update on private.member_entitlement_state deferrable initially deferred for each row execute function private.reject_member_entitlement_event_mutation();",
  "create event trigger worker_ddl on ddl_command_end execute function private.worker();",
  "create or replace function private.run_member_entitlement_expiry_sweep_v1() returns void language sql as 'select';",
  "create or replace function private.worker() returns void language sql as 'select public.commit_member_entitlement_snapshot_core_v1(null,null,null,null,null,null)'; grant execute on function private.worker() to service_role;",
  "create table PRIVATE.MEMBER_ENTITLEMENT_UPPERCASE_CANARY (subject uuid primary key);",
  "create table private.worker_state (subject uuid primary key);",
  "create temporary table private.worker_temp (subject uuid primary key);",
  "create foreign table private.worker_foreign (subject uuid) server worker_server;",
  "create or replace function private.UPPERCASE_CANARY() returns bigint language sql as 'select count(*) from PRIVATE.MEMBER_ENTITLEMENT_STATE'; grant execute on function private.UPPERCASE_CANARY() to service_role;",
  "create procedure private.UPPERCASE_WORKER() language sql as 'select count(*) from PRIVATE.MEMBER_ENTITLEMENT_STATE';",
  "create recursive view public.worker_view(subject) as select subject from private.member_entitlement_state;",
  "create view public.\"QuotedWorkerView\" as select subject from private.member_entitlement_state;",
  "alter default privileges in schema private grant select on tables to authenticated;",
  "create publication worker_publication for table private.member_entitlement_state;",
  "alter publication supabase_realtime add table private.member_entitlement_state;",
  "drop publication supabase_realtime;",
  "grant maintain on table private.member_entitlement_state to service_role;",
  "grant select (active) on table private.member_entitlement_state to service_role;",
  "grant create on schema private to anon;",
  "create view public.exposed_entitlements as select * from private.member_entitlement_state;",
  migration.replaceAll(
    "entitled_at_effective_time boolean generated always as (active and discord_verified) stored not null",
    "entitled_at_effective_time boolean generated always as (active or discord_verified) stored not null",
  ),
  migration.replaceAll(
    "entitled_at_effective_time boolean generated always as (active and discord_verified) stored not null",
    "entitled_at_effective_time boolean generated always as (active and discord_verified) stored",
  ),
  migration.replace(
    "foreign key (event_id, subject, revision)",
    "foreign key (event_id)",
  ),
  migration.replace(
    "constraint member_entitlement_state_subject_lock_fkey\n    foreign key (subject)\n    references private.member_entitlement_subject_locks (subject)\n    on delete restrict",
    "constraint member_entitlement_state_subject_lock_fkey\n    foreign key (subject)\n    references private.member_entitlement_subject_locks (subject)\n    on delete cascade",
  ),
]) {
  assert.throws(
    () => validateMigration(hostileAppend.startsWith("-- Establish")
      ? hostileAppend
      : `${migration}\n${hostileAppend}\n`),
    undefined,
    `checker must reject contradictory append: ${hostileAppend}`,
  );
}

for (const marker of [
  "Status: source candidate; hosted Preview only.",
  "every runtime capability remains disabled",
  "These rows are not delivery acknowledgements",
  "intentionally has no cascading `auth.users` foreign key",
  "There is no source caller",
  "do not drop or rewrite the ledger",
  "result_event_id` to `null`",
  "existing Supabase Git integration makes that merge the production database deployment",
  "That Preview does not constitute a production migration",
]) {
  assert.ok(
    documentationCompact.toLowerCase().includes(marker.toLowerCase()),
    `foundation documentation is missing the inert-boundary marker: ${marker}`,
  );
}

for (const forbiddenClaim of [
  /status:\s*(?:deployed|production-ready|active)/iu,
  /v5[^\n]{0,120}(?:accepted|bound|implemented)/iu,
  /(?:social|forums)[^\n]{0,120}(?:delivery|revocation)\s+(?:is|are)\s+(?:complete|implemented|active)/iu,
]) {
  assert.ok(
    !forbiddenClaim.test(documentation),
    `foundation documentation contains a forbidden runtime overclaim: ${forbiddenClaim}`,
  );
}

for (const marker of [
  "every direct table privilege is denied to client and service roles",
  "private schema owner and inherited usage ACLs remain exact with no client create capability",
  "default privileges cannot grant access to future private entitlement objects",
  "no external view or materialized view exposes an entitlement relation",
  "every entitlement relation has the exact kind, persistence, row-security mode, and owner",
  "entitlement table ACLs are exactly owner-only, non-grantable, including MAINTAIN",
  "entitlement columns have no column-level ACL entries",
  "every private entitlement column name, type, nullability, default, and generated expression is exact",
  "the exact generated-column and zero-identity inventory is frozen",
  "the complete entitlement constraint and foreign-key inventory is exact",
  "every entitlement constraint is immediate, nondeferrable, and validated",
  "the complete entitlement index inventory is exact",
  "every entitlement index has the exact uniqueness, primary, validity, readiness, live, and null-distinct modes",
  "the complete restrictive entitlement policy inventory is exact",
  "the append-only trigger is the exact sole entitlement trigger",
  "the append-only trigger is enabled with the exact event mask and helper",
  "the complete entitlement function signature, result, defaults, language, security mode, volatility, parallel mode, and search path is exact",
  "the entitlement function inventory has exact kind, arity, defaults, strictness, leakproof mode, and owner",
  "function ACLs are exactly owner-only except the non-grantable service commit capability",
  "uppercase unquoted entitlement references remain inside the exact cross-schema function inventory boundary",
  "no pg_cron job name or command references the entitlement foundation",
  "no logical-replication publication contains an entitlement relation",
  "first materialization requires expected revision zero",
  "a stale non-adjacent replay cannot overwrite newer state",
  "failed replay preserves the newer snapshot and its exact event-target state",
  "an exact replay creates no event",
  "an exact replay returns no new event identifier",
  "the exact due instant denies once",
  "every event has exactly the complete bounded consumer target set",
  "current state is byte-semantic equal to its immutable event snapshot",
  "maximum current revision cannot increment or wrap",
  "maximum due revision cannot increment or partially mutate",
  "every fixture and runtime event retains exactly the complete consumer target set",
]) {
  assert.ok(test.includes(marker), `pgTAP coverage is missing: ${marker}`);
}

for (const marker of [
  "commit-versus-expiry race did not fail closed",
  "a grant that expires while waiting for the subject lock must fail closed",
  "a refreshed future due row survives a competing expiry statement",
  "second expiry worker failed instead of skipping locked work",
]) {
  assert.ok(
    readFileSync(path.join(root, "scripts", "test-supabase-member-entitlement-concurrency.mjs"), "utf8").includes(marker),
    `concurrency coverage is missing: ${marker}`,
  );
}

const normalizePath = (relative) => relative.replaceAll("\\", "/");

const permittedCallerFiles = new Set([
  normalizePath(path.relative(root, migrationPath)),
  normalizePath(path.relative(root, testPath)),
  "scripts/check-member-entitlement-state.mjs",
  "scripts/test-supabase-member-entitlement-concurrency.mjs",
  "docs/integrations/member-entitlement-state-foundation.v1.md",
]);
const permittedLiteralOccurrences = new Map([
  [
    "scripts/check-repository-boundaries.mjs",
    ["supabase/tests/member_entitlement_state_foundation_test.sql"],
  ],
]);
const scanned = execFileSync("git", [
  "ls-files", "--cached", "--modified", "--others", "--exclude-standard", "--deleted", "-z",
], {
  cwd: root,
  encoding: "utf8",
}).split("\0").filter(Boolean);

function assertNoRuntimeCaller(relative, body) {
  if (body.toString("utf8").toLowerCase().includes("member_entitlement_")) {
    throw new Error(`runtime or alternate database exposure is forbidden before activation: ${relative}`);
  }
}

for (const relative of new Set(scanned)) {
  const normalizedRelative = normalizePath(relative);
  if (permittedCallerFiles.has(normalizedRelative)) continue;
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) continue;
  let body = readFileSync(absolute);
  for (const literal of permittedLiteralOccurrences.get(normalizedRelative) ?? []) {
    const source = body.toString("utf8");
    assert.equal(
      source.split(literal).length - 1,
      1,
      `the exact non-runtime entitlement evidence literal must occur once: ${normalizedRelative}`,
    );
    body = Buffer.from(source.replace(literal, ""));
  }
  assertNoRuntimeCaller(normalizedRelative, body);
}

for (const [name, hostileAlias] of [
  ["package-commit.json", '{"scripts":{"run":"commit_member_entitlement_snapshot_core_v1"}}'],
  ["package-expiry.json", '{"scripts":{"run":"process_member_entitlement_expiries_core_v1"}}'],
  ["package-sweep.json", '{"scripts":{"run":"run_member_entitlement_expiry_sweep_v1"}}'],
  ["runtime.php", '<?php $rpc = "commit_member_entitlement_snapshot_core_v1";'],
  ["runtime-uppercase.php", '<?php $rpc = "COMMIT_MEMBER_ENTITLEMENT_SNAPSHOT_CORE_V1";'],
  ["Dockerfile", 'RUN echo run_member_entitlement_expiry_sweep_v1'],
  ["Dockerfile-uppercase", 'RUN echo RUN_MEMBER_ENTITLEMENT_EXPIRY_SWEEP_V1'],
  ["later-migration.sql", 'create view public.exposed_entitlements as select * from private.member_entitlement_state;'],
  ["later-migration-uppercase.sql", 'UPDATE private.MEMBER_ENTITLEMENT_RUNTIME_CONTROL SET producer_enabled = true;'],
]) {
  assert.throws(
    () => assertNoRuntimeCaller(name, Buffer.from(hostileAlias)),
    /runtime or alternate database exposure is forbidden before activation/u,
    `root manifest alias must not conceal an entitlement primitive: ${name}`,
  );
}

console.log("Member entitlement state foundation contract OK (inert; 6 private tables; hostile canaries pass)." );
