import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.mjs";
import {
  RELAY_SIGNATURE_HEADERS,
  RELAY_PATHS,
  buildResponseSignatureHeaders,
  buildSignatureHeaders,
  verifySignedResponse,
} from "../src/protocol.mjs";
import { RelayService } from "../src/service.mjs";
import { RelayState } from "../src/state.mjs";
import {
  REWARD_CLAIM_PAGE_PATH,
  REWARD_CLAIM_ROUTE_POLICY,
  REWARD_CLAIM_PATH,
  RewardClaimBoundary,
} from "../contracts/reward-claim-boundary.mjs";
import {
  MemoryRewardHandoffStore,
  REWARD_HANDOFF_COOKIE,
  REWARD_HANDOFF_PATH,
  consumeRewardHandoff,
  createRewardHandoff,
} from "../contracts/reward-handoff.mjs";
import {
  MemoryRewardWebhookEventStore,
  processRewardWebhook,
  signRewardWebhook,
} from "../contracts/reward-webhook.mjs";

const NOW = 1_800_000_000_000;
const MEMBER_ID = "member-verified-1";
const OTHER_MEMBER_ID = "member-verified-2";
const DRAW_RESULT_ID = "12345678-1234-4234-9234-1234567890ab";
const CYCLE_ID = "62345678-1234-4234-9234-1234567890ab";
const IN_GAME_DRAW_RESULT_ID = "72345678-1234-4234-9234-1234567890ab";
const HONOR_DRAW_RESULT_ID = "82345678-1234-4234-9234-1234567890ab";
const REWARD_REFERENCE = "REWARD1";
const REWARD_URL = "https://testflight.tremendous.com/rewards/claim-opaque";
const RELAY_SECRET = "relay-secret-0123456789abcdef0123456789abcdef";
const HANDOFF_KEY = Buffer.alloc(32, 0x51);
const WEBHOOK_SECRET = "webhook-secret-0123456789abcdef0123456789abcdef";

test("mocked browser to opaque handle to final signed relay retrieval and authorized redirect", async (t) => {
  const harness = chainHarness(t);
  const begin = await harness.boundary.beginClaim({
    request: claimRequest(),
    authenticatedMemberId: MEMBER_ID,
    drawResultId: DRAW_RESULT_ID,
  });

  assert.equal(begin.status, 303);
  assert.equal(begin.headers.location, REWARD_HANDOFF_PATH);
  assert.match(begin.headers["set-cookie"], new RegExp(`^${REWARD_HANDOFF_COOKIE}=`));
  assert.match(begin.headers["set-cookie"], /Path=\/api\/raffle\/open-reward/);
  assert.match(begin.headers["set-cookie"], /Max-Age=60/);
  assert.match(begin.headers["set-cookie"], /HttpOnly/);
  assert.match(begin.headers["set-cookie"], /Secure/);
  assert.match(begin.headers["set-cookie"], /SameSite=Strict/);
  assert.equal(begin.headers["cache-control"], "private, no-store");
  assert.equal(begin.headers["referrer-policy"], "no-referrer");
  assert.equal(JSON.stringify(begin).includes(REWARD_URL), false);
  assert.equal(JSON.stringify(begin).includes(RELAY_SECRET), false);
  const browserCookie = cookieHeader(begin.headers["set-cookie"]);
  for (const forbidden of [REWARD_URL, MEMBER_ID, DRAW_RESULT_ID, REWARD_REFERENCE]) {
    assert.equal(browserCookie.includes(forbidden), false);
  }
  const storedHandoffs = JSON.stringify(harness.handoffStore.snapshot());
  assert.equal(storedHandoffs.includes(REWARD_URL), false);
  assert.equal(harness.provider.count("generateLink"), 0, "the link is not retrieved before the final handoff request");

  const opened = await harness.boundary.openReward({
    request: openRequest(begin.headers["set-cookie"]),
    authenticatedMemberId: MEMBER_ID,
  });
  assert.equal(opened.status, 303);
  assert.equal(opened.headers.location, REWARD_URL);
  assert.match(opened.headers["set-cookie"], /Max-Age=0/);
  assert.equal(harness.provider.count("generateLink"), 1);
  assert.equal(harness.handoffStore.count(), 0);
  assert.deepEqual(harness.authorizations.map((authorization) => authorization.phase), ["begin", "open"]);

  const replay = await harness.boundary.openReward({
    request: openRequest(begin.headers["set-cookie"]),
    authenticatedMemberId: MEMBER_ID,
  });
  assert.equal(replay.status, 404);
  assert.deepEqual(replay.body, {});

  const durableState = JSON.stringify(harness.state.listOrderBindings());
  const serializedLogs = JSON.stringify(harness.logs);
  for (const forbidden of [REWARD_URL, RELAY_SECRET, MEMBER_ID, REWARD_REFERENCE]) {
    assert.equal(durableState.includes(forbidden), forbidden === REWARD_REFERENCE);
    assert.equal(serializedLogs.includes(forbidden), false);
  }
  assert.deepEqual(harness.logs, [
    { event: "reward_claim_boundary", phase: "begin", status: 303 },
    { event: "reward_claim_boundary", phase: "open", status: 303 },
    { event: "reward_claim_boundary", phase: "open", status: 404 },
  ]);
});

