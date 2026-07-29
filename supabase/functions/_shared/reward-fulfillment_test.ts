import {
  canTransitionFulfillment,
  checkRelayReadiness,
  evaluateLinkThrottle,
  executeFulfillmentOrder,
  makeFulfillmentExternalId,
  retryDelayMs,
} from "./reward-fulfillment.ts";
import {
  type FulfillmentJobRow,
  fulfillmentRequestHash,
  prepareFulfillment,
  type ProviderConfigRow,
} from "./raffle-fulfillment-worker.ts";
import {
  MockRelayTransport,
  type RelayTransportResponse,
} from "./reward-relay-client.ts";
import { InMemoryRewardRelay } from "./reward-mock-relay.ts";
import type { RelayCreateOrderRequest } from "./reward-relay-contract.ts";

const drawResultId = "12345678-1234-4234-9234-1234567890ab";
const cycleId = "87654321-4321-4321-8321-ba0987654321";

Deno.test("external IDs are immutable and state transitions fail closed", () => {
  assertEquals(
    makeFulfillmentExternalId(drawResultId),
    `mochirii-mpd-${drawResultId}-v1`,
  );
  assertThrows(() => makeFulfillmentExternalId("not-a-uuid"));
  assert(
    canTransitionFulfillment("claimed", "submitting"),
    "claimed job should submit",
  );
  assert(
    canTransitionFulfillment("submitting", "reconciling"),
    "uncertain job should reconcile",
  );
  assert(
    !canTransitionFulfillment("succeeded", "claimed"),
    "success must be terminal",
  );
  assert(
    !canTransitionFulfillment("failed", "submitting"),
    "failed job must not resubmit",
  );
});

Deno.test("link generation enforces a 15-minute cooldown and a bounded count", () => {
  const now = Date.parse("2026-07-19T00:30:00.000Z");
  assertEquals(
    evaluateLinkThrottle({
      nowMs: now,
      generationCount: 0,
      lastGeneratedAt: null,
    }),
    { allowed: true },
  );
  assertEquals(
    evaluateLinkThrottle({
      nowMs: now,
      generationCount: 1,
      lastGeneratedAt: "2026-07-19T00:20:00.000Z",
    }),
    { allowed: false, reason: "cooldown", retryAfterMs: 300_000 },
  );
  assertEquals(
    evaluateLinkThrottle({
      nowMs: now,
      generationCount: 5,
      lastGeneratedAt: null,
    }),
    {
      allowed: false,
      reason: "generation_limit",
    },
  );
  assertEquals(
    evaluateLinkThrottle({
      nowMs: now,
      generationCount: 9,
      generationLimit: 10,
      lastGeneratedAt: null,
    }),
    {
      allowed: true,
    },
  );
});

Deno.test("200 creates and 201 reconciles an identical external ID", async () => {
  const created = await executeFulfillmentOrder({
    transport: new MockRelayTransport([response(200, orderBody("created"))]),
    request: orderRequest(),
    attempt: 0,
  });
  assertEquals(created, {
    kind: "success",
    outcome: "created",
    orderReference: "order-1",
    rewardReference: "reward-1",
    sanitizedStatus: "succeeded",
  });
  const existing = await executeFulfillmentOrder({
    transport: new MockRelayTransport([response(201, orderBody("existing"))]),
    request: orderRequest(),
    attempt: 0,
  });
  assertEquals(existing, {
    kind: "success",
    outcome: "existing",
    orderReference: "order-1",
    rewardReference: "reward-1",
    sanitizedStatus: "succeeded",
  });
});

Deno.test("stateful mock relay enforces identical-payload idempotency and conflicts", async () => {
  const relay = new InMemoryRewardRelay({
    environment: "sandbox",
    configurationHash: "a".repeat(64),
    campaignId: "campaign-1",
    productIds: ["product-1", "product-2"],
    countryCodes: ["US"],
  });
  const request = orderRequest();
  assertEquals(
    (await relay.request(
      "/v1/orders",
      request as unknown as Record<string, unknown>,
    )).status,
    200,
  );
  assertEquals(
    (await relay.request(
      "/v1/orders",
      request as unknown as Record<string, unknown>,
    )).status,
    201,
  );
  assertEquals(
    (await relay.request("/v1/orders", {
      ...request,
      productIds: ["product-2"],
    } as unknown as Record<string, unknown>)).status,
    409,
  );
});

