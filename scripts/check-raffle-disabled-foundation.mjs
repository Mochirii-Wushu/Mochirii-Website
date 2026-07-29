import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const failures = [];

const reviewedFunctions = [
  ["verify-discord-member", true],
  ["verify-member-access", true],
  ["review-member-verification", true],
  ["list-gallery-review-queue", true],
  ["spinner-live-session", true],
  ["moderate-gallery-submission", true],
  ["delete-rejected-gallery-submission", true],
  ["list-approved-gallery-submissions", false],
  ["submit-discord-gallery-image", false],
  ["reaper-discord-interactions", false],
  ["reaper-spinner-dispatch", false],
  ["reaper-discord-member-sync", false],
  ["send-vote-reminder", false],
  ["send-member-spotlight-poll", false],
  ["publish-member-spotlight-winner", false],
  ["get-current-spotlight-winner", false],
  ["get-current-raffle", false],
  ["manage-raffle-entry", true],
  ["moderate-raffle", true],
  ["run-raffle-schedule", false],
  ["manage-raffle-claim", true],
  ["run-raffle-fulfillment", false],
  ["reward-provider-webhook", false],
  ["list-instagram-publish-queue", true],
  ["publish-instagram-gallery-submission", true],
  ["mark-instagram-gallery-submission-shared", true],
  ["check-instagram-api-status", true],
  ["list-member-profiles", true],
  ["list-visible-profile-cards", false],
  ["get-member-profile", true],
  ["submit-member-profile-media", true],
  ["list-member-profile-media-queue", true],
  ["moderate-member-profile-media", true],
  ["mochi-pets-alpha-session", true],
  ["mochi-pets-unity-auth", true],
  ["mochi-pets-alpha-action", false],
  ["mochi-pets-alpha-progress", false],
  ["mochi-pets-alpha-admin", true],
  ["submit-mochi-pets-feedback", true],
  ["sync-pixelfed-social-account", false],
];

const reviewedRaffleFunctions = [
  "manage-raffle-entry",
  "moderate-raffle",
  "run-raffle-schedule",
  "manage-raffle-claim",
  "run-raffle-fulfillment",
  "reward-provider-webhook",
];

checkFunctionInventory();
checkFunctionSourcesAndLocks();
checkBoundedRequestBodies();
checkClosedOperationalGates();
checkDisabledRelay();
checkOptionalPrivateSsrBoundary();
checkCommandWiring();

