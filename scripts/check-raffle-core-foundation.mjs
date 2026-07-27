import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const failures = [];

const migrationPath =
  "supabase/migrations/20260727050100_add_disabled_monthly_raffle_foundation.sql";
const testPath = "supabase/tests/raffle_backend_test.sql";
const configPath = "supabase/config.toml";
const flagsPath = "supabase/functions/_shared/raffle-flags.ts";
const publicEdgePath = "supabase/functions/_shared/raffle-edge.ts";
const publicFunctionPath = "supabase/functions/get-current-raffle/index.ts";
const providerEventWorkerPath =
  "supabase/functions/_shared/raffle-provider-event-worker.ts";
const envExamplePath = "supabase/functions/.env.example";
const verifiedAuthPath = "supabase/functions/_shared/verified-auth.ts";
const rewardEdgePath = "supabase/functions/_shared/reward-edge.ts";
const rewardCryptoPath = "supabase/functions/_shared/reward-crypto.ts";
const rewardRelayClientPath =
  "supabase/functions/_shared/reward-relay-client.ts";
const rewardRelayContractPath =
  "supabase/functions/_shared/reward-relay-contract.ts";
const raffleClaimPath = "supabase/functions/_shared/raffle-claim.ts";
const claimFunctionPath = "supabase/functions/manage-raffle-claim/index.ts";

const migration = read(migrationPath);
const databaseTests = read(testPath);
const config = read(configPath);
const flags = read(flagsPath);
const publicEdge = read(publicEdgePath);
const publicFunction = read(publicFunctionPath);
const providerEventWorker = read(providerEventWorkerPath);
const envExample = read(envExamplePath);
const verifiedAuth = read(verifiedAuthPath);
const rewardEdge = read(rewardEdgePath);
const rewardCrypto = read(rewardCryptoPath);
const rewardRelayClient = read(rewardRelayClientPath);
const rewardRelayContract = read(rewardRelayContractPath);
const raffleClaim = read(raffleClaimPath);
const claimFunction = read(claimFunctionPath);
const rootLock = read("deno.lock");
const packageSource = read("package.json");
const checkAllSource = read("scripts/check-all.mjs");
let canonicalRaffleLock = "";
const launchGateContract = migration.slice(
  migration.indexOf("constraint raffle_cycles_launch_gate_check"),
  migration.indexOf("constraint raffle_cycles_counts_check"),
);

const tables = [
  "raffle_cycles",
  "raffle_entries",
  "raffle_bonus_awards",
  "raffle_draws",
  "raffle_draw_results",
  "raffle_audit_events",
  "raffle_provider_configs",
  "raffle_fulfillment_jobs",
  "raffle_provider_events",
];

const functionJwt = new Map([
  ["get-current-raffle", false],
  ["manage-raffle-entry", true],
  ["moderate-raffle", true],
  ["run-raffle-schedule", false],
  ["manage-raffle-claim", true],
  ["run-raffle-fulfillment", false],
  ["reward-provider-webhook", false],
]);

const serviceRoutines = [
  "open_raffle_cycle",
  "review_raffle_entry_eligibility",
  "manage_raffle_bonus_award",
  "submit_raffle_bonus_alternative",
  "manage_raffle_member_entry",
  "freeze_raffle_ledger",
  "record_raffle_ledger_hash",
  "complete_raffle_draw",
  "record_raffle_private_notice",
  "claim_raffle_draw_result",
  "review_raffle_claim_tax",
  "review_raffle_claim_clearance",
  "release_raffle_digital_fulfillment",
  "complete_raffle_manual_in_game",
  "claim_raffle_fulfillment_jobs",
  "decline_raffle_draw_result",
  "complete_raffle_fulfillment_job",
  "unlock_raffle_reward_link",
  "reserve_raffle_reward_link",
  "claim_raffle_provider_events",
  "complete_raffle_provider_event",
  "apply_raffle_provider_reward_state",
];

