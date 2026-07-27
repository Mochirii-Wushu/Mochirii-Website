import {
  parseRelayOrderResponse,
  parseRelayRequest,
  RELAY_PATHS,
} from "./reward-relay-contract.ts";
import {
  PROVIDER_BASE_URLS,
  validateProviderEnvironment,
} from "./reward-relay-provider-config.ts";
import {
  createRelayClient,
  REWARD_RELAY_ORIGIN,
  validateRewardRelayUrl,
} from "./reward-relay-client.ts";
import {
  buildRelayResponseSignatureHeaders,
  RELAY_SIGNATURE_HEADERS,
  type ReplayStore,
  verifyRelayRequest,
} from "./reward-crypto.ts";
import { SITE_ORIGIN } from "./public-origins.ts";

const drawResultId = "12345678-1234-4234-9234-1234567890ab";
const configHash = "a".repeat(64);

Deno.test("provider environment derives fixed URLs and rejects key-prefix mismatch", () => {
  assertEquals(
    validateProviderEnvironment({
      mode: "disabled",
      apiKey: null,
      expectedOrganizationId: null,
      campaignId: null,
      ordersEnabled: false,
    }),
    { ok: true, mode: "disabled", baseUrl: null, ordersEnabled: false },
  );
  assertEquals(
    validateProviderEnvironment({
      mode: "sandbox",
      apiKey: "PROD_placeholder",
      expectedOrganizationId: "org-1",
      campaignId: "campaign-1",
      ordersEnabled: true,
    }),
    { ok: false, reason: "key_environment_mismatch" },
  );
  assertEquals(
    validateProviderEnvironment({
      mode: "production",
      apiKey: "PROD_placeholder",
      expectedOrganizationId: "org-1",
      campaignId: "campaign-1",
      ordersEnabled: true,
    }),
    {
      ok: true,
      mode: "production",
      baseUrl: PROVIDER_BASE_URLS.production,
      ordersEnabled: true,
    },
  );
  assertEquals(
    validateProviderEnvironment({
      mode: "production",
      apiKey: "PROD_placeholder",
      expectedOrganizationId: "org-1",
      campaignId: "campaign-1",
      ordersEnabled: false,
    }),
    { ok: false, reason: "orders_disabled" },
  );
});

Deno.test("relay URL requires the exact compiled dedicated HTTPS origin", () => {
  assertEquals(
    validateRewardRelayUrl(REWARD_RELAY_ORIGIN),
    `${REWARD_RELAY_ORIGIN}/`,
  );
  assertThrows(() => validateRewardRelayUrl(SITE_ORIGIN));
  assertThrows(() => validateRewardRelayUrl("https://other.mochirii.com"));
  assertThrows(() =>
    validateRewardRelayUrl("https://reward-gateway.mochirii.com.evil.example")
  );
  assertThrows(() =>
    validateRewardRelayUrl("https://reward-gateway.mochirii.com/path")
  );
  assertThrows(() => validateRewardRelayUrl("http://reward-gateway.mochirii.com"));
});

Deno.test("strict order schema accepts only whole-dollar $10 through $50 gross prizes", () => {
  const valid = createOrderBody();
  assertEquals(parseRelayRequest(RELAY_PATHS.createOrder, valid), valid);
  for (const denomination of [10, 25, 50]) {
    assertEquals(
      parseRelayRequest(RELAY_PATHS.createOrder, { ...valid, denomination }),
      { ...valid, denomination },
    );
  }
  for (const denomination of [9, 10.5, 51]) {
    assertThrows(() =>
      parseRelayRequest(RELAY_PATHS.createOrder, { ...valid, denomination })
    );
  }
  assertThrows(() =>
    parseRelayRequest(RELAY_PATHS.createOrder, {
      ...valid,
      deliveryMethod: "EMAIL",
    })
  );
  assertThrows(() =>
    parseRelayRequest(RELAY_PATHS.createOrder, { ...valid, productIds: [] })
  );
  assertThrows(() =>
    parseRelayRequest(RELAY_PATHS.createOrder, {
      ...valid,
      recipientEmail: "private@example.com",
    })
  );
  assertThrows(() => parseRelayRequest("/v1/proxy", valid));
});

Deno.test("core relay responses reject raw additions and have no link endpoint", () => {
  assertEquals(
    parseRelayOrderResponse({
      outcome: "created",
      orderReference: "order-1",
      rewardReference: "reward-1",
      sanitizedStatus: "succeeded",
    }),
    {
      outcome: "created",
      orderReference: "order-1",
      rewardReference: "reward-1",
      sanitizedStatus: "succeeded",
    },
  );
  assertThrows(() =>
    parseRelayOrderResponse({
      outcome: "created",
      orderReference: "order-1",
      rewardReference: "reward-1",
      sanitizedStatus: "succeeded",
      rawProviderResponse: { secret: true },
    })
  );
  assertThrows(() =>
    parseRelayRequest("/v1/rewards/link", {
      operation: "generate_link",
      environment: "sandbox",
      drawResultId,
      rewardReference: "reward-1",
    })
  );
});

