import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createConnection } from "node:net";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { loadConfig, PROVIDER_BASE_URLS } from "../src/config.mjs";
import {
  buildSignatureHeaders,
  compareCodeUnits,
  PROVIDER_REWARD_HOSTS,
  RELAY_PATHS,
  safeTremendousHttpsLink,
  sha256Hex,
  stableJson,
} from "../src/protocol.mjs";
import { reconcileCampaign } from "../src/reconcile.mjs";
import { RelayService } from "../src/service.mjs";
import { createRelayServer } from "../src/server.mjs";
import { RelayState } from "../src/state.mjs";
import { ProviderTransportError, TremendousApi } from "../src/tremendous.mjs";

const DRAW_ID = "11111111-1111-4111-8111-111111111111";
const EXTERNAL_ID = `mochirii-mpd-${DRAW_ID}-v1`;
const CYCLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_DRAW_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_EXTERNAL_ID = `mochirii-mpd-${SECOND_DRAW_ID}-v1`;
const HMAC_SECRET = "relay-test-signing-secret-32-characters-minimum";

test("disabled is the default and cannot call a provider", async (t) => {
  const config = loadConfig({ REWARD_RELAY_HMAC_SECRET: HMAC_SECRET });
  assert.equal(config.mode, "disabled");
  assert.equal(config.ordersEnabled, false);
  assert.equal(config.providerBaseUrl, null);
  const state = stateFor(t);
  const provider = new Proxy({}, { get: () => () => assert.fail("disabled relay called a provider") });
  const service = new RelayService({ config, state, provider, now: () => 1_700_000_000_000 });
  const result = await signedRequest(service, RELAY_PATHS.readiness, {
    operation: "readiness",
    environment: "sandbox",
    configurationHash: "a".repeat(64),
  }, { secret: HMAC_SECRET, nowMs: 1_700_000_000_000 });
  assert.equal(result.status, 404);
});

test("authentication, freshness, strict JSON, and durable replay fail as 404", async (t) => {
  const { config } = activeConfig({ ordersEnabled: false });
  const state = stateFor(t);
  const provider = mockProvider(config);
  const nowMs = 1_700_000_000_000;
  const service = new RelayService({ config, state, provider, now: () => nowMs });
  const body = readinessRequest(config);
  const rawBody = Buffer.from(JSON.stringify(body));

  assert.equal((await service.handle({ method: "POST", path: RELAY_PATHS.readiness, headers: {}, rawBody })).status, 404);
  const stale = buildSignatureHeaders({
    secret: config.hmacSecret,
    path: RELAY_PATHS.readiness,
    body: rawBody,
    timestampSeconds: Math.floor(nowMs / 1_000) - 61,
    nonce: "stale_nonce_value_1234",
  });
  assert.equal((await service.handle({ method: "POST", path: RELAY_PATHS.readiness, headers: stale, rawBody })).status, 404);

  const nonce = "durable_replay_nonce_1234";
  const headers = buildSignatureHeaders({
    secret: config.hmacSecret,
    path: RELAY_PATHS.readiness,
    body: rawBody,
    timestampSeconds: Math.floor(nowMs / 1_000),
    nonce,
  });
  assert.equal((await service.handle({ method: "POST", path: RELAY_PATHS.readiness, headers, rawBody })).status, 200);
  assert.equal((await service.handle({ method: "POST", path: RELAY_PATHS.readiness, headers, rawBody })).status, 404);

  const malformed = Buffer.from(JSON.stringify({ ...body, unsupported: true }));
  const malformedHeaders = buildSignatureHeaders({
    secret: config.hmacSecret,
    path: RELAY_PATHS.readiness,
    body: malformed,
    timestampSeconds: Math.floor(nowMs / 1_000),
    nonce: "malformed_payload_nonce_12",
  });
  assert.equal((await service.handle({ method: "POST", path: RELAY_PATHS.readiness, headers: malformedHeaders, rawBody: malformed })).status, 404);
});