for (const table of tables) {
  includes("migration", migration, `create table public.${table} (`);
  includes(
    "migration",
    migration,
    `alter table public.${table} enable row level security;`,
  );
  includes(
    "migration",
    migration,
    `revoke all on table public.${table} from public, anon, authenticated;`,
  );
  includes(
    "migration",
    migration,
    `grant all on table public.${table} to service_role;`,
  );
  includes(
    "migration",
    migration,
    `create policy service_only_default_deny on public.${table}`,
  );
}

exactCount(
  "raffle table inventory",
  migration,
  /create table public\.raffle_[a-z_]+\s*\(/giu,
  9,
);
exactCount(
  "raffle RLS inventory",
  migration,
  /alter table public\.raffle_[a-z_]+ enable row level security;/giu,
  9,
);
exactCount(
  "restrictive deny policy inventory",
  migration,
  /as restrictive for all to anon, authenticated using \(false\) with check \(false\);/giu,
  9,
);

for (
  const forbidden of [
    "Mochirii LLC",
    "llc_verified",
    "legal_approved",
    "provider_approved",
    "launch_approved",
  ]
) {
  excludes("migration", migration, forbidden);
}
includes("sponsor contract", migration, "sponsor_display_name text,");
excludes(
  "sponsor contract",
  migration,
  "sponsor_display_name text not null default",
);

for (
  const gate of [
    "sponsor_approved",
    "rules_approved",
    "country_matrix_approved",
    "reward_approved",
    "privacy_approved",
    "tax_approved",
    "operations_approved",
  ]
) {
  includes("launch gates", migration, `${gate} boolean not null default false`);
  includes("ready-state constraint", launchGateContract, gate);
}

for (
  const required of [
    "base_entries smallint not null default 5",
    "max_bonus_entries smallint not null default 5",
    "max_entries smallint not null default 10",
    "base_entries = 5 and max_bonus_entries = 5 and max_entries = 10",
    "claim_window_days smallint not null default 7",
    "award_window_days smallint not null default 30",
    "minimum_eligible_entrants smallint not null default 3",
    "expires_at = draw_at + make_interval(days => award_window_days)",
    "entrant_count >= 3",
    "raffle_minimum_eligible_entrants_not_met",
    "completion_method in ('primary', 'alternative')",
    "claim_window_days between 1 and 30",
    "award_window_days between 7 and 90",
  ]
) {
  includes("raffle limits", migration, required);
}

for (
  const bonusKey of [
    "scheduled_activity",
    "monthly_gathering",
    "party_help",
    "tip_resource",
    "member_kudos",
  ]
) {
  includes("free-alternative keys", migration, `'${bonusKey}'`);
}

for (
  const required of [
    "create or replace function private.assert_raffle_service_caller()",
    "security definer",
    "set search_path = ''",
    "as $$",
    "request.jwt.claim.role",
    "request_role = 'service_role'",
    "session_user in ('postgres', 'supabase_admin')",
    "revoke all on schema private from public, anon;",
    "revoke all on function private.assert_raffle_service_caller()",
    "grant execute on function private.assert_raffle_service_caller() to service_role;",
  ]
) {
  includes("service caller boundary", migration, required);
}
excludes(
  "shared private-schema boundary",
  migration,
  "revoke all on schema private from public, anon, authenticated;",
);

for (const routine of serviceRoutines) {
  const block = functionBlock(migration, "public", routine);
  if (!block) {
    failures.push(`service routine: missing public.${routine}.`);
    continue;
  }
  includes(`public.${routine}`, block, "security definer");
  includes(`public.${routine}`, block, "set search_path = ''");
  includes(
    `public.${routine}`,
    block,
    "perform private.assert_raffle_service_caller();",
  );
  includes(
    `public.${routine} privileges`,
    migration,
    `revoke all on function public.${routine}(`,
  );
  includes(
    `public.${routine} privileges`,
    migration,
    `grant execute on function public.${routine}(`,
  );
}

for (const required of [
  '"apply_raffle_provider_reward_state"',
  "p_worker_id: input.workerId",
]) {
  includes("provider event lease propagation", providerEventWorker, required);
}
for (const required of [
  "event_row.locked_by is distinct from trim(p_worker_id)",
  "or event_row.lock_expires_at <= now()",
  "raise exception 'event_lock_not_owned'",
]) {
  includes("provider event lease boundary", migration, required);
}

const configuredFunctions = parseFunctionConfig(config);
for (const configured of configuredFunctions) {
  if (configured.verifyJwtCount !== 1) {
    failures.push(
      `Supabase config: ${configured.name} must declare verify_jwt exactly once.`,
    );
  }
}
const duplicateFunctionNames = configuredFunctions
  .map((item) => item.name)
  .filter((name, index, names) => names.indexOf(name) !== index);
if (duplicateFunctionNames.length) {
  failures.push(
    `Supabase config: duplicate function sections: ${
      [...new Set(duplicateFunctionNames)].join(", ")
    }.`,
  );
}
if (configuredFunctions.length !== 40) {
  failures.push(
    `Supabase inventory: expected 40 functions, found ${configuredFunctions.length}.`,
  );
}
const jwtTrue = configuredFunctions.filter((item) => item.verifyJwt).length;
const jwtFalse =
  configuredFunctions.filter((item) => item.verifyJwt === false).length;
if (jwtTrue !== 23 || jwtFalse !== 17) {
  failures.push(
    `Supabase JWT parity: expected 23 true / 17 false, found ${jwtTrue} true / ${jwtFalse} false.`,
  );
}

for (const [name, expectedJwt] of functionJwt) {
  const configured = configuredFunctions.find((item) => item.name === name);
  if (!configured) {
    failures.push(`Supabase config: missing ${name}.`);
    continue;
  }
  if (configured.verifyJwt !== expectedJwt) {
    failures.push(
      `Supabase config: ${name} verify_jwt must be ${expectedJwt}.`,
    );
  }
  includes(
    `${name} config`,
    configured.body,
    `enabled = true`,
  );
  includes(
    `${name} config`,
    configured.body,
    `import_map = "./functions/${name}/deno.json"`,
  );
  includes(
    `${name} config`,
    configured.body,
    `entrypoint = "./functions/${name}/index.ts"`,
  );

  const manifestPath = `supabase/functions/${name}/deno.json`;
  const entrypointPath = `supabase/functions/${name}/index.ts`;
  const lockPath = `supabase/functions/${name}/deno.lock`;
  const manifestSource = read(manifestPath);
  const lockSource = read(lockPath);
  read(entrypointPath);
  let manifest;
  let lock;
  try {
    manifest = JSON.parse(manifestSource);
  } catch {
    failures.push(`${manifestPath}: invalid JSON.`);
    continue;
  }
  try {
    lock = JSON.parse(lockSource);
  } catch {
    failures.push(`${lockPath}: invalid JSON.`);
    continue;
  }
  const imports = manifest?.imports || {};
  const expectedImports = {
    "@supabase/functions-js/edge-runtime.d.ts":
      "jsr:@supabase/functions-js@2.110.8/edge-runtime.d.ts",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.110.8",
  };
  if (JSON.stringify(imports) !== JSON.stringify(expectedImports)) {
    failures.push(
      `${manifestPath}: imports must contain only the exact approved 2.110.8 pins.`,
    );
  }

  if (lock.version !== "5") {
    failures.push(`${lockPath}: expected Deno lock format version 5.`);
  }
  const actualSupabaseSpecifiers = Object.entries(lock.specifiers || {})
    .filter(([specifier]) => specifier.includes("supabase"))
    .sort(([left], [right]) => left.localeCompare(right));
  const expectedSupabaseSpecifiers = [
    ["jsr:@supabase/functions-js@2.110.8", "2.110.8"],
    ["npm:@supabase/supabase-js@2.110.8", "2.110.8"],
  ];
  if (
    JSON.stringify(actualSupabaseSpecifiers) !==
      JSON.stringify(expectedSupabaseSpecifiers)
  ) {
    failures.push(
      `${lockPath}: Supabase dependency resolution must contain only the exact approved 2.110.8 specifiers.`,
    );
  }
  if (
    !/^[0-9a-f]{64}$/iu.test(
      lock.jsr?.["@supabase/functions-js@2.110.8"]?.integrity || "",
    )
  ) {
    failures.push(`${lockPath}: missing immutable functions-js integrity.`);
  }
  if (
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(
      lock.npm?.["@supabase/supabase-js@2.110.8"]?.integrity || "",
    )
  ) {
    failures.push(`${lockPath}: missing immutable supabase-js integrity.`);
  }
  if (!canonicalRaffleLock) canonicalRaffleLock = lockSource;
  else if (lockSource !== canonicalRaffleLock) {
    failures.push(
      `${lockPath}: all seven function-local locks must share the same reviewed resolution graph.`,
    );
  }
}

for (
  const pin of [
    '"jsr:@supabase/functions-js@2.110.8": "2.110.8"',
    '"npm:@supabase/supabase-js@2.110.8": "2.110.8"',
  ]
) {
  includes("root Deno lock", rootLock, pin);
}

for (const commandSource of [packageSource, checkAllSource]) {
  includes(
    "raffle frozen test command",
    commandSource,
    "--lock=supabase/functions/get-current-raffle/deno.lock",
  );
  for (
    const testFile of [
      "raffle-claim_test.ts",
      "raffle-core_test.ts",
      "raffle-current_test.ts",
      "raffle-edge_test.ts",
      "raffle-flags_test.ts",
      "raffle-fulfillment_test.ts",
      "reward-provider-webhook_test.ts",
      "reward-relay_test.ts",
    ]
  ) {
    includes("raffle frozen test command", commandSource, testFile);
  }
}

const operationalFlags = [
  "RAFFLE_SUBMISSIONS_ENABLED",
  "RAFFLE_BONUS_SUBMISSIONS_ENABLED",
  "RAFFLE_CLAIMS_ENABLED",
  "RAFFLE_SCHEDULING_ENABLED",
  "RAFFLE_REWARD_ORDERS_ENABLED",
  "RAFFLE_RELAY_ENABLED",
];
for (const flag of operationalFlags) {
  includes("fail-closed flag reader", flags, `readEnvironment("${flag}")`);
  includes("environment template", envExample, `${flag}=false`);
}
includes(
  "fail-closed flag parser",
  flags,
  'value?.trim().toLowerCase() === "true"',
);

const gateWiring = new Map([
  ["supabase/functions/manage-raffle-entry/index.ts", [
    "gates.submissions",
    "gates.bonusSubmissions",
  ]],
  ["supabase/functions/moderate-raffle/index.ts", [
    "raffleOperationalGates().submissions",
    "gates.rewardOrders",
    "gates.relay",
  ]],
  ["supabase/functions/run-raffle-schedule/index.ts", [
    "raffleOperationalGates().scheduling",
  ]],
  ["supabase/functions/manage-raffle-claim/index.ts", ["gates.claims"]],
  ["supabase/functions/run-raffle-fulfillment/index.ts", [
    "gates.rewardOrders",
    "gates.relay",
  ]],
  ["supabase/functions/reward-provider-webhook/index.ts", [
    "gates.rewardOrders",
    "gates.relay",
  ]],
]);
for (const [path, snippets] of gateWiring) {
  const source = read(path);
  for (const snippet of snippets) includes(`${path} gates`, source, snippet);
}

for (const source of [publicEdge, rewardEdge]) {
  includes(
    "verified member authentication",
    source,
    "verifyAuthenticatedUser(",
  );
}
includes("verified member authentication", verifiedAuth, "auth.getClaims(");
includes("verified member authentication", verifiedAuth, "auth.getUser(");
if (
  verifiedAuth.indexOf("auth.getClaims(") >
    verifiedAuth.indexOf("auth.getUser(")
) {
  failures.push(
    "verified member authentication: getClaims must run before getUser.",
  );
}
excludes("verified member authentication", verifiedAuth, "user_metadata");

const moderatorBoundary = sliceFunction(publicEdge, "requireRaffleModerator");
for (
  const required of [
    "raffleMemberProfileIsVerified(",
    "dependencies.fetcher || fetch",
  ]
) {
  includes("moderator authorization", moderatorBoundary, required);
}
if (
  moderatorBoundary.indexOf("raffleMemberProfileIsVerified(") >
    moderatorBoundary.indexOf("dependencies.fetcher || fetch")
) {
  failures.push(
    "moderator authorization: local standing must precede Discord lookup.",
  );
}

const claimEdgeBoundary = sliceFunction(
  claimFunction,
  "handleRaffleClaimRequest",
);
for (const required of [
  "dependencies.requireMember || requireRaffleMember",
  "raffleMemberProfileIsVerified(",
  "(dependencies.now || Date.now)()",
  'error: "member_access_required"',
]) {
  includes("claim current-member authorization", claimEdgeBoundary, required);
}
if (
  claimEdgeBoundary.indexOf("raffleMemberProfileIsVerified(") >
    claimEdgeBoundary.indexOf("readBoundedJson(req)")
) {
  failures.push(
    "claim current-member authorization: standing must be checked before request parsing or claim access.",
  );
}

const memberPost = sliceFunction(publicFunction, "handleMemberPost");
excludes("private result CORS", memberPost, ",\n      true,\n    );");
includes("private result CORS", publicFunction, "withProtectedCors(");
includes("private result CORS", publicFunction, "protectedOptionsResponse(");

const publicCycleContract = sliceFunction(publicEdge, "publicCycleDto");
for (
  const required of [
    "cycleStatus",
    "standardEntryStatus",
    "bonusEntryStatus",
    "maximumBonusEntries",
    "maximumEntries",
    "publicResult",
  ]
) {
  includes("provider-neutral public cycle", publicCycleContract, required);
}
for (
  const forbidden of [
    "sponsorDisplayName",
    "grossPrizeCents",
    "allInCostCapCents",
    "publicRewardLabel",
    "rulesVersionUrl",
  ]
) {
  excludes("provider-neutral public cycle", publicCycleContract, forbidden);
}

const publicEvidenceLoader = sliceFunction(publicEdge, "publicDrawEvidence");
const publicEvidenceContract = sliceFunction(
  publicEdge,
  "privacySafePublicDrawEvidence",
);
for (const required of [
  '"id,status,ledger_hash,algorithm_version,drawn_at"',
  "privacySafePublicDrawEvidence(draw, resultData || [])",
]) {
  includes("privacy-safe public draw evidence loader", publicEvidenceLoader, required);
}
for (const forbidden of ["ledger_salt", "seed_hex", "frozen_entry_count"]) {
  excludes("privacy-safe public draw evidence loader", publicEvidenceLoader, forbidden);
}
for (const required of [
  "drawingAt",
  "methodVersion",
  "ledgerCommitment",
  "resultCommitment: await sha256Hex(JSON.stringify(canonicalResults))",
]) {
  includes("commitment-only public draw evidence", publicEvidenceContract, required);
}
includes(
  "commitment-only public draw evidence",
  publicEvidenceContract,
  "return {\n    drawingAt,\n    methodVersion,\n    ledgerCommitment,\n    resultCommitment:",
);

includes(
  "relay origin boundary",
  rewardRelayClient,
  'REWARD_RELAY_ORIGIN = "https://reward-gateway.mochirii.com"',
);
includes(
  "relay response authentication",
  rewardRelayClient,
  "verifyRelayResponse(",
);
for (
  const required of [
    "x-mochirii-response-body-sha256",
    "x-mochirii-response-signature",
    "canonicalRelayResponseMessage",
    "constantTimeHexEquals",
  ]
) {
  includes("relay response authentication", rewardCrypto, required);
}

for (const source of [raffleClaim, claimFunction]) {
  excludes("core reward-link boundary", source, "open_reward");
  excludes("core reward-link boundary", source, "Location");
  excludes("core reward-link boundary", source, "createPrivateRewardRedirect");
}
for (const forbidden of ["/v1/rewards/link", "generate_link", "Location"]) {
  excludes("core reward-link relay contract", rewardRelayContract, forbidden);
}

for (
  const required of [
    "export function raffleMemberProfileIsVerified",
    'profile.member_status === "active"',
    "profile.has_required_discord_roles === true",
    "verifiedAt >= now - 7 * 24 * 60 * 60 * 1000",
    "export async function memberResultNames",
    '.select("id,display_name")',
  ]
) {
  includes("privacy-safe result contract", publicEdge, required);
}
excludes(
  "public draw evidence query",
  sliceFunction(publicEdge, "publicDrawEvidence"),
  "public_handle",
);
for (
  const required of [
    'asRecord(body).action !== "member_results"',
    "dependencies.requireMember || requireRaffleMember",
    "raffleMemberProfileIsVerified(",
    "dependencies.loadMemberNames || memberResultNames",
  ]
) {
  includes("member result action", publicFunction, required);
}

includes("pgTAP plan", databaseTests, "select plan(56);");
const pgTapAssertions = countMatches(
  databaseTests,
  /select\s+(?:is|lives_ok|ok|throws_like)\s*\(/giu,
);
if (pgTapAssertions !== 56) {
  failures.push(
    `pgTAP contract: expected 56 assertions, found ${pgTapAssertions}.`,
  );
}
for (
  const required of [
    "all raffle tables exist with RLS enabled",
    "anon and authenticated have no raffle table privileges",
    "service_role can execute all 22 raffle service RPCs",
    "minimum_eligible_entrants = 3",
    "every activation gate closed",
    "raffle_cycle_contract_is_immutable",
    "raffle_fulfillment_snapshot_is_immutable",
    "raffle_manual_fulfillment_is_immutable",
  ]
) {
  includes("pgTAP coverage", databaseTests, required);
}

if (failures.length) {
  console.error(
    `Raffle core foundation validation failed (${failures.length} issue${
      failures.length === 1 ? "" : "s"
    }).`,
  );
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Raffle core foundation validation OK.");
console.log(
  "- 9 service-only RLS tables and 22 caller-checked service routines",
);
console.log(
  "- 7 disabled-by-default Edge workflows; source inventory 40 / 23 / 17",
);
console.log(
  "- 56 pgTAP assertions and privacy-safe public/member result split",
);

function read(file) {
  const full = resolve(root, file);
  if (!existsSync(full)) {
    failures.push(`${file}: missing required file.`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function includes(label, source, snippet) {
  if (!source.includes(snippet)) failures.push(`${label}: missing ${snippet}.`);
}

function excludes(label, source, snippet) {
  if (source.includes(snippet)) {
    failures.push(`${label}: must not include ${snippet}.`);
  }
}

function countMatches(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

function exactCount(label, source, pattern, expected) {
  const actual = countMatches(source, pattern);
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, found ${actual}.`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function functionBlock(source, schema, name) {
  const start = new RegExp(
    `create or replace function ${escapeRegExp(schema)}\\.${
      escapeRegExp(name)
    }\\s*\\(`,
    "iu",
  ).exec(source)?.index;
  if (start === undefined) return "";
  const end = source.indexOf("$$;", start);
  return end < 0 ? "" : source.slice(start, end + 3);
}

function sliceFunction(source, name) {
  const signatures = [
    `export async function ${name}`,
    `export function ${name}`,
    `async function ${name}`,
    `function ${name}`,
  ];
  const start = signatures.map((signature) => source.indexOf(signature))
    .filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? -1;
  if (start < 0) return "";
  const remainder = source.slice(start + 1);
  const nextMatch = /\n(?:export\s+)?(?:async\s+)?function\s+/u.exec(remainder);
  const next = nextMatch?.index === undefined
    ? -1
    : start + 1 + nextMatch.index;
  return source.slice(start, next < 0 ? source.length : next);
}

function parseFunctionConfig(source) {
  const sections = Array.from(source.matchAll(/^\[([^\]]+)\]\s*$/gmu));
  return sections.flatMap((section, index) => {
    if (!section[1].startsWith("functions.")) return [];
    const bodyStart = Number(section.index) + section[0].length;
    const bodyEnd = index + 1 < sections.length
      ? Number(sections[index + 1].index)
      : source.length;
    const body = source.slice(bodyStart, bodyEnd);
    const verifyMatches = Array.from(
      body.matchAll(/^verify_jwt\s*=\s*(true|false)$/gmu),
    );
    return [{
      name: section[1].slice("functions.".length),
      body,
      verifyJwt: verifyMatches.length === 1
        ? verifyMatches[0][1] === "true"
        : undefined,
      verifyJwtCount: verifyMatches.length,
    }];
  });
}