test("claim-page isolation contract forbids shared caching, analytics, and third-party execution", () => {
  assert.deepEqual(REWARD_CLAIM_ROUTE_POLICY, {
    path: REWARD_CLAIM_PAGE_PATH,
    cacheControl: "private, no-store",
    referrerPolicy: "no-referrer",
    analytics: false,
    thirdPartyScripts: false,
    thirdPartyRequests: false,
  });
  assert.equal(REWARD_CLAIM_PAGE_PATH, "/raffle/claim");
});

test("relay responses are bound to request path, nonce, status, and canonical body", async (t) => {
  const harness = chainHarness(t);
  const body = Buffer.from(JSON.stringify({
    operation: "reward_state",
    environment: "sandbox",
    rewardReference: REWARD_REFERENCE,
  }));
  const nonce = "response_nonce_000000000001";
  const timestamp = Math.floor(NOW / 1_000);
  const headers = buildSignatureHeaders({
    secret: RELAY_SECRET,
    path: RELAY_PATHS.rewardState,
    body,
    nonce,
    timestampSeconds: timestamp,
  });
  const response = await harness.service.handle({ method: "POST", path: RELAY_PATHS.rewardState, headers, rawBody: body });
  assert.equal(verifySignedResponse({
    secret: RELAY_SECRET,
    path: RELAY_PATHS.rewardState,
    status: response.status,
    requestTimestamp: timestamp,
    requestNonce: nonce,
    headers: response.headers,
    body: response.body,
  }), true);
  assert.equal(verifySignedResponse({
    secret: RELAY_SECRET,
    path: RELAY_PATHS.generateLink,
    status: response.status,
    requestTimestamp: timestamp,
    requestNonce: nonce,
    headers: response.headers,
    body: response.body,
  }), false);
  assert.equal(verifySignedResponse({
    secret: RELAY_SECRET,
    path: RELAY_PATHS.rewardState,
    status: response.status + 1,
    requestTimestamp: timestamp,
    requestNonce: nonce,
    headers: response.headers,
    body: response.body,
  }), false);
  assert.equal(verifySignedResponse({
    secret: RELAY_SECRET,
    path: RELAY_PATHS.rewardState,
    status: response.status,
    requestTimestamp: timestamp,
    requestNonce: "response_nonce_000000000002",
    headers: response.headers,
    body: response.body,
  }), false);
  assert.equal(verifySignedResponse({
    secret: RELAY_SECRET,
    path: RELAY_PATHS.rewardState,
    status: response.status,
    requestTimestamp: timestamp,
    requestNonce: nonce,
    headers: response.headers,
    body: { ...response.body, state: "forged" },
  }), false);
});