if (failures.length) {
  console.error(`Disabled raffle foundation contract failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

function checkBoundedRequestBodies() {
  const source = readRequired("supabase/functions/_shared/raffle-edge.ts");
  assertIncludes("raffle bounded JSON reader", source, "req.body.getReader()");
  assertIncludes("raffle bounded JSON reader", source, 'reader.cancel("request_too_large")');
  assertIncludes("raffle bounded JSON reader", source, "bytes = new Uint8Array(maxBytes)");
  assertIncludes("raffle bounded JSON reader", source, "readOperations >= maxReadOperations");
  assertIncludes("raffle bounded JSON reader", source, 'new TextDecoder("utf-8", { fatal: true })');
  assert(
    source.indexOf('const declaredLength = req.headers.get("content-length")') <
      source.indexOf("req.body.getReader()"),
    "raffle JSON reader must reject invalid declared lengths before opening the body stream",
  );
  assert(!source.includes("const chunks: Uint8Array[]"), "raffle JSON reader must not retain a chunk array");
  assert(!source.includes("await req.text()"), "raffle JSON reader must not buffer an unbounded request with req.text()");
}

console.log("Disabled raffle foundation contract OK.");
console.log("- The reviewed Supabase inventory is exactly 40 functions with 23 verify_jwt=true and 17 false.");
console.log("- Six raffle Edge Functions are pinned to Supabase 2.110.8 and every operational switch defaults closed.");
console.log("- Reward-relay source is private, dependency-free, loopback-bound, and disabled by default.");
if (!privateSsrBoundaryPresent()) {
  console.log("- Private raffle SSR routes are not present yet; their conditional contract will activate when the reviewed route set is added.");
}

function checkFunctionInventory() {
  const source = readRequired("supabase/config.toml");
  const sections = parseFunctionSections(source);
  const actual = sections.map(({ name, body }) => [name, value(body, "verify_jwt")]);
  const expected = reviewedFunctions.map(([name, jwt]) => [name, String(jwt)]);
  assertDeepEqual(actual, expected, "Supabase function names, order, and raw JWT literals must match the reviewed 40-function inventory");
  assert(sections.length === 40, `Supabase function inventory must contain 40 functions; found ${sections.length}`);
  assert(actual.filter(([, jwt]) => jwt === "true").length === 23, "Supabase function inventory must contain 23 verify_jwt=true functions");
  assert(actual.filter(([, jwt]) => jwt === "false").length === 17, "Supabase function inventory must contain 17 verify_jwt=false functions");

  for (const { name, body } of sections) {
    assert(value(body, "enabled") === "true", `${name}: enabled must remain true`);
    assert(value(body, "import_map") === `"./functions/${name}/deno.json"`, `${name}: import_map must match its function-local manifest`);
    assert(value(body, "entrypoint") === `"./functions/${name}/index.ts"`, `${name}: entrypoint must match its function-local source`);
  }
}

function checkFunctionSourcesAndLocks() {
  const exactDirectoryFiles = ["deno.json", "deno.lock", "index.ts"];
  for (const name of reviewedRaffleFunctions) {
    const directory = resolve(root, "supabase", "functions", name);
    if (!existsSync(directory)) {
      failures.push(`${name}: reviewed Edge Function directory is missing`);
      continue;
    }
    assertDeepEqual(
      listFiles(directory),
      [...exactDirectoryFiles].sort(),
      `${name}: source directory must recursively contain exactly index.ts, deno.json, and deno.lock`,
    );

    const manifest = parseJson(`supabase/functions/${name}/deno.json`);
    assertDeepEqual(Object.keys(manifest).sort(), ["imports"], `${name}: manifest fields must be exact`);
    assertDeepEqual(manifest.imports, {
      "@supabase/functions-js/edge-runtime.d.ts": "jsr:@supabase/functions-js@2.110.8/edge-runtime.d.ts",
      "@supabase/supabase-js": "npm:@supabase/supabase-js@2.110.8",
    }, `${name}: Supabase imports must remain pinned exactly to 2.110.8`);

    const lock = parseJson(`supabase/functions/${name}/deno.lock`);
    assert(lock.version === "5", `${name}: lockfile format must remain version 5`);
    const supabaseSpecifiers = Object.fromEntries(
      Object.entries(lock.specifiers || {}).filter(([specifier]) => specifier.includes("@supabase/")),
    );
    assertDeepEqual(supabaseSpecifiers, {
      "jsr:@supabase/functions-js@2.110.8": "2.110.8",
      "npm:@supabase/supabase-js@2.110.8": "2.110.8",
    }, `${name}: lockfile Supabase specifiers must contain only the reviewed 2.110.8 dependencies`);
  }
}

function checkClosedOperationalGates() {
  const flags = readRequired("supabase/functions/_shared/raffle-flags.ts");
  for (const [field, environmentName] of [
    ["submissions", "RAFFLE_SUBMISSIONS_ENABLED"],
    ["bonusSubmissions", "RAFFLE_BONUS_SUBMISSIONS_ENABLED"],
    ["claims", "RAFFLE_CLAIMS_ENABLED"],
    ["scheduling", "RAFFLE_SCHEDULING_ENABLED"],
    ["rewardOrders", "RAFFLE_REWARD_ORDERS_ENABLED"],
    ["relay", "RAFFLE_RELAY_ENABLED"],
  ]) {
    assertIncludes("operational gate contract", flags, `${field}: enabled(`);
    assertIncludes("operational gate contract", flags, `readEnvironment("${environmentName}")`);
  }
  assertIncludes("operational gate contract", flags, 'value?.trim().toLowerCase() === "true"');
  assertIncludes("moderator gate contract", flags, "if (!Object.hasOwn(RAFFLE_MODERATOR_ACTION_REQUIREMENTS, action))");
  assertIncludes("moderator gate contract", flags, "allowed: false");
  for (const action of ["open_cycle", "freeze_cycle", "draw_cycle", "review_eligibility", "award_bonus", "review_claim_tax", "release_digital_fulfillment", "unlock_reward_link"]) {
    assert(new RegExp(`${action}: \\[`).test(flags), `moderator gate contract: ${action} must have an explicit gate requirement`);
  }

  const gateRequirements = {
    "manage-raffle-entry": ["raffleOperationalGates()", "!gates.submissions", "!gates.bonusSubmissions"],
    "moderate-raffle": ["raffleModeratorActionDecision", "!gateDecision.known", "!gateDecision.allowed"],
    "run-raffle-schedule": ["raffleOperationalGates().scheduling"],
    "manage-raffle-claim": ["!gates.claims"],
    "run-raffle-fulfillment": ["!gates.rewardOrders || !gates.relay"],
    "reward-provider-webhook": ["!gates.rewardOrders || !gates.relay"],
  };
  for (const [name, snippets] of Object.entries(gateRequirements)) {
    const source = readRequired(`supabase/functions/${name}/index.ts`);
    snippets.forEach((snippet) => assertIncludes(`${name} fail-closed gate`, source, snippet));
  }

  const migration = readRequired("supabase/migrations/20260728140000_add_disabled_monthly_raffle_foundation.sql");
  assertIncludes("provider configuration default", migration, "status text not null default 'disabled'");
  assertIncludes("provider configuration default", migration, "orders_enabled boolean not null default false");
  assertIncludes("provider configuration seed", migration, "('sandbox', 'disabled', false)");
  assertIncludes("provider configuration seed", migration, "('production', 'disabled', false)");
}

function checkDisabledRelay() {
  const relayRoot = "services/reward-relay";
  const exactFiles = [
    ".env.example",
    ".gitignore",
    "README.md",
    "contracts/reward-claim-boundary.mjs",
    "contracts/reward-handoff.mjs",
    "contracts/reward-webhook.mjs",
    "package-lock.json",
    "package.json",
    "src/config-hash.mjs",
    "src/config.mjs",
    "src/control.mjs",
    "src/protocol.mjs",
    "src/reconcile.mjs",
    "src/server.mjs",
    "src/service.mjs",
    "src/state.mjs",
    "src/tremendous.mjs",
    "test/protocol-vector.test.mjs",
    "test/relay.test.mjs",
    "test/reward-chain.test.mjs",
  ];
  const actualFiles = listFiles(resolve(root, relayRoot));
  assertDeepEqual(actualFiles, [...exactFiles].sort(), "reward relay source inventory must remain exact and deployment-free");
  assert(!existsSync(resolve(root, relayRoot, "deploy")), "reward relay deployment templates must remain absent");
  assert(existsSync(resolve(root, "scripts/check-reward-relay.mjs")), "reward relay repository guard is missing");

  const packageJson = parseJson(`${relayRoot}/package.json`);
  assert(packageJson.private === true, "reward relay package must remain private");
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    assert(!packageJson[field] || Object.keys(packageJson[field]).length === 0, `reward relay ${field} must remain empty`);
  }
  const environment = readRequired(`${relayRoot}/.env.example`);
  assert(/^TREMENDOUS_MODE=disabled$/m.test(environment), "reward relay mode must default to disabled");
  assert(/^TREMENDOUS_ORDERS_ENABLED=false$/m.test(environment), "reward relay orders must default to false");
  assert(/^REWARD_RELAY_HOST=127\.0\.0\.1$/m.test(environment), "reward relay must default to loopback");
  assert(/^TREMENDOUS_API_KEY=$/m.test(environment), "reward relay example API key must remain empty");
  assert(/^REWARD_RELAY_HMAC_SECRET=$/m.test(environment), "reward relay example HMAC secret must remain empty");

  const config = readRequired(`${relayRoot}/src/config.mjs`);
  assertIncludes("reward relay disabled default", config, 'TREMENDOUS_MODE || "disabled"');
  assertIncludes("reward relay closed order default", config, 'TREMENDOUS_ORDERS_ENABLED || "false"');
  assertIncludes("reward relay order guard", config, "Orders cannot be enabled while the provider is disabled.");
  assertIncludes("reward relay loopback guard", config, 'host !== "127.0.0.1" && host !== "::1"');
}

function checkOptionalPrivateSsrBoundary() {
  const claimPages = appPageFilesForRoute("/raffle/claim");
  const leaderPages = appPageFilesForRoute("/leader-dashboard/raffle");
  const routeBoundaryFiles = [
    "apps/web/scripts/check-raffle-server-boundary.mjs",
    "apps/web/scripts/test-raffle-server-boundary.mjs",
  ];
  const requiredWhenPresent = [
    ...routeBoundaryFiles,
    "apps/web/lib/supabase/server-auth.ts",
    "apps/web/lib/supabase/raffle-response-policy.ts",
    "apps/web/proxy.ts",
  ];
  const boundaryPresent = claimPages.length > 0 || leaderPages.length > 0 ||
    routeBoundaryFiles.some((file) => existsSync(resolve(root, file)));
  if (!boundaryPresent) return;
  assert(claimPages.length === 1, `private raffle SSR boundary must contain exactly one route-group-normalized /raffle/claim page; found ${claimPages.length}`);
  assert(leaderPages.length === 1, `private raffle SSR boundary must contain exactly one route-group-normalized /leader-dashboard/raffle page; found ${leaderPages.length}`);
  requiredWhenPresent.forEach((file) => assert(existsSync(resolve(root, file)), `private raffle SSR boundary is partial; missing ${file}`));
  if (claimPages.length !== 1 || leaderPages.length !== 1 || requiredWhenPresent.some((file) => !existsSync(resolve(root, file)))) return;

  for (const [file, decision, destination] of [
    [claimPages[0], "getRaffleClaimPageDecision", "/raffle/claim"],
    [leaderPages[0], "getRaffleModeratorPageDecision", "/leader-dashboard/raffle"],
  ]) {
    const source = readRequired(file);
    for (const snippet of ['export const dynamic = "force-dynamic"', "export const revalidate = 0", `${decision}()`, 'decision === "redirect-auth"', 'decision === "not-found"', "notFound()", destination]) {
      assertIncludes(`${file} private server boundary`, source, snippet);
    }
    assert(!/["']use client["']|<form\b|<button\b/i.test(source), `${file}: disabled private route must not expose client controls`);
  }
  const serverAuth = readRequired("apps/web/lib/supabase/server-auth.ts");
  assertIncludes("private raffle verified claims", serverAuth, "auth.getClaims()");
  assert(!serverAuth.includes("auth.getSession()"), "private raffle server authorization must not trust getSession()");
  const responsePolicy = readRequired("apps/web/lib/supabase/raffle-response-policy.ts");
  assertIncludes("private raffle response policy", responsePolicy, "private, no-cache, no-store");
  assertIncludes("private raffle response policy", responsePolicy, "noindex, nofollow");
}

function checkCommandWiring() {
  const packageJson = parseJson("package.json");
  const scripts = packageJson.scripts || {};
  assert(scripts["check:raffle-public"] === "node scripts/check-raffle-closed-state.mjs", "check:raffle-public command must be exact");
  assert(scripts["check:raffle-disabled-foundation"] === "node scripts/check-raffle-disabled-foundation.mjs", "check:raffle-disabled-foundation command must be exact");
  assert(scripts["check:reward-relay"] === "node scripts/check-reward-relay.mjs", "check:reward-relay command must be exact");
  assert(typeof scripts["test:raffle-disabled-foundation"] === "string", "test:raffle-disabled-foundation command is missing");
  assert(!Object.hasOwn(scripts, "check:raffle-closed-state"), "retired check:raffle-closed-state alias must remain absent");

  const checkAll = readRequired("scripts/check-all.mjs");
  for (const [label, command] of [
    ["check:raffle-public", "scripts/check-raffle-closed-state.mjs"],
    ["check:raffle-disabled-foundation", "scripts/check-raffle-disabled-foundation.mjs"],
    ["test:raffle-disabled-foundation", "supabase/functions/_shared/raffle-flags_test.ts"],
    ["check:reward-relay", "scripts/check-reward-relay.mjs"],
  ]) {
    assert(count(checkAll, `\"${label}\"`) === 1, `scripts/check-all.mjs must wire ${label} exactly once`);
    assert(count(checkAll, command) === 1, `scripts/check-all.mjs must reference ${command} exactly once`);
  }

  if (privateSsrBoundaryPresent()) {
    const webPackageJson = parseJson("apps/web/package.json");
    const webScripts = webPackageJson.scripts || {};
    const expectedSsrCommands = {
      "check:raffle-server-boundary": "node scripts/check-raffle-server-boundary.mjs",
      "test:raffle-server-boundary": "node scripts/test-raffle-server-boundary.mjs",
    };
    for (const [label, webCommand] of Object.entries(expectedSsrCommands)) {
      assert(webScripts[label] === webCommand, `apps/web ${label} command must be exact`);
      assert(scripts[label] === `npm --prefix apps/web run ${label}`, `root ${label} command must be an exact apps/web proxy`);
      assert(count(checkAll, `\"${label}\"`) === 1, `scripts/check-all.mjs must execute ${label} exactly once`);
      assert(
        count(checkAll, `\"--prefix\", \"apps/web\", \"run\", \"${label}\"`) === 1,
        `scripts/check-all.mjs must execute the apps/web ${label} command exactly once`,
      );
    }
  }
}

function privateSsrBoundaryPresent() {
  return appPageFilesForRoute("/raffle/claim").length > 0 ||
    appPageFilesForRoute("/leader-dashboard/raffle").length > 0 ||
    existsSync(resolve(root, "apps/web/scripts/check-raffle-server-boundary.mjs")) ||
    existsSync(resolve(root, "apps/web/scripts/test-raffle-server-boundary.mjs"));
}

function appPageFilesForRoute(route) {
  const appRoot = resolve(root, "apps/web/app");
  return listFiles(appRoot)
    .filter((file) => /(?:^|\/)page\.(?:[cm]?[jt]sx?)$/i.test(file))
    .filter((file) => appRouteForPage(file) === route)
    .map((file) => `apps/web/app/${file}`);
}

function appRouteForPage(file) {
  const segments = file.split("/").slice(0, -1)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .filter((segment) => !segment.startsWith("@"));
  return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
}

function parseFunctionSections(source) {
  const headers = [...source.matchAll(/^\[functions\.([^\]]+)\]\s*$/gmu)];
  return headers.map((match, index) => ({
    name: match[1],
    body: source.slice(match.index + match[0].length, headers[index + 1]?.index ?? source.length),
  }));
}

function value(body, key) {
  return new RegExp(`^${key}\\s*=\\s*(.+)$`, "mu").exec(body)?.[1]?.trim() || "";
}

function listFiles(directory, prefix = "") {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === "node_modules") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(resolve(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

function parseJson(file) {
  const source = readRequired(file);
  try {
    return JSON.parse(source || "{}");
  } catch (error) {
    failures.push(`${file}: invalid JSON (${error instanceof Error ? error.message : "unknown error"})`);
    return {};
  }
}

function readRequired(file) {
  const absolute = resolve(root, file);
  if (!existsSync(absolute)) {
    failures.push(`${file}: required file is missing`);
    return "";
  }
  return readFileSync(absolute, "utf8");
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function assertIncludes(label, source, snippet) {
  assert(source.includes(snippet), `${label}: missing ${snippet}`);
}

function assertDeepEqual(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function count(source, needle) {
  return source.split(needle).length - 1;
}
