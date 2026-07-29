import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serviceRoot = join(root, "services", "reward-relay");
const failures = [];

const requiredFiles = [
  ".env.example",
  ".gitignore",
  "README.md",
  "package.json",
  "package-lock.json",
  "contracts/reward-claim-boundary.mjs",
  "contracts/reward-handoff.mjs",
  "contracts/reward-webhook.mjs",
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

for (const path of requiredFiles) requireFile(path);
for (const path of [
  "contracts/reward-relay-protocol-v1.json",
  "supabase/functions/_shared/reward-relay-protocol-vector_test.ts",
]) {
  if (!existsSync(join(root, path))) fail(`Missing shared relay protocol file: ${path}`);
}
if (existsSync(join(serviceRoot, "deploy"))) fail("deployment templates must remain outside this disabled source track");

if (!failures.length) {
  const packageJson = JSON.parse(read("package.json"));
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (packageJson[field] && Object.keys(packageJson[field]).length) fail(`package.json ${field} must remain empty`);
  }
  if (packageJson.private !== true) fail("package.json must remain private");
  if (packageJson.engines?.node !== ">=22.18 <23") fail("package.json must retain the reviewed Node 22 engine boundary");

  const env = read(".env.example");
  requireMatch(env, /^TREMENDOUS_MODE=disabled$/m, ".env.example must default provider mode to disabled");
  requireMatch(env, /^TREMENDOUS_ORDERS_ENABLED=false$/m, ".env.example must default order creation to false");
  requireMatch(env, /^REWARD_RELAY_HOST=127\.0\.0\.1$/m, ".env.example must default to loopback");
  requireMatch(env, /^REWARD_RELAY_INBOUND_REQUEST_TIMEOUT_MS=10000$/m, ".env.example must retain the reviewed inbound request deadline");
  requireMatch(env, /^REWARD_RELAY_HEADERS_TIMEOUT_MS=5000$/m, ".env.example must retain the reviewed header deadline");
  requireMatch(env, /^REWARD_RELAY_KEEP_ALIVE_TIMEOUT_MS=5000$/m, ".env.example must retain the reviewed keep-alive timeout");
  for (const name of ["TREMENDOUS_API_KEY", "REWARD_RELAY_HMAC_SECRET"]) {
    requireMatch(env, new RegExp(`^${name}=$`, "m"), `.env.example must not contain a ${name} value`);
  }
  requireAll(read(".gitignore"), ["data/", "*.sqlite", "*.sqlite3", "*.sqlite3-wal"], "local relay state ignore boundary");

  const configSource = read("src/config.mjs");
  requireAll(configSource, [
    'sandbox: "https://testflight.tremendous.com/api/v2"',
    'production: "https://api.tremendous.com/api/v2"',
    'host !== "127.0.0.1" && host !== "::1"',
    'TREMENDOUS_MODE || "disabled"',
    'TREMENDOUS_ORDERS_ENABLED || "false"',
    "rewardHost: PROVIDER_REWARD_HOSTS[mode] || null",
    "env.REWARD_RELAY_INBOUND_REQUEST_TIMEOUT_MS, 10_000, 10_000, 10_000",
    "env.REWARD_RELAY_HEADERS_TIMEOUT_MS, 5_000, 5_000, 5_000",
    "env.REWARD_RELAY_KEEP_ALIVE_TIMEOUT_MS, 5_000, 5_000, 5_000",
  ], "fixed origins, loopback binding, and closed defaults");
  for (const forbidden of ["TREMENDOUS_BASE_URL", "PROVIDER_BASE_URL", "REWARD_PROVIDER_URL"]) {
    if (configSource.includes(`env.${forbidden}`)) fail(`config must not accept arbitrary provider origin variable ${forbidden}`);
  }

  requireAll(read("src/protocol.mjs"), [
    "createHmac(\"sha256\"",
    "timingSafeEqual",
    "x-mochirii-timestamp",
    "x-mochirii-nonce",
    "x-mochirii-body-sha256",
    "x-mochirii-response-signature",
    "state.consumeNonce",
    "timestampSeconds + maxClockSkewSeconds + 1",
    'production: "reward.tremendous.com"',
    'sandbox: "testflight.tremendous.com"',
    '"cycleId"',
    "EXTERNAL_ID_RE",
    "compareCodeUnits(left, right)",
    "leftText < rightText ? -1 : 1",
  ], "mutual relay authentication, freshness, replay prevention, and external ID contract");
  requireNone(read("src/protocol.mjs"), ["localeCompare"], "locale-dependent canonical sorting");
  requireAll(read("test/protocol-vector.test.mjs"), [
    "contracts/reward-relay-protocol-v1.json",
    "parseRelayRequest",
    "buildSignatureHeaders",
    "buildResponseSignatureHeaders",
  ], "shared cross-runtime protocol vectors");
  requireAll(
    readFileSync(
      join(root, "supabase", "functions", "_shared", "reward-relay-protocol-vector_test.ts"),
      "utf8",
    ),
    [
      "contracts/reward-relay-protocol-v1.json",
      "parseRelayRequest",
      "buildRelaySignatureHeaders",
      "buildRelayResponseSignatureHeaders",
      "Edge relay deadline remains active through a stalled response body",
    ],
    "Edge and Node shared protocol vectors",
  );

  requireAll(read("src/service.mjs"), [
    "consumeRate",
    "markOrderUncertain",
    "#reconcileKnownOrder",
    "provider_idempotency_conflict",
    "suspendOrders",
    "buildResponseSignatureHeaders",
    "maximumCycleCostCents",
    "cycle_budget_exceeded",
    "provider_identifier_conflict",
  ], "rate limiting, uncertain reconciliation, conflict suspension, and signed responses");

  const providerSource = read("src/tremendous.mjs");
  requireAll(providerSource, [
    "AbortController",
    'redirect: "error"',
    "maximumResponseBytes",
    "readJsonBounded(response, this.maximumResponseBytes, controller.signal)",
    "withAbortDeadline",
    "reader.cancel()",
    'delivery: { method: "LINK" }',
    "url.origin !== this.baseUrl.origin",
    "allowedBaseUrls.has(candidateBaseUrl.href)",
  ], "bounded fixed-origin provider client and recipient-less LINK delivery");
  requireNone(providerSource.slice(providerSource.indexOf("export function buildOrderPayload"), providerSource.indexOf("function supportsUsdDenomination")), [
    "recipient", "email", "phone",
  ], "order payload recipient fields");

  const handoffSource = read("contracts/reward-handoff.mjs");
  requireAll(handoffSource, [
    'createHmac("sha256", key)',
    "randomBytesFn(32)",
    "MemoryRewardHandoffStore",
    "handleDigest: sha256Hex(handleBytes)",
    "storeHandoffHandle",
    "consumeHandoffHandle",
    "constantTimeTextEqual(record.handleDigest, handleDigest)",
    "REWARD_HANDOFF_MAX_AGE_SECONDS = 60",
    "header.length > 16_384",
    "HttpOnly; Secure; SameSite=Strict",
    "expectedOrigin",
    "expectedPath",
  ], "origin-bound opaque one-use handoff");
  requireNone(handoffSource, ["rewardUrl", "createCipheriv", "createDecipheriv"], "browser or handoff-state reward URL retention");

  requireAll(read("contracts/reward-webhook.mjs"), [
    'createHmac("sha256", secret).update(rawBody)',
    "rewardWebhookMaxBytes = 65_536",
    "eventUuid",
    "bodyHash",
    "duplicate",
    "conflict",
    "timingSafeEqual",
    'status: 200',
  ], "raw-body webhook authentication and UUID deduplication");

  const claimBoundarySource = read("contracts/reward-claim-boundary.mjs");
  requireAll(claimBoundarySource, [
    'new Set(["electronic", "in_game", "community_honor"])',
    "claimsEnabled = false",
    "authorizeClaim = async () => null",
    'authorizationMode: phase === "begin" ? "authorize_or_replay" : "revalidate_for_handoff"',
    "requireAtomicAuthorization: true",
    'value.membershipState !== "active"',
    'value.ownershipState !== "winner"',
    'value.deadlineState !== "open"',
    "recordInGameClaim",
    "recordCommunityHonor",
    'fetchSite !== "same-origin"',
    "verifySignedResponse",
    "createRewardHandoff",
    "consumeRewardHandoff",
    'REWARD_CLAIM_PAGE_PATH = "/raffle/claim"',
    'cacheControl: "private, no-store"',
    '"cache-control": "private, no-store"',
    '"referrer-policy": "no-referrer"',
    "analytics: false",
    "thirdPartyScripts: false",
    "thirdPartyRequests: false",
    "#generateRewardUrl",
  ], "server-boundary checks and separated reward kinds");
  if ((claimBoundarySource.match(/safeTremendousHttpsLink\(/g) || []).length < 2) {
    fail("claim boundary must validate the exact reward host both on relay receipt and final redirect");
  }

  const stateSource = read("src/state.mjs");
  requireAll(stateSource, [
    "replay_nonces", "order_bindings", "reconciliation_runs", "reward_link_limits",
    "cycle_id TEXT NOT NULL UNIQUE", "reward_value_cents", "BEGIN IMMEDIATE",
    "relay_state_schema_upgrade_required", "expires_at_ms <= ?",
    "provider_order_id TEXT UNIQUE", "provider_reward_id TEXT UNIQUE",
    "provider_identifier_conflict",
    "(provider_order_id IS NULL AND provider_reward_id IS NULL)",
    "(provider_order_id = ? AND provider_reward_id = ?)",
  ], "durable relay state");
  requireNone(stateSource.toLowerCase(), ["reward_url", "redemption_url", "link_url", "url text"], "persisted reward URL columns");

  const serverSource = read("src/server.mjs");
  requireAll(serverSource, [
    "endpointClass", "statusCode", "latencyMs", '"Cache-Control": "no-store, max-age=0"',
    "server.requestTimeout = config.inboundRequestTimeoutMs",
    "server.headersTimeout = config.headersTimeoutMs",
    "server.keepAliveTimeout = config.keepAliveTimeoutMs",
    "request_body_timeout",
  ], "metadata-only logging and bounded inbound HTTP handling");
  requireNone(serverSource.slice(serverSource.indexOf("function defaultLogger")), ["request", "rawBody", "response", "headers", "body"], "sensitive request or response logging");

  const chainTests = read("test/reward-chain.test.mjs");
  requireAll(chainTests, [
    "mocked browser to opaque handle to final signed relay retrieval and authorized redirect",
    "forged relay response authentication is rejected before the final redirect",
    "hostile origin, host, path, and cross-site request metadata",
    "raw-body webhook HMAC and event UUID dedupe",
    "electronic, in-game, and community-honor paths remain distinct",
    "caller-supplied winner data cannot authorize or select a reward path",
    "handoff redirect requires a fresh server authorization",
    "a misbound durable handoff adapter cannot substitute another claim record",
    "an unrelated server-readable session cookie does not crowd out the bounded handoff token",
    "claim-page isolation contract forbids shared caching, analytics, and third-party execution",
    "https://attacker.example/rewards/forged",
    'assert.equal("rewardUrl" in accepted, false)',
    'origin: "https://other.example"',
  ], "end-to-end and hostile-path regression coverage");

  requireAll(read("test/relay.test.mjs"), [
    "future-dated nonce remains consumed through its absolute signature-validity horizon",
    "cycle reservation atomically enforces its budget and exactly one primary electronic order",
    "concurrent provider identifier drift preserves one exact pair and suspends orders",
    "provider deadline remains active through a stalled response body and cancels its reader",
    "HTTP server applies reviewed inbound deadlines and terminates a stalled request body",
    "canonical JSON uses locale-independent UTF-16 code-unit ordering",
    "https://unrelated.tremendous.com/rewards/payout/leak",
  ], "replay, identifier-CAS, timeout, canonicalization, cycle-budget, and exact-host regression coverage");

  const publicConfigCheck = readFileSync(join(root, "scripts", "check-supabase-public-config.mjs"), "utf8");
  requireAll(publicConfigCheck, [
    '"services/reward-relay/.env.example"',
    "untrackedFiles.filter(isEnvPath).forEach((file) => {",
    'addFailure(file, 0, "untracked environment file is not ignored; update .gitignore before adding secrets locally.");',
    "trackedFiles.filter((file) => existsSync(path.join(root, file))).filter(isTextFile)",
  ], "tracked-example scanning and unconditional untracked environment rejection");

  const integrationContract = readFileSync(join(root, "docs", "integrations", "reward-relay.md"), "utf8");
  requireAll(integrationContract, [
    "Mochirii-Wushu/Mochirii-Website",
    "20260728140000_add_disabled_monthly_raffle_foundation.sql",
    "one standard entry",
    "up to nine optional bonus entries",
    "Provider-specific identifiers remain internal",
  ], "current repository, migration, entry, and public-brand contract");

  const serviceReadme = read("README.md");
  requireAll(serviceReadme, [
    "Mochirii-Wushu/Mochirii-Website",
    "20260728140000_add_disabled_monthly_raffle_foundation.sql",
    "one standard entry plus up to nine optional bonus entries",
    "The included in-memory store is test-only.",
  ], "current disabled relay compatibility contract");

  const customerFacingRafflePaths = [
    "apps/web/app/raffle/page.tsx",
    "apps/web/components/public-pages/route-pages/RafflePage.tsx",
    "apps/web/lib/raffle/public-view.ts",
    "apps/web/public/data/raffles.json",
  ];
  const customerFacingProviderPattern = /tremendous|loot happens|reward provider/gi;
  for (const relativePath of customerFacingRafflePaths) {
    const content = readFileSync(join(root, ...relativePath.split("/")), "utf8");
    if (customerFacingProviderPattern.test(content)) {
      fail(`${relativePath} exposes a provider-specific reward name on the public raffle surface`);
    }
    customerFacingProviderPattern.lastIndex = 0;
  }
}

try {
  const { loadConfig, PROVIDER_BASE_URLS } = await import(pathToFileURL(join(serviceRoot, "src", "config.mjs")));
  const {
    compareCodeUnits,
    drawResultIdFromExternalId,
    PROVIDER_REWARD_HOSTS,
    safeTremendousHttpsLink,
    sha256Hex,
    stableJson,
  } = await import(pathToFileURL(join(serviceRoot, "src", "protocol.mjs")));
  const { buildOrderPayload } = await import(pathToFileURL(join(serviceRoot, "src", "tremendous.mjs")));
  const defaults = loadConfig({});
  assert.equal(defaults.mode, "disabled");
  assert.equal(defaults.ordersEnabled, false);
  assert.equal(defaults.providerBaseUrl, null);
  assert.equal(defaults.host, "127.0.0.1");
  assert.equal(defaults.inboundRequestTimeoutMs, 10_000);
  assert.equal(defaults.headersTimeoutMs, 5_000);
  assert.equal(defaults.keepAliveTimeoutMs, 5_000);
  assert.throws(() => loadConfig({ REWARD_RELAY_INBOUND_REQUEST_TIMEOUT_MS: "9999" }));
  assert.deepEqual(PROVIDER_BASE_URLS, {
    sandbox: "https://testflight.tremendous.com/api/v2",
    production: "https://api.tremendous.com/api/v2",
  });
  assert.deepEqual(PROVIDER_REWARD_HOSTS, {
    sandbox: "testflight.tremendous.com",
    production: "reward.tremendous.com",
  });
  assert.equal(
    safeTremendousHttpsLink("https://reward.tremendous.com/rewards/opaque", "production"),
    "https://reward.tremendous.com/rewards/opaque",
  );
  assert.throws(() => safeTremendousHttpsLink("https://unrelated.tremendous.com/rewards/opaque", "production"));
  assert.throws(() => loadConfig({ REWARD_RELAY_HOST: "0.0.0.0" }), /loopback/);
  const canonicalValue = { "\uE000": 7, "😀": 6, "𐀀": 5, "é": 4, "e\u0301": 3, a: 2, A: 1 };
  const canonicalText = "{\"A\":1,\"a\":2,\"é\":3,\"é\":4,\"𐀀\":5,\"😀\":6,\"\":7}";
  assert.deepEqual(Object.keys(canonicalValue).sort(compareCodeUnits), ["A", "a", "e\u0301", "é", "𐀀", "😀", "\uE000"]);
  assert.equal(stableJson(canonicalValue), canonicalText);
  assert.equal(sha256Hex(Buffer.from(canonicalText)), "6e51c32e6eb16192c031414ab34558173076bb9e1a1f9ca4598204a2c6001a1d");
  const drawResultId = "12345678-1234-4234-9234-1234567890ab";
  assert.equal(drawResultIdFromExternalId(`mochirii-mpd-${drawResultId}-v1`), drawResultId);
  const payload = buildOrderPayload({
    externalId: `mochirii-mpd-${drawResultId}-v1`,
    campaignId: "campaign",
    productIds: ["product"],
    denomination: 10,
  });
  assert.deepEqual(Object.keys(payload.reward).sort(), ["campaign_id", "delivery", "products", "value"]);
  assert.equal(JSON.stringify(payload).includes("recipient"), false);
} catch (error) {
  fail(`executable contract assertions failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length) {
  console.error(`Reward relay contract failed (${failures.length} finding${failures.length === 1 ? "" : "s"}):`);
  for (const finding of failures) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Reward relay contract passed: disabled defaults, trust boundaries, idempotency, opaque handoff, and webhook controls are intact.");

function requireFile(path) {
  if (!existsSync(join(serviceRoot, path))) fail(`missing required file: services/reward-relay/${path}`);
}

function read(path) {
  return readFileSync(join(serviceRoot, path), "utf8");
}

function requireAll(text, values, label) {
  for (const value of values) if (!text.includes(value)) fail(`${label} is missing required contract: ${value}`);
}

function requireNone(text, values, label) {
  for (const value of values) if (text.includes(value)) fail(`${label} contains forbidden value: ${value}`);
}

function requireMatch(text, pattern, message) {
  if (!pattern.test(text)) fail(message);
}

function fail(message) {
  failures.push(message);
}