test("absent, forged, expired, replayed, tampered, and wrong-owner handoff cookies fail closed", async () => {
  const store = new MemoryRewardHandoffStore();
  const valid = await handoff({ store, handleByte: 0x22 });
  const cookie = cookieHeader(valid.setCookie);

  await assert.rejects(() => consumeRewardHandoff(handoffRead({ store, cookieHeader: "" })));
  await assert.rejects(() => consumeRewardHandoff(handoffRead({
    store,
    cookieHeader: `${REWARD_HANDOFF_COOKIE}=v1.forged.forged.forged`,
  })));

  const expiredStore = new MemoryRewardHandoffStore();
  const expired = await createRewardHandoff({
    key: HANDOFF_KEY,
    origin: "https://mochirii.com",
    memberId: MEMBER_ID,
    drawResultId: DRAW_RESULT_ID,
    rewardReference: REWARD_REFERENCE,
    environment: "sandbox",
    storeHandoffHandle: (record) => expiredStore.store(record),
    nowMs: NOW - 61_000,
    randomBytesFn: () => Buffer.alloc(32, 0x32),
  });
  await assert.rejects(() => consumeRewardHandoff(handoffRead({
    store: expiredStore,
    cookieHeader: cookieHeader(expired.setCookie),
  })));

  const token = cookie.split("=")[1];
  const tamperedToken = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  await assert.rejects(() => consumeRewardHandoff(handoffRead({
    store,
    cookieHeader: `${REWARD_HANDOFF_COOKIE}=${tamperedToken}`,
  })));
  await assert.rejects(() => consumeRewardHandoff(handoffRead({
    store,
    cookieHeader: cookie,
    memberId: OTHER_MEMBER_ID,
  })));
  await assert.rejects(() => consumeRewardHandoff(handoffRead({
    store,
    cookieHeader: cookie,
    environment: "production",
  })));
  await assert.rejects(() => consumeRewardHandoff(handoffRead({
    store,
    cookieHeader: cookie,
    origin: "https://other.example",
    host: "other.example",
  })));

  const accepted = await consumeRewardHandoff(handoffRead({ store, cookieHeader: cookie }));
  assert.deepEqual(
    { drawResultId: accepted.drawResultId, rewardReference: accepted.rewardReference, environment: accepted.environment },
    { drawResultId: DRAW_RESULT_ID, rewardReference: REWARD_REFERENCE, environment: "sandbox" },
  );
  assert.equal("rewardUrl" in accepted, false);
  await assert.rejects(() => consumeRewardHandoff(handoffRead({ store, cookieHeader: cookie })));
});

test("a misbound durable handoff adapter cannot substitute another claim record", async () => {
  const store = new MemoryRewardHandoffStore();
  const created = await handoff({ store, handleByte: 0x24 });
  const [stored] = store.snapshot();
  const cookie = cookieHeader(created.setCookie);

  await assert.rejects(() => consumeRewardHandoff(handoffRead({
    store,
    cookieHeader: cookie,
    consumeHandoffHandle: async () => ({ ...stored, handleDigest: "0".repeat(64) }),
  })));

  const accepted = await consumeRewardHandoff(handoffRead({ store, cookieHeader: cookie }));
  assert.equal(accepted.drawResultId, DRAW_RESULT_ID);
});

test("an unrelated server-readable session cookie does not crowd out the bounded handoff token", async () => {
  const store = new MemoryRewardHandoffStore();
  const created = await handoff({ store, handleByte: 0x25 });
  const cookie = `${REWARD_HANDOFF_COOKIE}_session=${"x".repeat(8_192)}; ${cookieHeader(created.setCookie)}`;
  const accepted = await consumeRewardHandoff(handoffRead({ store, cookieHeader: cookie }));
  assert.equal(accepted.drawResultId, DRAW_RESULT_ID);
});

test("hostile origin, host, path, and cross-site request metadata never reach the relay", async (t) => {
  const harness = chainHarness(t);
  for (const request of [
    claimRequest({ origin: "https://evil.example" }),
    claimRequest({ host: "evil.example" }),
    claimRequest({ path: `${REWARD_CLAIM_PATH}/extra` }),
    claimRequest({ fetchSite: "cross-site" }),
  ]) {
    const result = await harness.boundary.beginClaim({ request, authenticatedMemberId: MEMBER_ID, drawResultId: DRAW_RESULT_ID });
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, {});
  }
  assert.equal(harness.provider.calls.length, 0);

  const hostileStore = new MemoryRewardHandoffStore();
  const created = await handoff({ store: hostileStore, handleByte: 0x42 });
  for (const request of [
    openRequest(created.setCookie, { host: "evil.example" }),
    openRequest(created.setCookie, { path: `${REWARD_HANDOFF_PATH}/extra` }),
    openRequest(created.setCookie, { fetchSite: "cross-site" }),
  ]) {
    const result = await harness.boundary.openReward({ request, authenticatedMemberId: MEMBER_ID });
    assert.equal(result.status, 404);
    assert.equal("location" in result.headers, false);
  }
});