Deno.test("400, 401, 402, 409, and 422 use distinct fail-closed outcomes", async () => {
  const expected = new Map<number, unknown>([
    [400, { kind: "terminal", errorCode: "provider_configuration_invalid" }],
    [401, { kind: "pause", errorCode: "provider_authentication_failed" }],
    [402, { kind: "pause", errorCode: "provider_funding_stopped" }],
    [409, { kind: "integrity", errorCode: "external_id_conflict" }],
    [422, { kind: "terminal", errorCode: "provider_configuration_invalid" }],
  ]);
  for (const [status, outcome] of expected) {
    assertEquals(
      await executeFulfillmentOrder({
        transport: new MockRelayTransport([
          response(status, { ignored: "not retained" }),
        ]),
        request: orderRequest(),
        attempt: 0,
      }),
      outcome,
    );
  }
});

Deno.test("429 waits at least one second and uses bounded backoff", async () => {
  const outcome = await executeFulfillmentOrder({
    transport: new MockRelayTransport([response(429, {}, 250)]),
    request: orderRequest(),
    attempt: 2,
    random: () => 0,
  });
  assertEquals(outcome, {
    kind: "retry",
    errorCode: "provider_rate_limited",
    retryAfterMs: 1_000,
    mustReconcile: false,
  });
  assertEquals(retryDelayMs(2, () => 0), 4_000);
  assertEquals(retryDelayMs(99, () => 1), 75_000);
});

Deno.test("500, 502, and timeouts reconcile by the same external ID before retry", async () => {
  for (
    const initial of [
      response(500, {}),
      response(502, {}),
      new Error("timeout"),
    ]
  ) {
    const transport = new MockRelayTransport([
      initial,
      response(200, orderBody("found")),
    ]);
    const outcome = await executeFulfillmentOrder({
      transport,
      request: orderRequest(),
      attempt: 1,
      random: () => 0,
    });
    assertEquals(outcome, {
      kind: "success",
      outcome: "reconciled",
      orderReference: "order-1",
      rewardReference: "reward-1",
      sanitizedStatus: "succeeded",
    });
    assertEquals(transport.requests.length, 2);
    assertEquals(
      transport.requests[0].body.externalId,
      transport.requests[1].body.externalId,
    );
  }
});

Deno.test("uncertain lookup failure preserves reconciliation requirement and external ID", async () => {
  const transport = new MockRelayTransport([
    response(503, {}),
    response(404, {}),
  ]);
  const outcome = await executeFulfillmentOrder({
    transport,
    request: orderRequest(),
    attempt: 1,
    random: () => 0,
  });
  assertEquals(outcome, {
    kind: "retry",
    errorCode: "provider_503",
    retryAfterMs: 2_000,
    mustReconcile: true,
  });
  assertEquals(
    transport.requests[1].body.externalId,
    orderRequest().externalId,
  );
});

Deno.test("reconciling jobs look up before retrying the identical create request", async () => {
  const foundTransport = new MockRelayTransport([
    response(200, orderBody("found")),
  ]);
  const found = await executeFulfillmentOrder({
    transport: foundTransport,
    request: orderRequest(),
    attempt: 2,
    reconcileFirst: true,
  });
  assertEquals(found.kind, "success");
  assertEquals(foundTransport.requests.map((request) => request.path), [
    "/v1/orders/by-external-id",
  ]);

  const absentTransport = new MockRelayTransport([
    response(404, {}),
    response(200, orderBody("created")),
  ]);
  const created = await executeFulfillmentOrder({
    transport: absentTransport,
    request: orderRequest(),
    attempt: 2,
    reconcileFirst: true,
  });
  assertEquals(created.kind, "success");
  assertEquals(absentTransport.requests.map((request) => request.path), [
    "/v1/orders/by-external-id",
    "/v1/orders",
  ]);
  assertEquals(
    absentTransport.requests[0].body.externalId,
    absentTransport.requests[1].body.externalId,
  );
});