Deno.test("relay client mutually authenticates its request and response", async () => {
  let capturedRequest: Request | null = null;
  const responseBody = { error: "not_found" };
  const client = createRelayClient({
    baseUrl: "https://reward-gateway.mochirii.com",
    hmacSecret: "0123456789abcdef0123456789abcdef",
    now: () => 1_800_000_000_000,
    nonce: () => "01234567-89ab-4cde-8fab-0123456789ab",
    fetcher: async (input, init) => {
      capturedRequest = new Request(input, init);
      const request = capturedRequest as Request;
      const responseHeaders = await buildRelayResponseSignatureHeaders({
        secret: "0123456789abcdef0123456789abcdef",
        path: new URL(request.url).pathname,
        status: 404,
        requestTimestamp:
          request.headers.get(RELAY_SIGNATURE_HEADERS.timestamp) || "",
        requestNonce: request.headers.get(RELAY_SIGNATURE_HEADERS.nonce) || "",
        body: responseBody,
      });
      return new Response(JSON.stringify(responseBody), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...responseHeaders,
        },
      });
    },
  });
  const relayResponse = await client.request(RELAY_PATHS.lookupOrder, {
    operation: "lookup_order",
    environment: "sandbox",
    externalId: `mochirii-mpd-${drawResultId}-v1`,
  });
  assert(capturedRequest, "request should be captured");
  const request = capturedRequest as Request;
  assertEquals(
    new URL(request.url).origin,
    "https://reward-gateway.mochirii.com",
  );
  const body = new Uint8Array(await request.clone().arrayBuffer());
  const replayStore: ReplayStore = { consume: () => true };
  const verified = await verifyRelayRequest({
    secret: "0123456789abcdef0123456789abcdef",
    method: request.method,
    path: new URL(request.url).pathname,
    headers: request.headers,
    body,
    replayStore,
    nowMs: 1_800_000_000_000,
  });
  assert(verified.ok, "client request should carry a valid relay signature");
  assertEquals(relayResponse.body, responseBody);
});

Deno.test("relay client rejects response tampering and request-context substitution", async () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const responseBody = { outcome: "found" };
  const cases = [
    { name: "body", returnedBody: { outcome: "changed" } },
    { name: "nonce", nonce: "fedcba98-7654-4cde-8fab-0123456789ab" },
    { name: "path", path: RELAY_PATHS.createOrder },
    { name: "status", signedStatus: 201 },
  ];
  for (const testCase of cases) {
    const client = createRelayClient({
      baseUrl: REWARD_RELAY_ORIGIN,
      hmacSecret: secret,
      now: () => 1_800_000_000_000,
      nonce: () => "01234567-89ab-4cde-8fab-0123456789ab",
      fetcher: async (input, init) => {
        const request = new Request(input, init);
        const actualPath = new URL(request.url).pathname;
        const headers = await buildRelayResponseSignatureHeaders({
          secret,
          path: testCase.path || actualPath,
          status: testCase.signedStatus || 200,
          requestTimestamp:
            request.headers.get(RELAY_SIGNATURE_HEADERS.timestamp) || "",
          requestNonce: testCase.nonce ||
            request.headers.get(RELAY_SIGNATURE_HEADERS.nonce) || "",
          body: responseBody,
        });
        return new Response(
          JSON.stringify(testCase.returnedBody || responseBody),
          { status: 200, headers },
        );
      },
    });
    await assertRejects(
      () =>
        client.request(RELAY_PATHS.lookupOrder, {
          operation: "lookup_order",
        }),
      `${testCase.name} substitution was accepted`,
    );
  }
});

function createOrderBody() {
  return {
    operation: "create_order" as const,
    environment: "sandbox" as const,
    configurationHash: configHash,
    drawResultId,
    externalId: `mochirii-mpd-${drawResultId}-v1`,
    countryCode: "US",
    campaignId: "campaign-1",
    productIds: ["product-1"],
    fundingSourceId: "balance" as const,
    denomination: 10 as const,
    currencyCode: "USD" as const,
    deliveryMethod: "LINK" as const,
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

async function assertRejects(
  callback: () => Promise<unknown>,
  message: string,
): Promise<void> {
  let rejected = false;
  try {
    await callback();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(message);
}