test("ownership mismatch and provider failures return opaque responses without a handoff", async (t) => {
  const ownership = chainHarness(t);
  const wrongOwner = await ownership.boundary.beginClaim({
    request: claimRequest(),
    authenticatedMemberId: OTHER_MEMBER_ID,
    drawResultId: DRAW_RESULT_ID,
  });
  assert.equal(wrongOwner.status, 404);
  assert.equal("set-cookie" in wrongOwner.headers, false);
  assert.equal(ownership.provider.calls.length, 0);

  const unavailable = chainHarness(t, {
    providerOverrides: { getReward: () => ({ status: 503, body: {} }) },
  });
  const pending = await unavailable.boundary.beginClaim({
    request: claimRequest(),
    authenticatedMemberId: MEMBER_ID,
    drawResultId: DRAW_RESULT_ID,
  });
  assert.equal(pending.status, 303);
  const failed = await unavailable.boundary.openReward({
    request: openRequest(pending.headers["set-cookie"]),
    authenticatedMemberId: MEMBER_ID,
  });
  assert.equal(failed.status, 503);
  assert.deepEqual(failed.body, { error: "reward_unavailable" });
  assert.match(failed.headers["set-cookie"], /Max-Age=0/);
  assert.equal("location" in failed.headers, false);
  assert.equal(JSON.stringify(failed).includes(REWARD_URL), false);
});

test("the claim boundary defaults closed and never reaches any reward path", async () => {
  let relayCalls = 0;
  const boundary = new RewardClaimBoundary({
    relay: { handle: async () => { relayCalls += 1; return { status: 503, body: {}, headers: {} }; } },
    relaySecret: RELAY_SECRET,
    relayEnvironment: "sandbox",
    handoffKey: HANDOFF_KEY,
    ...handoffCallbacks(),
    now: () => NOW,
    nonce: () => "disabled_claim_nonce_000001",
  });
  const result = await boundary.beginClaim({
    request: claimRequest(),
    authenticatedMemberId: MEMBER_ID,
    drawResultId: DRAW_RESULT_ID,
  });
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: "reward_unavailable" });
  assert.equal(relayCalls, 0);
});

test("forged relay response authentication is rejected before the final redirect", async () => {
  const logs = [];
  const handoffs = new MemoryRewardHandoffStore();
  const boundary = new RewardClaimBoundary({
    relay: {
      handle: async () => ({ status: 200, body: { url: REWARD_URL }, headers: {} }),
    },
    relaySecret: RELAY_SECRET,
    relayEnvironment: "sandbox",
    handoffKey: HANDOFF_KEY,
    ...handoffCallbacks(handoffs),
    claimsEnabled: true,
    authorizeClaim: async () => claimAuthorization(),
    now: () => NOW,
    nonce: () => "forged_response_nonce_000001",
    logger: (entry) => logs.push(entry),
  });
  const begin = await boundary.beginClaim({ request: claimRequest(), authenticatedMemberId: MEMBER_ID, drawResultId: DRAW_RESULT_ID });
  assert.equal(begin.status, 303);
  const result = await boundary.openReward({
    request: openRequest(begin.headers["set-cookie"]),
    authenticatedMemberId: MEMBER_ID,
  });
  assert.equal(result.status, 503);
  assert.equal("location" in result.headers, false);
  assert.equal(JSON.stringify(begin).includes(REWARD_URL), false);
  assert.deepEqual(logs, [
    { event: "reward_claim_boundary", phase: "begin", status: 303 },
    { event: "reward_claim_boundary", phase: "open", status: 503 },
  ]);
});