Deno.test("raw responses and reward links cannot enter fulfillment results", async () => {
  const outcome = await executeFulfillmentOrder({
    transport: new MockRelayTransport([response(200, {
      ...orderBody("created"),
      url: "https://private.example/reward-link",
    })]),
    request: orderRequest(),
    attempt: 0,
  });
  assertEquals(outcome, {
    kind: "integrity",
    errorCode: "invalid_order_response",
  });
  assert(
    !JSON.stringify(outcome).includes("private.example"),
    "raw link must not survive normalization",
  );
});

Deno.test("readiness requires exact environment, controls, settled funds, and the balance ceiling", async () => {
  const ready = await checkRelayReadiness({
    transport: new MockRelayTransport([response(200, readinessBody())]),
    environment: "sandbox",
    configurationHash: "a".repeat(64),
    requiredAvailableBalanceCents: 6_000,
    maximumTotalBalanceCents: 10_000,
  });
  assertEquals(ready, { ready: true, availableBalanceCents: 10_000 });

  const pendingOnly = await checkRelayReadiness({
    transport: new MockRelayTransport([
      response(
        200,
        readinessBody({
          availableBalanceCents: 5_000,
          pendingBalanceCents: 0,
        }),
      ),
    ]),
    environment: "sandbox",
    configurationHash: "a".repeat(64),
    requiredAvailableBalanceCents: 6_000,
    maximumTotalBalanceCents: 10_000,
  });
  assertEquals(pendingOnly, {
    ready: false,
    errorCode: "insufficient_settled_funds",
    pause: true,
  });

  const wrongEnvironment = await checkRelayReadiness({
    transport: new MockRelayTransport([
      response(200, readinessBody({ environment: "production" })),
    ]),
    environment: "sandbox",
    configurationHash: "a".repeat(64),
    requiredAvailableBalanceCents: 6_000,
    maximumTotalBalanceCents: 10_000,
  });
  assertEquals(wrongEnvironment, {
    ready: false,
    errorCode: "provider_not_ready",
    pause: true,
  });

  const overCeiling = await checkRelayReadiness({
    transport: new MockRelayTransport([
      response(
        200,
        readinessBody({
          availableBalanceCents: 9_500,
          pendingBalanceCents: 600,
        }),
      ),
    ]),
    environment: "sandbox",
    configurationHash: "a".repeat(64),
    requiredAvailableBalanceCents: 6_000,
    maximumTotalBalanceCents: 10_000,
  });
  assertEquals(overCeiling, {
    ready: false,
    errorCode: "balance_ceiling_exceeded",
    pause: true,
  });
});