test("nonce replay remains rejected after SQLite state is reopened", async (t) => {
  const { config } = activeConfig({ ordersEnabled: false });
  const directory = mkdtempSync(join(tmpdir(), "mochirii-relay-replay-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "state.sqlite3");
  const nowMs = 1_700_000_000_000;
  const body = readinessRequest(config);
  const rawBody = Buffer.from(JSON.stringify(body));
  const headers = buildSignatureHeaders({
    secret: config.hmacSecret,
    path: RELAY_PATHS.readiness,
    body: rawBody,
    timestampSeconds: Math.floor(nowMs / 1_000),
    nonce: "restart_durable_nonce_1234",
  });
  const firstState = new RelayState(path);
  const first = await new RelayService({ config, state: firstState, provider: mockProvider(config), now: () => nowMs }).handle({
    method: "POST", path: RELAY_PATHS.readiness, headers, rawBody,
  });
  assert.equal(first.status, 200);
  firstState.close();
  const secondState = new RelayState(path);
  const second = await new RelayService({ config, state: secondState, provider: mockProvider(config), now: () => nowMs }).handle({
    method: "POST", path: RELAY_PATHS.readiness, headers, rawBody,
  });
  assert.equal(second.status, 404);
  secondState.close();
});

test("a future-dated nonce remains consumed through its absolute signature-validity horizon", async (t) => {
  const { config } = activeConfig({ ordersEnabled: false });
  const state = stateFor(t);
  const baseNowMs = 1_700_000_000_000;
  let currentNowMs = baseNowMs;
  const body = readinessRequest(config);
  const rawBody = Buffer.from(JSON.stringify(body));
  const headers = buildSignatureHeaders({
    secret: config.hmacSecret,
    path: RELAY_PATHS.readiness,
    body: rawBody,
    timestampSeconds: Math.floor(baseNowMs / 1_000) + 60,
    nonce: "future_timestamp_replay_nonce_1234",
  });
  const service = new RelayService({ config, state, provider: mockProvider(config), now: () => currentNowMs });
  assert.equal((await service.handle({ method: "POST", path: RELAY_PATHS.readiness, headers, rawBody })).status, 200);
  currentNowMs = baseNowMs + 61_000;
  assert.equal((await service.handle({ method: "POST", path: RELAY_PATHS.readiness, headers, rawBody })).status, 404);
});

test("HTTP boundary returns generic 404 and emits metadata-only logs", async (t) => {
  const config = loadConfig({ REWARD_RELAY_HMAC_SECRET: HMAC_SECRET });
  const state = stateFor(t);
  const logs = [];
  const server = createRelayServer({ config, state, provider: null, logger: (event) => logs.push(event) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}${RELAY_PATHS.readiness}`, { method: "GET" })).status, 404);
  assert.equal((await fetch(`${base}${RELAY_PATHS.readiness}?query=forbidden`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  })).status, 404);
  assert.equal((await fetch(`${base}${RELAY_PATHS.readiness}`, {
    method: "POST", headers: { "content-type": "text/plain" }, body: "private-body-marker",
  })).status, 404);
  assert.equal(logs.length, 3);
  for (const event of logs) {
    assert.deepEqual(Object.keys(event).sort(), ["endpointClass", "event", "latencyMs", "statusCode", "traceId"]);
    assert.equal(JSON.stringify(event).includes("private-body-marker"), false);
  }
});

test("HTTP boundary rejects literal and percent-encoded dot-segment route aliases before authentication", async (t) => {
  const { config } = activeConfig({ ordersEnabled: false });
  const state = stateFor(t);
  const provider = mockProvider(config);
  const server = createRelayServer({ config, state, provider, logger: () => {} });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });

  const body = Buffer.from(JSON.stringify(readinessRequest(config)));
  const { port } = server.address();
  for (const [index, path] of [
    "/ignored/../v1/readiness",
    "/ignored/%2e%2e/v1/readiness",
  ].entries()) {
    const headers = buildSignatureHeaders({
      secret: config.hmacSecret,
      path: RELAY_PATHS.readiness,
      body,
      nonce: `raw_route_alias_nonce_${index}_1234`,
    });
    const status = await rawHttpStatus({ port, path, headers, body });
    assert.equal(status, 404);
  }
  assert.equal(provider.count("listOrganizations"), 0);
});

test("HTTP server applies reviewed inbound deadlines and terminates a stalled request body", async (t) => {
  const defaults = loadConfig({ REWARD_RELAY_HMAC_SECRET: HMAC_SECRET });
  assert.equal(defaults.inboundRequestTimeoutMs, 10_000);
  assert.equal(defaults.headersTimeoutMs, 5_000);
  assert.equal(defaults.keepAliveTimeoutMs, 5_000);
  assert.throws(() => loadConfig({
    REWARD_RELAY_HMAC_SECRET: HMAC_SECRET,
    REWARD_RELAY_INBOUND_REQUEST_TIMEOUT_MS: "9999",
  }), /REWARD_RELAY_INBOUND_REQUEST_TIMEOUT_MS/);

  const config = {
    ...defaults,
    inboundRequestTimeoutMs: 50,
    headersTimeoutMs: 40,
    keepAliveTimeoutMs: 30,
  };
  const state = stateFor(t);
  const logs = [];
  const provider = new Proxy({}, { get: () => () => assert.fail("stalled request reached provider") });
  const server = createRelayServer({ config, state, provider, logger: (event) => logs.push(event) });
  assert.equal(server.requestTimeout, 50);
  assert.equal(server.headersTimeout, 40);
  assert.equal(server.keepAliveTimeout, 30);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });

  const { port } = server.address();
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.on("error", () => {});
  await once(socket, "connect");
  const closed = new Promise((resolve) => socket.once("close", resolve));
  const startedAt = Date.now();
  socket.write([
    `POST ${RELAY_PATHS.readiness} HTTP/1.1`,
    "Host: 127.0.0.1",
    "Content-Type: application/json",
    "Content-Length: 100",
    "Connection: close",
    "",
    "{",
  ].join("\r\n"));
  await Promise.race([
    closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("stalled_body_was_not_terminated")), 1_000)),
  ]);
  assert.ok(Date.now() - startedAt < 750);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].statusCode, 404);
});

test("readiness validates organization, campaign, catalog, balance, and separate order gate", async (t) => {
  const { config } = activeConfig({ ordersEnabled: false });
  const state = stateFor(t);
  const provider = mockProvider(config);
  const result = await signedRequest(
    new RelayService({ config, state, provider }),
    RELAY_PATHS.readiness,
    readinessRequest(config),
    { secret: config.hmacSecret },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ready: true,
    environment: "sandbox",
    accountStatus: "active",
    apiOrders: true,
    ordersEnabled: false,
    organizationMatches: true,
    campaignMatches: true,
    configurationMatches: true,
    availableBalanceCents: 10_000,
    pendingBalanceCents: 0,
  });
  assert.equal(provider.count("listProducts"), 1);
  assert.equal(provider.count("listForex"), 1);
});

test("order creation performs a fresh product preflight, sends exact LINK payload, and discards the initial link", async (t) => {
  const { config } = activeConfig();
  const state = stateFor(t);
  const request = createOrderRequest(config);
  const initialLink = "https://testflight.tremendous.com/rewards/payout/initial-secret-value";
  const provider = mockProvider(config, {
    createOrder(payload) {
      assert.deepEqual(payload, {
        external_id: EXTERNAL_ID,
        payment: { funding_source_id: "balance" },
        reward: {
          campaign_id: "CAMPAIGN1",
          products: ["PRODUCT1"],
          value: { denomination: 10, currency_code: "USD" },
          delivery: { method: "LINK" },
        },
      });
      assert.equal("recipient" in payload.reward, false);
      return okOrder(request, { link: initialLink });
    },
  });
  const service = new RelayService({ config, state, provider });
  const result = await signedRequest(service, RELAY_PATHS.createOrder, request, { secret: config.hmacSecret });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    outcome: "created",
    orderReference: "ORDER1",
    rewardReference: "REWARD1",
    sanitizedStatus: "executed",
  });
  assert.equal(provider.count("listProducts"), 2, "readiness and immediately-pre-create catalog checks both ran");
  assert.equal(provider.count("listForex"), 2);
  assert.equal(provider.count("createOrder"), 1);
  assert.equal(JSON.stringify(result).includes(initialLink), false);
  assert.equal(JSON.stringify(state.listOrderBindings()).includes(initialLink), false);
});

test("catalog drift, unsupported denomination, category, and country all fail before provider order creation", async (t) => {
  const cases = [
    ["removed", []],
    ["denomination", [{ ...validProduct(), skus: [{ min: 25, max: 25 }] }]],
    ["category", [{ ...validProduct(), category: "prepaid_card" }]],
    ["ach monetary category", [{ ...validProduct(), category: "ach" }]],
    ["wallet monetary category", [{ ...validProduct(), category: "wallet" }]],
    ["country", [{ ...validProduct(), countries: [{ abbr: "CA" }] }]],
  ];
  for (const [name, products] of cases) {
    await t.test(name, async (t) => {
      const { config } = activeConfig();
      const state = stateFor(t);
      const provider = mockProvider(config, {
        listProducts() {
          return { status: 200, body: { products } };
        },
      });
      const result = await signedRequest(
        new RelayService({ config, state, provider }),
        RELAY_PATHS.createOrder,
        createOrderRequest(config),
        { secret: config.hmacSecret, nonce: `catalog_case_${name.replace(/[^a-z0-9]+/gi, "_")}_nonce_1234` },
      );
      assert.equal(result.status, 503);
      assert.equal(provider.count("createOrder"), 0);
    });
  }
});

test("whole-dollar $10, $25, and $50 gross prizes succeed while $9, $10.50, and $51 fail closed", async (t) => {
  for (const denomination of [10, 25, 50]) {
    await t.test(`$${denomination} succeeds`, async (t) => {
      const { config } = activeConfig();
      const state = stateFor(t);
      const request = createOrderRequest(config, { denomination });
      const provider = mockProvider(config, {
        createOrder: () => okOrder(request),
      });
      const result = await signedRequest(
        new RelayService({ config, state, provider }),
        RELAY_PATHS.createOrder,
        request,
        {
          secret: config.hmacSecret,
          nonce: `valid_${denomination}_dollar_nonce_1234`,
        },
      );
      assert.equal(result.status, 200);
      assert.equal(provider.count("createOrder"), 1);
    });
  }

  for (const denomination of [9, 10.5, 51]) {
    await t.test(`$${denomination} is rejected`, async (t) => {
      const { config } = activeConfig();
      const state = stateFor(t);
      const provider = mockProvider(config);
      const result = await signedRequest(
        new RelayService({ config, state, provider }),
        RELAY_PATHS.createOrder,
        createOrderRequest(config, { denomination }),
        {
          secret: config.hmacSecret,
          nonce: `invalid_${String(denomination).replace(".", "_")}_dollar_nonce_1234`,
        },
      );
      assert.equal(result.status, 404);
      assert.equal(provider.count("createOrder"), 0);
    });
  }
});

test("both merchant-card category spellings currently present in official docs are accepted", async (t) => {
  for (const category of ["merchant_card", "merchant_cards"]) {
    await t.test(category, async (t) => {
      const { config } = activeConfig();
      const state = stateFor(t);
      const request = createOrderRequest(config);
      const provider = mockProvider(config, {
        listProducts: () => ({ status: 200, body: { products: [{ ...validProduct(), category }] } }),
        createOrder: () => okOrder(request),
      });
      const result = await signedRequest(
        new RelayService({ config, state, provider }),
        RELAY_PATHS.createOrder,
        request,
        { secret: config.hmacSecret, nonce: `merchant_category_${category}_nonce_1234` },
      );
      assert.equal(result.status, 200);
    });
  }
});

test("local one-order-per-draw idempotency returns existing and conflicts on payload drift", async (t) => {
  const { config } = activeConfig({ productIds: ["PRODUCT1", "PRODUCT2"] });
  const state = stateFor(t);
  const firstRequest = createOrderRequest(config, { productIds: ["PRODUCT1"] });
  const provider = mockProvider(config, { createOrder: () => okOrder(firstRequest) });
  const service = new RelayService({ config, state, provider });
  assert.equal((await signedRequest(service, RELAY_PATHS.createOrder, firstRequest, { secret: config.hmacSecret })).status, 200);
  const duplicate = await signedRequest(service, RELAY_PATHS.createOrder, firstRequest, {
    secret: config.hmacSecret,
    nonce: "duplicate_order_nonce_1234",
  });
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.body.outcome, "existing");
  assert.equal(provider.count("createOrder"), 1);

  const drifted = await signedRequest(service, RELAY_PATHS.createOrder, createOrderRequest(config, { productIds: ["PRODUCT2"] }), {
    secret: config.hmacSecret,
    nonce: "conflicting_order_nonce_123",
  });
  assert.equal(drifted.status, 409);
  assert.equal(state.getControl().ordersSuspended, true);
  assert.equal(provider.count("createOrder"), 1);
});

test("cycle reservation atomically enforces its budget and exactly one primary electronic order", async (t) => {
  const { config } = activeConfig();
  const budgetState = stateFor(t);
  const overBudgetRequest = createOrderRequest(config, { denomination: 50 });
  const overBudget = budgetState.reserveOrder({
    externalId: overBudgetRequest.externalId,
    cycleId: overBudgetRequest.cycleId,
    drawResultId: overBudgetRequest.drawResultId,
    rewardValueCents: 5_001,
    maximumCycleCostCents: 5_000,
    requestHash: "b".repeat(64),
    requestJson: JSON.stringify(overBudgetRequest),
    environment: overBudgetRequest.environment,
    nowMs: 1,
  });
  assert.equal(overBudget.outcome, "cycle_budget_exceeded");
  assert.equal(budgetState.listOrderBindings().length, 0);

  const state = stateFor(t);
  const firstRequest = createOrderRequest(config, { denomination: 50 });
  const secondRequest = createOrderRequest(config, {
    drawResultId: SECOND_DRAW_ID,
    externalId: SECOND_EXTERNAL_ID,
    denomination: 50,
  });
  const provider = mockProvider(config, { createOrder: () => okOrder(firstRequest) });
  const service = new RelayService({ config, state, provider });
  assert.equal((await signedRequest(service, RELAY_PATHS.createOrder, firstRequest, {
    secret: config.hmacSecret,
    nonce: "cycle_primary_first_nonce_1234",
  })).status, 200);
  const second = await signedRequest(service, RELAY_PATHS.createOrder, secondRequest, {
    secret: config.hmacSecret,
    nonce: "cycle_primary_second_nonce_123",
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, "integrity_stop");
  assert.equal(provider.count("createOrder"), 1);
  assert.equal(state.listOrderBindings().length, 1);
  assert.equal(state.getOrderByCycleId(CYCLE_ID).reward_value_cents, 5_000);
});

test("provider identifiers bind once, replay exactly, and suspend on drift or uniqueness conflict", (t) => {
  const state = stateFor(t);
  const first = createOrderRequest(activeConfig().config);
  const second = createOrderRequest(activeConfig().config, {
    cycleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    drawResultId: SECOND_DRAW_ID,
    externalId: SECOND_EXTERNAL_ID,
  });
  reserveBinding(state, first, "a".repeat(64), 1);
  reserveBinding(state, second, "b".repeat(64), 2);

  const initial = state.completeOrder(first.externalId, {
    orderReference: "ORDER1",
    rewardReference: "REWARD1",
    sanitizedStatus: "executed",
  }, 3);
  const replay = state.completeOrder(first.externalId, {
    orderReference: "ORDER1",
    rewardReference: "REWARD1",
    sanitizedStatus: "executed",
  }, 4);
  assert.equal(initial.provider_order_id, "ORDER1");
  assert.equal(replay.provider_reward_id, "REWARD1");

  assert.throws(() => state.completeOrder(first.externalId, {
    orderReference: "ORDER-DRIFT",
    rewardReference: "REWARD1",
    sanitizedStatus: "executed",
  }, 5), (error) => error?.code === "provider_identifier_conflict");
  assert.equal(state.getControl().ordersSuspended, true);
  assert.equal(state.getOrderByExternalId(first.externalId).provider_order_id, "ORDER1");

  assert.throws(() => state.completeOrder(second.externalId, {
    orderReference: "ORDER1",
    rewardReference: "REWARD2",
    sanitizedStatus: "executed",
  }, 6), (error) => error?.code === "provider_identifier_conflict");
  assert.equal(state.getOrderByExternalId(second.externalId).provider_order_id, null);
  assert.equal(state.getControl().reasonCode, "provider_identifier_conflict");
});

test("concurrent provider identifier drift preserves one exact pair and suspends orders", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "mochirii-relay-cas-test-"));
  const databasePath = join(directory, "state.sqlite3");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const request = createOrderRequest(activeConfig().config);
  const setup = new RelayState(databasePath);
  reserveBinding(setup, request, "c".repeat(64), 1);
  setup.close();

  const moduleUrl = new URL("../src/state.mjs", import.meta.url).href;
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      const { RelayState } = await import(workerData.moduleUrl);
      const state = new RelayState(workerData.databasePath);
      parentPort.postMessage({ status: "ready" });
      parentPort.once("message", () => {
        try {
          const binding = state.completeOrder(workerData.externalId, workerData.references, workerData.nowMs);
          parentPort.postMessage({ status: "complete", binding: {
            providerOrderId: binding.provider_order_id,
            providerRewardId: binding.provider_reward_id,
          } });
        } catch (error) {
          parentPort.postMessage({ status: "error", code: error && error.code });
        } finally {
          state.close();
          parentPort.close();
        }
      });
    })().catch((error) => {
      parentPort.postMessage({ status: "fatal", message: error && error.message });
      parentPort.close();
    });
  `;
  const pairs = [
    { orderReference: "ORDER-A", rewardReference: "REWARD-A", sanitizedStatus: "executed" },
    { orderReference: "ORDER-B", rewardReference: "REWARD-B", sanitizedStatus: "executed" },
  ];
  const workers = pairs.map((references, index) => new Worker(workerSource, {
    eval: true,
    workerData: { moduleUrl, databasePath, externalId: request.externalId, references, nowMs: 10 + index },
  }));
  const workerExits = workers.map((worker) => once(worker, "exit"));
  t.after(async () => Promise.allSettled(workers.map((worker) => worker.terminate())));
  const ready = await Promise.all(workers.map((worker) => nextWorkerMessage(worker)));
  assert.deepEqual(ready.map((message) => message.status), ["ready", "ready"]);
  const outcomes = workers.map((worker) => {
    const outcome = nextWorkerMessage(worker);
    worker.postMessage("go");
    return outcome;
  });
  const results = await Promise.all(outcomes);
  await Promise.all(workerExits);
  assert.equal(results.filter((result) => result.status === "complete").length, 1);
  assert.equal(results.filter((result) => result.code === "provider_identifier_conflict").length, 1);

  const readback = new RelayState(databasePath);
  const binding = readback.getOrderByExternalId(request.externalId);
  const selectedPair = `${binding.provider_order_id}/${binding.provider_reward_id}`;
  assert.ok(new Set(["ORDER-A/REWARD-A", "ORDER-B/REWARD-B"]).has(selectedPair));
  assert.equal(readback.getControl().ordersSuspended, true);
  assert.equal(readback.getControl().reasonCode, "provider_identifier_conflict");
  readback.close();
});

test("uncertain transport result is reconciled by immutable external ID before identical retry", async (t) => {
  const { config } = activeConfig();
  const state = stateFor(t);
  const request = createOrderRequest(config);
  let first = true;
  const provider = mockProvider(config, {
    createOrder() {
      if (first) {
        first = false;
        throw new ProviderTransportError("timeout");
      }
      assert.fail("retry must reconcile before another create call");
    },
    getOrder() {
      return okOrder(request);
    },
  });
  const service = new RelayService({ config, state, provider });
  const uncertain = await signedRequest(service, RELAY_PATHS.createOrder, request, { secret: config.hmacSecret });
  assert.equal(uncertain.status, 503);
  const reconciled = await signedRequest(service, RELAY_PATHS.createOrder, request, {
    secret: config.hmacSecret,
    nonce: "uncertain_retry_nonce_1234",
  });
  assert.equal(reconciled.status, 201);
  assert.equal(reconciled.body.outcome, "existing");
  assert.equal(provider.count("createOrder"), 1);
  assert.equal(provider.count("getOrder"), 1);
});

test("non-executed create and reconciliation responses are integrity stops", async (t) => {
  for (const orderStatus of ["PENDING", "CANCELED", "UNKNOWN"]) {
    await t.test(`create ${orderStatus}`, async (t) => {
      const { config } = activeConfig();
      const state = stateFor(t);
      const request = createOrderRequest(config);
      const provider = mockProvider(config, {
        createOrder: () => okOrder(request, { orderStatus }),
      });
      const result = await signedRequest(
        new RelayService({ config, state, provider }),
        RELAY_PATHS.createOrder,
        request,
        {
          secret: config.hmacSecret,
          nonce: `non_executed_${orderStatus.toLowerCase()}_nonce_1234`,
        },
      );
      assert.equal(result.status, 409);
      assert.equal(result.body.error, "integrity_stop");
      assert.equal(state.getControl().ordersSuspended, true);
      assert.equal(state.getOrderByExternalId(request.externalId).state, "uncertain");
    });
  }

  await t.test("reconciliation PENDING", async (t) => {
    const { config } = activeConfig();
    const state = stateFor(t);
    const request = createOrderRequest(config);
    let first = true;
    const provider = mockProvider(config, {
      createOrder() {
        if (first) {
          first = false;
          throw new ProviderTransportError("timeout");
        }
        assert.fail("retry must reconcile before another create call");
      },
      getOrder: () => okOrder(request, { orderStatus: "PENDING" }),
    });
    const service = new RelayService({ config, state, provider });
    assert.equal((await signedRequest(service, RELAY_PATHS.createOrder, request, {
      secret: config.hmacSecret,
      nonce: "pending_reconciliation_first_nonce_1234",
    })).status, 503);
    const reconciled = await signedRequest(service, RELAY_PATHS.createOrder, request, {
      secret: config.hmacSecret,
      nonce: "pending_reconciliation_retry_nonce_1234",
    });
    assert.equal(reconciled.status, 409);
    assert.equal(reconciled.body.error, "integrity_stop");
    assert.equal(state.getControl().ordersSuspended, true);
    assert.equal(state.getOrderByExternalId(request.externalId).state, "uncertain");
  });
});

test("create-order provider status contract preserves retry and stop semantics", async (t) => {
  const cases = [
    { name: "200 created", providerStatus: 200, expectedStatus: 200, suspended: false },
    { name: "201 existing", providerStatus: 201, expectedStatus: 201, suspended: false },
    { name: "400 validation", providerStatus: 400, expectedStatus: 400, suspended: false },
    { name: "401 authorization stop", providerStatus: 401, expectedStatus: 401, suspended: true },
    { name: "402 funding stop", providerStatus: 402, expectedStatus: 402, suspended: true },
    { name: "409 integrity conflict", providerStatus: 409, expectedStatus: 409, suspended: true },
    { name: "422 validation", providerStatus: 422, expectedStatus: 422, suspended: false },
    { name: "429 bounded retry", providerStatus: 429, expectedStatus: 429, suspended: false },
    { name: "500 uncertain", providerStatus: 500, expectedStatus: 503, suspended: false },
    { name: "502 uncertain", providerStatus: 502, expectedStatus: 503, suspended: false },
    { name: "timeout uncertain", providerStatus: "timeout", expectedStatus: 503, suspended: false },
  ];
  for (const item of cases) {
    await t.test(item.name, async (t) => {
      const { config } = activeConfig();
      const state = stateFor(t);
      const request = createOrderRequest(config);
      const provider = mockProvider(config, {
        createOrder: () => {
          if (item.providerStatus === "timeout") throw new ProviderTransportError("timeout");
          if (item.providerStatus === 200 || item.providerStatus === 201) {
            return { ...okOrder(request), status: item.providerStatus };
          }
          return {
            status: item.providerStatus,
            body: {},
            retryAfterSeconds: item.providerStatus === 429 ? 3 : 1,
          };
        },
      });
      const result = await signedRequest(
        new RelayService({ config, state, provider }),
        RELAY_PATHS.createOrder,
        request,
        { secret: config.hmacSecret, nonce: `status_${String(item.providerStatus)}_nonce_123456789` },
      );
      assert.equal(result.status, item.expectedStatus);
      assert.equal(state.getControl().ordersSuspended, item.suspended);
      if (item.providerStatus === 429) assert.equal(result.headers["Retry-After"], "3");
      if (item.providerStatus === 401) assert.equal(result.body.error, "authorization_stop");
      if (item.providerStatus === 402) assert.equal(result.body.error, "funding_stop");
      if (item.providerStatus === 409) assert.equal(result.body.error, "integrity_stop");
    });
  }
});

test("readiness resource absence and campaign drift durably pause orders", async (t) => {
  await t.test("provider 404", async (t) => {
    const { config } = activeConfig();
    const state = stateFor(t);
    const provider = mockProvider(config, { getCampaign: () => ({ status: 404, body: {} }) });
    const result = await signedRequest(
      new RelayService({ config, state, provider }),
      RELAY_PATHS.readiness,
      readinessRequest(config),
      { secret: config.hmacSecret, nonce: "readiness_404_nonce_123456" },
    );
    assert.equal(result.status, 409);
    assert.equal(state.getControl().ordersSuspended, true);
  });

  await t.test("campaign drift", async (t) => {
    const { config } = activeConfig();
    const state = stateFor(t);
    const provider = mockProvider(config, {
      getCampaign: () => ({
        status: 200,
        body: { campaign: { id: config.campaignId, products: ["UNREVIEWED"], fee_charged_to: "SENDER", auto_add_product_rule: null } },
      }),
    });
    const result = await signedRequest(
      new RelayService({ config, state, provider }),
      RELAY_PATHS.readiness,
      readinessRequest(config),
      { secret: config.hmacSecret, nonce: "readiness_drift_nonce_1234" },
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.ready, false);
    assert.equal(result.body.ordersEnabled, false);
    assert.equal(state.getControl().ordersSuspended, true);
  });
});

test("nonzero provider fee is an integrity stop and no response link reaches durable state", async (t) => {
  const { config } = activeConfig();
  const state = stateFor(t);
  const request = createOrderRequest(config);
  const secretLink = "https://testflight.tremendous.com/rewards/payout/never-store-this";
  const provider = mockProvider(config, {
    createOrder: () => okOrder(request, { fees: 1, subtotal: 10, total: 11, link: secretLink }),
  });
  const result = await signedRequest(
    new RelayService({ config, state, provider }),
    RELAY_PATHS.createOrder,
    request,
    { secret: config.hmacSecret },
  );
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "integrity_stop");
  assert.equal(state.getControl().ordersSuspended, true);
  assert.equal(JSON.stringify(state.listOrderBindings()).includes(secretLink), false);
});

test("provider amount drift, fractional money, and an over-cap total are integrity stops", async (t) => {
  const cases = [
    {
      name: "reward amount drift",
      requestDenomination: 25,
      response: { rewardDenomination: 10, subtotal: 25, total: 25 },
    },
    {
      name: "fractional-cent total",
      requestDenomination: 25,
      response: { subtotal: 25, total: 25.001 },
    },
    {
      name: "over-cap total",
      requestDenomination: 50,
      response: { subtotal: 50.01, total: 50.01 },
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async (t) => {
      const { config } = activeConfig();
      const state = stateFor(t);
      const request = createOrderRequest(config, {
        denomination: item.requestDenomination,
      });
      const provider = mockProvider(config, {
        createOrder: () => okOrder(request, item.response),
      });
      const result = await signedRequest(
        new RelayService({ config, state, provider }),
        RELAY_PATHS.createOrder,
        request,
        {
          secret: config.hmacSecret,
          nonce: `provider_amount_${item.name.replace(/[^a-z0-9]+/gi, "_")}_nonce_1234`,
        },
      );
      assert.equal(result.status, 409);
      assert.equal(result.body.error, "integrity_stop");
      assert.equal(state.getControl().ordersSuspended, true);
    });
  }
});

test("LINK delivery SUCCEEDED means active, not redeemed", async (t) => {
  const { config } = activeConfig();
  const state = stateFor(t);
  const request = createOrderRequest(config);
  const provider = mockProvider(config, {
    createOrder: () => okOrder(request),
    getReward: () => ({
      status: 200,
      body: { reward: { id: "REWARD1", delivery: { method: "LINK", status: "SUCCEEDED" } } },
    }),
  });
  const service = new RelayService({ config, state, provider });
  await signedRequest(service, RELAY_PATHS.createOrder, request, { secret: config.hmacSecret });
  const result = await signedRequest(service, RELAY_PATHS.rewardState, {
    operation: "reward_state",
    environment: "sandbox",
    rewardReference: "REWARD1",
  }, { secret: config.hmacSecret, nonce: "reward_state_nonce_value_12" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { rewardReference: "REWARD1", state: "active", deliveryState: "succeeded" });
});

test("fresh reward links are host-bounded, returned once, and never stored", async (t) => {
  const { config } = activeConfig();
  const state = stateFor(t);
  const request = createOrderRequest(config);
  const freshLink = "https://testflight.tremendous.com/rewards/payout/fresh-link-secret";
  const provider = mockProvider(config, {
    createOrder: () => okOrder(request),
    getReward: () => activeReward(),
    generateLink: () => ({ status: 200, body: { reward: { id: "REWARD1", link: freshLink } } }),
  });
  const service = new RelayService({ config, state, provider });
  await signedRequest(service, RELAY_PATHS.createOrder, request, { secret: config.hmacSecret });
  const linkRequest = { operation: "generate_link", environment: "sandbox", drawResultId: DRAW_ID, rewardReference: "REWARD1" };
  const first = await signedRequest(service, RELAY_PATHS.generateLink, linkRequest, {
    secret: config.hmacSecret,
    nonce: "fresh_link_nonce_value_123",
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.url, freshLink);
  assert.equal(JSON.stringify(state.listOrderBindings()).includes(freshLink), false);
  const throttled = await signedRequest(service, RELAY_PATHS.generateLink, linkRequest, {
    secret: config.hmacSecret,
    nonce: "throttled_link_nonce_1234",
  });
  assert.equal(throttled.status, 429);
  assert.equal(provider.count("generateLink"), 1);

  assert.throws(() => safeTremendousHttpsLink("https://evil.example/rewards/payout/leak", "sandbox"));
  assert.throws(() => safeTremendousHttpsLink("https://evil-tremendous.com/rewards/payout/leak", "production"));
  assert.throws(() => safeTremendousHttpsLink("https://unrelated.tremendous.com/rewards/payout/leak", "production"));
  assert.equal(
    safeTremendousHttpsLink("https://reward.tremendous.com/rewards/payout/production", "production"),
    "https://reward.tremendous.com/rewards/payout/production",
  );
  assert.throws(() => safeTremendousHttpsLink("https://user:pass@testflight.tremendous.com/rewards/payout/leak", "sandbox"));
  assert.throws(() => safeTremendousHttpsLink("https://testflight.tremendous.com/rewards/payout/leak#fragment", "sandbox"));
});

test("fresh reward link generation has a durable five-link cap and explicit internal unlock", (t) => {
  const { config } = activeConfig();
  const state = stateFor(t);
  const request = createOrderRequest(config);
  seedSucceededBinding(state, request);
  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(state.consumeLinkGeneration("REWARD1", index * 15 * 60_000, 15 * 60_000, 5), { ok: true });
  }
  assert.deepEqual(state.consumeLinkGeneration("REWARD1", 5 * 15 * 60_000, 15 * 60_000, 5), { ok: false, reason: "maximum" });
  assert.equal(state.unlockRewardLink("REWARD1", 5 * 15 * 60_000 + 1), true);
  assert.deepEqual(state.consumeLinkGeneration("REWARD1", 5 * 15 * 60_000 + 2, 15 * 60_000, 5), { ok: true });
});

test("flagged, cancelled, redeemed, and unknown reward states cannot generate a fresh link", async (t) => {
  const cases = [
    ["flagged", { status: "FLAGGED", delivery: { method: "LINK", status: "SUCCEEDED" } }],
    ["cancelled", { status: "CANCELLED", delivery: { method: "LINK", status: "CANCELLED" } }],
    ["redeemed", { status: "REDEEMED", delivery: { method: "LINK", status: "SUCCEEDED" } }],
    ["unknown", { status: "UNKNOWN", delivery: { method: "LINK", status: "UNKNOWN" } }],
  ];
  for (const [name, reward] of cases) {
    await t.test(name, async (t) => {
      const { config } = activeConfig();
      const state = stateFor(t);
      const request = createOrderRequest(config);
      const provider = mockProvider(config, {
        createOrder: () => okOrder(request),
        getReward: () => ({ status: 200, body: { reward: { id: "REWARD1", ...reward } } }),
        generateLink: () => assert.fail("unavailable reward must not generate a link"),
      });
      const service = new RelayService({ config, state, provider });
      await signedRequest(service, RELAY_PATHS.createOrder, request, { secret: config.hmacSecret });
      const result = await signedRequest(service, RELAY_PATHS.generateLink, {
        operation: "generate_link", environment: "sandbox", drawResultId: DRAW_ID, rewardReference: "REWARD1",
      }, { secret: config.hmacSecret, nonce: `unavailable_${name}_nonce_1234` });
      assert.equal(result.status, 423);
      assert.equal(provider.count("generateLink"), 0);
      assert.deepEqual(state.consumeLinkGeneration("REWARD1", Date.now(), 15 * 60_000, 5), { ok: true }, "failed state check did not consume a link slot");
    });
  }
});

test("an arbitrary HTTPS link response is rejected and suspends ordering", async (t) => {
  const { config } = activeConfig();
  const state = stateFor(t);
  const request = createOrderRequest(config);
  const provider = mockProvider(config, {
    createOrder: () => okOrder(request),
    getReward: () => activeReward(),
    generateLink: () => ({ status: 200, body: { reward: { id: "REWARD1", link: "https://attacker.example/rewards/payout/leak" } } }),
  });
  const service = new RelayService({ config, state, provider });
  await signedRequest(service, RELAY_PATHS.createOrder, request, { secret: config.hmacSecret });
  const result = await signedRequest(service, RELAY_PATHS.generateLink, {
    operation: "generate_link",
    environment: "sandbox",
    drawResultId: DRAW_ID,
    rewardReference: "REWARD1",
  }, { secret: config.hmacSecret, nonce: "arbitrary_link_nonce_1234" });
  assert.equal(result.status, 409);
  assert.equal(state.getControl().ordersSuspended, true);
});

test("nightly campaign reconciliation suspends on provider-only and missing-upstream orders", async (t) => {
  await t.test("provider-only", async (t) => {
    const { config } = activeConfig();
    const state = stateFor(t);
    const request = createOrderRequest(config);
    seedSucceededBinding(state, request);
    const providerOnly = okOrder({ ...request, externalId: "mochirii-mpd-22222222-2222-4222-8222-222222222222-v1" }).body.order;
    const provider = mockProvider(config, {
      listOrders: () => ({ status: 200, body: { orders: [okOrder(request).body.order, providerOnly] } }),
    });
    const result = await reconcileCampaign({ config, state, provider, now: () => 1_700_000_000_000 });
    assert.equal(result.status, "incident");
    assert.equal(result.providerOnlyCount, 1);
    assert.equal(state.getControl().ordersSuspended, true);
  });

  await t.test("missing-upstream", async (t) => {
    const { config } = activeConfig();
    const state = stateFor(t);
    const request = createOrderRequest(config);
    seedSucceededBinding(state, request);
    const provider = mockProvider(config, { listOrders: () => ({ status: 200, body: { orders: [] } }) });
    const result = await reconcileCampaign({ config, state, provider, now: () => 1_700_000_000_000 });
    assert.equal(result.status, "incident");
    assert.equal(result.upstreamMissingCount, 1);
    assert.equal(state.getControl().ordersSuspended, true);
  });
});

test("nightly reconciliation transport/status failure also durably suspends", async (t) => {
  const { config } = activeConfig();
  const state = stateFor(t);
  const provider = mockProvider(config, { listOrders: () => ({ status: 500, body: {} }) });
  await assert.rejects(() => reconcileCampaign({ config, state, provider }), /failed closed/);
  assert.equal(state.getControl().ordersSuspended, true);
  assert.equal(state.getControl().reasonCode, "nightly_reconciliation_failure");
});

test("provider environment URLs and key prefixes are fixed", () => {
  assert.deepEqual(PROVIDER_BASE_URLS, {
    sandbox: "https://testflight.tremendous.com/api/v2",
    production: "https://api.tremendous.com/api/v2",
  });
  assert.deepEqual(PROVIDER_REWARD_HOSTS, {
    sandbox: "testflight.tremendous.com",
    production: "reward.tremendous.com",
  });
  assert.throws(() => activeConfig({ apiKey: "PROD_wrong-environment-key-value" }));
  assert.throws(() => activeConfig({ feeFreeProductIds: [] }));
  assert.throws(() => loadConfig({ TREMENDOUS_MODE: "sandbox", TREMENDOUS_ORDERS_ENABLED: "true" }, { forHashOnly: true }));
});

test("nonsecret config-hash workflow needs and prints no API or HMAC secret", () => {
  const { env, config } = activeConfig();
  delete env.TREMENDOUS_API_KEY;
  delete env.REWARD_RELAY_HMAC_SECRET;
  delete env.TREMENDOUS_CONFIGURATION_HASH;
  const commandEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TREMENDOUS_MODE: env.TREMENDOUS_MODE,
    TREMENDOUS_ORDERS_ENABLED: env.TREMENDOUS_ORDERS_ENABLED,
    TREMENDOUS_EXPECTED_ORG_ID: env.TREMENDOUS_EXPECTED_ORG_ID,
    TREMENDOUS_CAMPAIGN_ID: env.TREMENDOUS_CAMPAIGN_ID,
    TREMENDOUS_APPROVED_COUNTRIES: env.TREMENDOUS_APPROVED_COUNTRIES,
    TREMENDOUS_REVIEWED_PRODUCT_IDS: env.TREMENDOUS_REVIEWED_PRODUCT_IDS,
    TREMENDOUS_FEE_FREE_PRODUCT_IDS: env.TREMENDOUS_FEE_FREE_PRODUCT_IDS,
  };
  const script = fileURLToPath(new URL("../src/config-hash.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], { env: commandEnv, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), config.derivedConfigurationHash);
  assert.match(result.stdout.trim(), /^[0-9a-f]{64}$/);
  assert.equal(result.stdout.includes("ORG1"), false);
  assert.equal(result.stdout.includes("CAMPAIGN1"), false);
});

test("provider client has no arbitrary-origin escape", async () => {
  assert.throws(() => new TremendousApi({
    baseUrl: "https://attacker.example/api/v2",
    apiKey: "TEST_1234567890123456",
  }), /provider_origin_disabled/);
  const requests = [];
  const api = new TremendousApi({
    baseUrl: PROVIDER_BASE_URLS.sandbox,
    apiKey: "TEST_1234567890123456",
    fetcher: async (url) => {
      requests.push(url.toString());
      return new Response(JSON.stringify({ organizations: [] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await api.listOrganizations();
  assert.deepEqual(requests, ["https://testflight.tremendous.com/api/v2/organizations"]);
  assert.equal("request" in api, false);
});

test("provider deadline remains active through a stalled response body and cancels its reader", async () => {
  let cancelCount = 0;
  const reader = {
    read: () => new Promise(() => {}),
    async cancel() {
      cancelCount += 1;
    },
  };
  const api = new TremendousApi({
    baseUrl: PROVIDER_BASE_URLS.sandbox,
    apiKey: "TEST_1234567890123456",
    timeoutMs: 25,
    fetcher: async () => ({
      status: 200,
      headers: { get: () => null },
      body: { getReader: () => reader },
    }),
  });
  await assert.rejects(api.listOrganizations(), (error) => (
    error instanceof ProviderTransportError && error.kind === "timeout"
  ));
  assert.equal(cancelCount, 1);
});

test("canonical JSON uses locale-independent UTF-16 code-unit ordering", () => {
  const value = {
    "\uE000": 7,
    "😀": 6,
    "𐀀": 5,
    "é": 4,
    "e\u0301": 3,
    a: 2,
    A: 1,
  };
  const orderedKeys = ["A", "a", "e\u0301", "é", "𐀀", "😀", "\uE000"];
  const canonical = "{\"A\":1,\"a\":2,\"é\":3,\"é\":4,\"𐀀\":5,\"😀\":6,\"\":7}";
  assert.deepEqual(Object.keys(value).sort(compareCodeUnits), orderedKeys);
  assert.equal(stableJson(value), canonical);
  assert.equal(sha256Hex(Buffer.from(canonical)), "6e51c32e6eb16192c031414ab34558173076bb9e1a1f9ca4598204a2c6001a1d");
});

function activeConfig({ ordersEnabled = true, productIds = ["PRODUCT1"], feeFreeProductIds = productIds, apiKey = "TEST_1234567890123456" } = {}) {
  const env = {
    TREMENDOUS_MODE: "sandbox",
    TREMENDOUS_ORDERS_ENABLED: String(ordersEnabled),
    TREMENDOUS_API_KEY: apiKey,
    TREMENDOUS_EXPECTED_ORG_ID: "ORG1",
    TREMENDOUS_CAMPAIGN_ID: "CAMPAIGN1",
    TREMENDOUS_APPROVED_COUNTRIES: "US",
    TREMENDOUS_REVIEWED_PRODUCT_IDS: productIds.join(","),
    TREMENDOUS_FEE_FREE_PRODUCT_IDS: feeFreeProductIds.join(","),
    REWARD_RELAY_HMAC_SECRET: HMAC_SECRET,
    REWARD_RELAY_DATABASE_PATH: ":memory:",
  };
  const provisional = loadConfig(env, { forHashOnly: true });
  env.TREMENDOUS_CONFIGURATION_HASH = provisional.derivedConfigurationHash;
  return { config: loadConfig(env), env };
}

function stateFor(t) {
  const directory = mkdtempSync(join(tmpdir(), "mochirii-relay-test-"));
  const state = new RelayState(join(directory, "state.sqlite3"));
  t.after(() => {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return state;
}

function reserveBinding(state, request, requestHash, nowMs) {
  const result = state.reserveOrder({
    externalId: request.externalId,
    cycleId: request.cycleId,
    drawResultId: request.drawResultId,
    rewardValueCents: request.denomination * 100,
    maximumCycleCostCents: 5_000,
    requestHash,
    requestJson: JSON.stringify(request),
    environment: request.environment,
    nowMs,
  });
  assert.equal(result.outcome, "created");
  return result.binding;
}

async function nextWorkerMessage(worker) {
  return Promise.race([
    once(worker, "message").then(([message]) => message),
    once(worker, "error").then(([error]) => Promise.reject(error)),
  ]);
}

function readinessRequest(config) {
  return { operation: "readiness", environment: config.mode, configurationHash: config.derivedConfigurationHash };
}

function createOrderRequest(config, overrides = {}) {
  return {
    operation: "create_order",
    environment: config.mode,
    configurationHash: config.derivedConfigurationHash,
    cycleId: CYCLE_ID,
    drawResultId: DRAW_ID,
    externalId: EXTERNAL_ID,
    countryCode: "US",
    campaignId: config.campaignId,
    productIds: ["PRODUCT1"],
    fundingSourceId: "balance",
    denomination: 10,
    currencyCode: "USD",
    deliveryMethod: "LINK",
    ...overrides,
  };
}

async function signedRequest(service, path, body, { secret, nowMs = Date.now(), nonce = `nonce_${Math.random().toString(36).slice(2)}_1234567890` }) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const headers = buildSignatureHeaders({
    secret,
    path,
    body: rawBody,
    timestampSeconds: Math.floor(nowMs / 1_000),
    nonce,
  });
  return service.handle({ method: "POST", path, headers, rawBody });
}

function mockProvider(config, overrides = {}) {
  const calls = [];
  const implementations = {
    listOrganizations: () => ({
      status: 200,
      body: { organizations: [{ id: config.expectedOrganizationId, status: "APPROVED", currency_code: "USD" }] },
    }),
    getCampaign: () => ({
      status: 200,
      body: {
        campaign: {
          id: config.campaignId,
          products: [...config.reviewedProductIds],
          fee_charged_to: "SENDER",
          auto_add_product_rule: null,
        },
      },
    }),
    getBalance: () => ({
      status: 200,
      body: {
        funding_source: {
          id: "BALANCE1",
          method: "balance",
          status: "active",
          usage_permissions: ["api_orders"],
          meta: { available_cents: 10_000, pending_cents: 0, currency_code: "USD" },
        },
      },
    }),
    listProducts: () => ({ status: 200, body: { products: config.reviewedProductIds.map((id) => validProduct(id)) } }),
    listForex: () => ({ status: 200, body: { forex: { USD: 1 } } }),
    createOrder: () => assert.fail("unexpected createOrder"),
    getOrder: () => ({ status: 404, body: {} }),
    getReward: () => ({ status: 404, body: {} }),
    generateLink: () => ({ status: 404, body: {} }),
    listOrders: () => ({ status: 200, body: { orders: [] } }),
    ...overrides,
  };
  const provider = { count: (name) => calls.filter((call) => call.name === name).length, calls };
  for (const [name, implementation] of Object.entries(implementations)) {
    provider[name] = async (...args) => {
      calls.push({ name, args: structuredClone(args) });
      return implementation(...args);
    };
  }
  return provider;
}

function validProduct(id = "PRODUCT1") {
  return {
    id,
    category: "merchant_cards",
    countries: [{ abbr: "US" }],
    currency_codes: ["USD"],
    skus: [{ min: 10, max: 50 }],
  };
}

function okOrder(request, {
  fees = 0,
  subtotal = request.denomination,
  total = request.denomination,
  rewardDenomination = request.denomination,
  orderStatus = "EXECUTED",
  link,
} = {}) {
  return {
    status: 200,
    body: {
      order: {
        id: "ORDER1",
        external_id: request.externalId,
        status: orderStatus,
        payment: { subtotal, total, fees, currency_code: "USD" },
        rewards: [{
          id: "REWARD1",
          campaign_id: request.campaignId,
          products: [...request.productIds],
          value: { denomination: rewardDenomination, currency_code: "USD" },
          delivery: { method: "LINK", status: "SUCCEEDED", ...(link ? { link } : {}) },
        }],
      },
    },
  };
}

async function rawHttpStatus({ port, path, headers, body }) {
  const socket = createConnection({ host: "127.0.0.1", port });
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.on("error", () => {});
  await once(socket, "connect");
  const closed = once(socket, "close");
  const headerLines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  socket.end([
    `POST ${path} HTTP/1.1`,
    "Host: 127.0.0.1",
    "Content-Type: application/json",
    `Content-Length: ${body.byteLength}`,
    "Connection: close",
    ...headerLines,
    "",
    body.toString("utf8"),
  ].join("\r\n"));
  await closed;
  const response = Buffer.concat(chunks).toString("utf8");
  const match = /^HTTP\/1\.1 (\d{3})/.exec(response);
  assert.ok(match, "raw HTTP response must contain a status line");
  return Number(match[1]);
}

function activeReward() {
  return { status: 200, body: { reward: { id: "REWARD1", delivery: { method: "LINK", status: "SUCCEEDED" } } } };
}

function seedSucceededBinding(state, request) {
  const requestJson = JSON.stringify(request);
  state.reserveOrder({
    externalId: request.externalId,
    cycleId: request.cycleId,
    drawResultId: request.drawResultId,
    rewardValueCents: request.denomination * 100,
    maximumCycleCostCents: 5_000,
    requestHash: "a".repeat(64),
    requestJson,
    environment: request.environment,
    nowMs: 1,
  });
  state.completeOrder(request.externalId, {
    orderReference: "ORDER1",
    rewardReference: "REWARD1",
    sanitizedStatus: "executed",
  }, 2);
}