test("a signed relay response still cannot hand off an arbitrary HTTPS link", async () => {
  const handoffs = new MemoryRewardHandoffStore();
  const relay = {
    handle: async ({ path, headers }) => {
      const status = 200;
      const body = { url: "https://attacker.example/rewards/forged" };
      return {
        status,
        body,
        headers: buildResponseSignatureHeaders({
          secret: RELAY_SECRET,
          path,
          status,
          requestTimestamp: headers[RELAY_SIGNATURE_HEADERS.timestamp],
          requestNonce: headers[RELAY_SIGNATURE_HEADERS.nonce],
          body,
        }),
      };
    },
  };
  const boundary = new RewardClaimBoundary({
    relay,
    relaySecret: RELAY_SECRET,
    relayEnvironment: "sandbox",
    handoffKey: HANDOFF_KEY,
    ...handoffCallbacks(handoffs),
    claimsEnabled: true,
    authorizeClaim: async () => claimAuthorization(),
    now: () => NOW,
    nonce: () => "signed_attacker_link_nonce_01",
  });

  const begin = await boundary.beginClaim({
    request: claimRequest(),
    authenticatedMemberId: MEMBER_ID,
    drawResultId: DRAW_RESULT_ID,
  });
  assert.equal(begin.status, 303);
  const result = await boundary.openReward({
    request: openRequest(begin.headers["set-cookie"]),
    authenticatedMemberId: MEMBER_ID,
  });
  assert.equal(result.status, 503);
  assert.match(result.headers["set-cookie"], /Max-Age=0/);
  assert.equal("location" in result.headers, false);
  assert.equal(JSON.stringify(result).includes("attacker.example"), false);

  const replay = await boundary.openReward({
    request: openRequest(begin.headers["set-cookie"]),
    authenticatedMemberId: MEMBER_ID,
  });
  assert.equal(replay.status, 404);
  assert.equal("location" in replay.headers, false);
});

test("electronic, in-game, and community-honor paths remain distinct", async () => {
  let relayCalls = 0;
  const nonElectronic = [];
  const boundary = new RewardClaimBoundary({
    relay: { handle: async () => { relayCalls += 1; return { status: 503, body: {}, headers: {} }; } },
    relaySecret: RELAY_SECRET,
    relayEnvironment: "sandbox",
    handoffKey: HANDOFF_KEY,
    ...handoffCallbacks(),
    claimsEnabled: true,
    authorizeClaim: async ({ authenticatedMemberId, drawResultId }) => {
      if (authenticatedMemberId !== MEMBER_ID) return null;
      if (drawResultId === IN_GAME_DRAW_RESULT_ID) return claimAuthorization({ drawResultId, rewardKind: "in_game" });
      if (drawResultId === HONOR_DRAW_RESULT_ID) return claimAuthorization({ drawResultId, rewardKind: "community_honor" });
      if (drawResultId === DRAW_RESULT_ID) return claimAuthorization();
      return null;
    },
    recordInGameClaim: async (claim) => { nonElectronic.push(claim); return true; },
    recordCommunityHonor: async (claim) => { nonElectronic.push(claim); return true; },
    now: () => NOW,
    nonce: () => "reward_kind_nonce_00000001",
  });
  const inGame = await boundary.beginClaim({
    request: claimRequest(),
    authenticatedMemberId: MEMBER_ID,
    drawResultId: IN_GAME_DRAW_RESULT_ID,
  });
  const honor = await boundary.beginClaim({
    request: claimRequest(),
    authenticatedMemberId: MEMBER_ID,
    drawResultId: HONOR_DRAW_RESULT_ID,
  });
  const electronic = await boundary.beginClaim({
    request: claimRequest(),
    authenticatedMemberId: MEMBER_ID,
    drawResultId: DRAW_RESULT_ID,
  });
  assert.deepEqual(inGame.body, { outcome: "in_game_claim_recorded" });
  assert.deepEqual(honor.body, { outcome: "community_honor_confirmed" });
  assert.equal(inGame.status, 202);
  assert.equal(honor.status, 202);
  assert.equal(electronic.status, 303);
  assert.equal(relayCalls, 0);
  assert.deepEqual(nonElectronic.map((claim) => claim.rewardKind), ["in_game", "community_honor"]);
  assert.equal("set-cookie" in inGame.headers, false);
  assert.equal("set-cookie" in honor.headers, false);
});