Deno.test("job preparation enforces reviewed country/product/configuration and exact ceilings", async () => {
  const prepared = prepareFulfillment({
    job: jobRow(),
    config: configRow(),
    authorizedOutstandingCents: 1_000,
  });
  assertEquals(prepared.requiredAvailableBalanceCents, 6_000);
  assertEquals(prepared.maximumTotalBalanceCents, 10_000);
  assertEquals(prepared.request.cycleId, cycleId);
  assertEquals(prepared.request.productIds, ["product-1"]);
  assertEquals(prepared.request.deliveryMethod, "LINK");
  assertEquals(prepared.request.fundingSourceId, "balance");
  assertEquals(
    await fulfillmentRequestHash(prepared.request),
    await fulfillmentRequestHash(structuredClone(prepared.request)),
  );

  assertThrows(() =>
    prepareFulfillment({
      job: { ...jobRow(), country_code: "CA" },
      config: configRow(),
      authorizedOutstandingCents: 1_000,
    })
  );

  for (const rewardValueCents of [1_000, 2_500, 5_000]) {
    const variable = prepareFulfillment({
      job: { ...jobRow(), reward_value_cents: rewardValueCents },
      config: configRow(),
      authorizedOutstandingCents: rewardValueCents,
    });
    assertEquals(variable.request.denomination, rewardValueCents / 100);
    assertEquals(
      variable.requiredAvailableBalanceCents,
      rewardValueCents + 5_000,
    );
  }
  for (const rewardValueCents of [900, 1_050, 5_100]) {
    assertThrows(() =>
      prepareFulfillment({
        job: { ...jobRow(), reward_value_cents: rewardValueCents },
        config: configRow(),
        authorizedOutstandingCents: Math.max(0, rewardValueCents),
      })
    );
  }
  assertThrows(() =>
    prepareFulfillment({
      job: { ...jobRow(), product_ids: ["unreviewed-product"] },
      config: configRow(),
      authorizedOutstandingCents: 1_000,
    })
  );
  assertThrows(() =>
    prepareFulfillment({
      job: jobRow(),
      config: { ...configRow(), orders_enabled: false },
      authorizedOutstandingCents: 1_000,
    })
  );
  assertThrows(() =>
    prepareFulfillment({
      job: { ...jobRow(), provider_configuration_hash: "b".repeat(64) },
      config: configRow(),
      authorizedOutstandingCents: 1_000,
    })
  );
  assertThrows(() =>
    prepareFulfillment({
      job: { ...jobRow(), campaign_id: "campaign-previous" },
      config: configRow(),
      authorizedOutstandingCents: 1_000,
    })
  );
  assertThrows(() =>
    prepareFulfillment({
      job: { ...jobRow(), cycle_id: "not-a-cycle" },
      config: configRow(),
      authorizedOutstandingCents: 1_000,
    })
  );
});

function response(
  status: number,
  body: unknown,
  retryAfterMs: number | null = null,
): RelayTransportResponse {
  return { status, body, retryAfterMs };
}

function orderBody(outcome: "created" | "existing" | "found") {
  return {
    outcome,
    orderReference: "order-1",
    rewardReference: "reward-1",
    sanitizedStatus: "succeeded",
  };
}

function orderRequest(): RelayCreateOrderRequest {
  return {
    operation: "create_order",
    environment: "sandbox",
    configurationHash: "a".repeat(64),
    cycleId,
    drawResultId,
    externalId: `mochirii-mpd-${drawResultId}-v1`,
    countryCode: "US",
    campaignId: "campaign-1",
    productIds: ["product-1"],
    fundingSourceId: "balance",
    denomination: 10,
    currencyCode: "USD",
    deliveryMethod: "LINK",
  };
}

function readinessBody(overrides: Record<string, unknown> = {}) {
  return {
    ready: true,
    environment: "sandbox",
    accountStatus: "active",
    apiOrders: true,
    ordersEnabled: true,
    organizationMatches: true,
    campaignMatches: true,
    configurationMatches: true,
    availableBalanceCents: 10_000,
    pendingBalanceCents: 0,
    ...overrides,
  };
}

function configRow(): ProviderConfigRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    environment: "sandbox",
    status: "active",
    orders_enabled: true,
    expected_organization_id: "organization-1",
    campaign_id: "campaign-1",
    configuration_hash: "a".repeat(64),
    reviewed_product_ids: ["product-1"],
    approved_country_codes: ["US"],
    minimum_reward_value_cents: 1_000,
    maximum_reward_value_cents: 5_000,
    reward_currency: "USD",
    cycle_cost_ceiling_cents: 5_000,
    balance_reserve_cents: 5_000,
    balance_ceiling_cents: 10_000,
  };
}

function jobRow(): FulfillmentJobRow {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    draw_result_id: drawResultId,
    cycle_id: cycleId,
    provider_config_id: configRow().id,
    provider_configuration_hash: configRow().configuration_hash!,
    campaign_id: configRow().campaign_id!,
    state: "claimed",
    external_id: `mochirii-mpd-${drawResultId}-v1`,
    country_code: "US",
    reward_value_cents: 1_000,
    reward_currency: "USD",
    all_in_cost_cap_cents: 5_000,
    product_ids: ["product-1"],
    request_hash: null,
    attempt_count: 0,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function assertThrows(callback: () => unknown): void {
  let threw = false;
  try {
    callback();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("Expected callback to throw.");
}