test("caller-supplied winner data cannot authorize or select a reward path", async () => {
  let relayCalls = 0;
  let honorCalls = 0;
  const boundary = new RewardClaimBoundary({
    relay: { handle: async () => { relayCalls += 1; return { status: 503, body: {}, headers: {} }; } },
    relaySecret: RELAY_SECRET,
    relayEnvironment: "sandbox",
    handoffKey: HANDOFF_KEY,
    ...handoffCallbacks(),
    claimsEnabled: true,
    authorizeClaim: async () => null,
    recordCommunityHonor: async () => { honorCalls += 1; return true; },
    now: () => NOW,
  });
  const result = await boundary.beginClaim({
    request: claimRequest(),
    authenticatedMemberId: MEMBER_ID,
    drawResultId: DRAW_RESULT_ID,
    winner: {
      drawResultId: DRAW_RESULT_ID,
      memberId: MEMBER_ID,
      rewardKind: "community_honor",
      rewardReference: REWARD_REFERENCE,
    },
  });
  assert.equal(result.status, 404);
  assert.equal(relayCalls, 0);
  assert.equal(honorCalls, 0);
});

test("claim authorization rejects inactive, stale, non-owner, and mismatched server state", async (t) => {
  const cases = [
    ["inactive member", { membershipState: "inactive" }],
    ["wrong owner", { ownershipState: "not_winner" }],
    ["closed deadline", { deadlineState: "closed" }],
    ["invalid claim state", { authorizationState: "pending" }],
    ["mismatched member", { memberId: OTHER_MEMBER_ID }],
    ["mismatched draw", { drawResultId: IN_GAME_DRAW_RESULT_ID }],
  ];
  for (const [name, override] of cases) {
    await t.test(name, async (t) => {
      const harness = chainHarness(t, {
        authorizationHandler: async () => claimAuthorization(override),
      });
      const result = await harness.boundary.beginClaim({
        request: claimRequest(),
        authenticatedMemberId: MEMBER_ID,
        drawResultId: DRAW_RESULT_ID,
      });
      assert.equal(result.status, 404);
      assert.equal(harness.provider.calls.length, 0);
    });
  }
});

test("handoff redirect requires a fresh server authorization after cookie consumption", async (t) => {
  const harness = chainHarness(t, {
    authorizationHandler: async (authorization) => (
      authorization.phase === "begin" ? claimAuthorization() : null
    ),
  });
  const begin = await harness.boundary.beginClaim({
    request: claimRequest(),
    authenticatedMemberId: MEMBER_ID,
    drawResultId: DRAW_RESULT_ID,
  });
  assert.equal(begin.status, 303);
  const opened = await harness.boundary.openReward({
    request: openRequest(begin.headers["set-cookie"]),
    authenticatedMemberId: MEMBER_ID,
  });
  assert.equal(opened.status, 404);
  assert.equal("location" in opened.headers, false);
  assert.match(opened.headers["set-cookie"], /Max-Age=0/);
});

test("raw-body webhook HMAC and event UUID dedupe retain metadata only", () => {
  const store = new MemoryRewardWebhookEventStore();
  const rawBody = Buffer.from(JSON.stringify({
    uuid: "52345678-1234-4234-9234-1234567890ab",
    event: "REWARDS.FLAGGED",
    created_utc: "2027-01-15T09:00:00.000Z",
    payload: {
      resource: {
        id: REWARD_REFERENCE,
        type: "reward",
        recipient: { email: "private@example.invalid" },
        link: REWARD_URL,
      },
      provider_secret: "must-not-survive",
    },
  }));
  const signature = signRewardWebhook(rawBody, WEBHOOK_SECRET);
  assert.equal(processRewardWebhook({
    rawBody,
    signature: "",
    secret: WEBHOOK_SECRET,
    environment: "production",
    eventStore: store,
  }).status, 401);
  assert.equal(processRewardWebhook({
    rawBody,
    signature: `sha256=${"0".repeat(64)}`,
    secret: WEBHOOK_SECRET,
    environment: "production",
    eventStore: store,
  }).status, 401);
  assert.equal(processRewardWebhook({
    rawBody: Buffer.alloc(65_537),
    signature: `sha256=${"0".repeat(64)}`,
    secret: WEBHOOK_SECRET,
    environment: "production",
    eventStore: store,
  }).status, 413);
  assert.equal(store.count(), 0);
  const accepted = processRewardWebhook({ rawBody, signature, secret: WEBHOOK_SECRET, environment: "production", eventStore: store });
  assert.equal(accepted.status, 200);
  assert.equal(store.count(), 1);
  const duplicate = processRewardWebhook({ rawBody, signature, secret: WEBHOOK_SECRET, environment: "production", eventStore: store });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.status, "duplicate");

  const rewritten = Buffer.from(`${rawBody.toString("utf8")} `);
  const bodySubstitution = processRewardWebhook({
    rawBody: rewritten,
    signature,
    secret: WEBHOOK_SECRET,
    environment: "production",
    eventStore: store,
  });
  assert.equal(bodySubstitution.status, 401);

  const conflictBody = Buffer.from(JSON.stringify({
    uuid: "52345678-1234-4234-9234-1234567890ab",
    event: "REWARDS.CANCELED",
    created_utc: "2027-01-15T09:00:00.000Z",
    payload: { resource: { id: REWARD_REFERENCE, type: "reward" } },
  }));
  const conflict = processRewardWebhook({
    rawBody: conflictBody,
    signature: signRewardWebhook(conflictBody, WEBHOOK_SECRET),
    secret: WEBHOOK_SECRET,
    environment: "production",
    eventStore: store,
  });
  assert.equal(conflict.status, 409);
  assert.equal(store.count(), 1);

  const snapshot = JSON.stringify(store.snapshot());
  for (const forbidden of ["private@example.invalid", REWARD_URL, "must-not-survive", WEBHOOK_SECRET]) {
    assert.equal(snapshot.includes(forbidden), false);
  }
  assert.match(snapshot, /"bodyHash":"[0-9a-f]{64}"/);
});

function chainHarness(t, { providerOverrides = {}, authorizationHandler } = {}) {
  const config = activeConfig();
  const directory = mkdtempSync(join(tmpdir(), "mochirii-reward-chain-"));
  const state = new RelayState(join(directory, "relay.sqlite3"));
  const request = {
    operation: "create_order",
    environment: "sandbox",
    configurationHash: config.derivedConfigurationHash,
    cycleId: CYCLE_ID,
    drawResultId: DRAW_RESULT_ID,
    externalId: `mochirii-mpd-${DRAW_RESULT_ID}-v1`,
    countryCode: "US",
    campaignId: config.campaignId,
    productIds: ["PRODUCT1"],
    fundingSourceId: "balance",
    denomination: 10,
    currencyCode: "USD",
    deliveryMethod: "LINK",
  };
  state.reserveOrder({
    externalId: request.externalId,
    cycleId: request.cycleId,
    drawResultId: request.drawResultId,
    rewardValueCents: request.denomination * 100,
    maximumCycleCostCents: config.maximumCycleCostCents,
    requestHash: "a".repeat(64),
    requestJson: JSON.stringify(request),
    environment: request.environment,
    nowMs: NOW - 10_000,
  });
  state.completeOrder(request.externalId, {
    orderReference: "ORDER1",
    rewardReference: REWARD_REFERENCE,
    sanitizedStatus: "executed",
  }, NOW - 9_000);
  const provider = mockProvider(providerOverrides);
  const service = new RelayService({ config, state, provider, now: () => NOW });
  const handoffStore = new MemoryRewardHandoffStore();
  const authorizations = [];
  const logs = [];
  const boundary = new RewardClaimBoundary({
    relay: service,
    relaySecret: RELAY_SECRET,
    relayEnvironment: "sandbox",
    handoffKey: HANDOFF_KEY,
    ...handoffCallbacks(handoffStore),
    claimsEnabled: true,
    authorizeClaim: async (authorization) => {
      authorizations.push(authorization);
      if (authorizationHandler) return authorizationHandler(authorization);
      if (authorization.authenticatedMemberId !== MEMBER_ID || authorization.drawResultId !== DRAW_RESULT_ID) return null;
      if (authorization.phase === "open" && authorization.rewardReference !== REWARD_REFERENCE) return null;
      return claimAuthorization();
    },
    recordInGameClaim: async () => true,
    recordCommunityHonor: async () => true,
    now: () => NOW,
    nonce: () => "boundary_nonce_000000000001",
    logger: (entry) => logs.push(entry),
  });
  t.after(() => {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { authorizations, boundary, config, handoffStore, logs, provider, service, state };
}

function activeConfig() {
  const env = {
    TREMENDOUS_MODE: "sandbox",
    TREMENDOUS_ORDERS_ENABLED: "false",
    TREMENDOUS_API_KEY: "TEST_1234567890123456",
    TREMENDOUS_EXPECTED_ORG_ID: "ORG1",
    TREMENDOUS_CAMPAIGN_ID: "CAMPAIGN1",
    TREMENDOUS_APPROVED_COUNTRIES: "US",
    TREMENDOUS_REVIEWED_PRODUCT_IDS: "PRODUCT1",
    TREMENDOUS_FEE_FREE_PRODUCT_IDS: "PRODUCT1",
    REWARD_RELAY_HMAC_SECRET: RELAY_SECRET,
    REWARD_RELAY_DATABASE_PATH: ":memory:",
  };
  const provisional = loadConfig(env, { forHashOnly: true });
  env.TREMENDOUS_CONFIGURATION_HASH = provisional.derivedConfigurationHash;
  return loadConfig(env);
}

function mockProvider(overrides = {}) {
  const calls = [];
  const methods = {
    getReward: () => ({
      status: 200,
      body: { reward: { id: REWARD_REFERENCE, status: "ACTIVE", delivery: { method: "LINK", status: "SUCCEEDED" } } },
    }),
    generateLink: () => ({ status: 200, body: { reward: { id: REWARD_REFERENCE, link: REWARD_URL } } }),
    ...overrides,
  };
  const provider = { calls, count: (name) => calls.filter((entry) => entry === name).length };
  for (const [name, implementation] of Object.entries(methods)) {
    provider[name] = async (...args) => {
      calls.push(name);
      return implementation(...args);
    };
  }
  return provider;
}

function claimAuthorization(overrides = {}) {
  return {
    authorizationState: "authorized",
    deadlineState: "open",
    drawResultId: DRAW_RESULT_ID,
    memberId: MEMBER_ID,
    membershipState: "active",
    ownershipState: "winner",
    rewardKind: "electronic",
    rewardReference: REWARD_REFERENCE,
    ...overrides,
  };
}

function claimRequest(overrides = {}) {
  return {
    method: "POST",
    origin: "https://mochirii.com",
    host: "mochirii.com",
    path: REWARD_CLAIM_PATH,
    fetchSite: "same-origin",
    ...overrides,
  };
}

function openRequest(setCookie, overrides = {}) {
  return {
    method: "GET",
    host: "mochirii.com",
    path: REWARD_HANDOFF_PATH,
    fetchSite: "same-origin",
    cookie: cookieHeader(setCookie),
    ...overrides,
  };
}

function handoff({ store, handleByte }) {
  return createRewardHandoff({
    key: HANDOFF_KEY,
    origin: "https://mochirii.com",
    memberId: MEMBER_ID,
    drawResultId: DRAW_RESULT_ID,
    rewardReference: REWARD_REFERENCE,
    environment: "sandbox",
    storeHandoffHandle: (record) => store.store(record),
    nowMs: NOW,
    randomBytesFn: () => Buffer.alloc(32, handleByte),
  });
}

function handoffRead({ store, ...overrides } = {}) {
  return {
    cookieHeader: "",
    key: HANDOFF_KEY,
    origin: "https://mochirii.com",
    host: "mochirii.com",
    path: REWARD_HANDOFF_PATH,
    memberId: MEMBER_ID,
    environment: "sandbox",
    consumeHandoffHandle: (request) => store.consume(request),
    nowMs: NOW,
    ...overrides,
  };
}

function handoffCallbacks(store = new MemoryRewardHandoffStore()) {
  return {
    storeHandoffHandle: (record) => store.store(record),
    consumeHandoffHandle: (request) => store.consume(request),
  };
}

function cookieHeader(setCookie) {
  return String(setCookie || "").split(";")[0];
}
