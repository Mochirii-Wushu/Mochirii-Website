import protocolVector from "../../../contracts/reward-relay-protocol-v1.json" with {
  type: "json",
};
import {
  buildRelayResponseSignatureHeaders,
  buildRelaySignatureHeaders,
  canonicalRelayMessage,
  canonicalRelayResponseMessage,
  compareCodeUnits,
  sha256Hex,
  stableJson,
} from "./reward-crypto.ts";
import {
  parseRelayOrderResponse,
  parseRelayReadinessResponse,
  parseRelayRequest,
  parseRelayRewardStateResponse,
  RELAY_PATHS,
} from "./reward-relay-contract.ts";
import { createRelayClient } from "./reward-relay-client.ts";

Deno.test("Edge and relay share exact paths, active environments, and payload schemas", () => {
  assertEquals(RELAY_PATHS, protocolVector.paths.edge);
  assertEquals(protocolVector.environments.active, ["sandbox", "production"]);

  const requests = [
    [RELAY_PATHS.readiness, protocolVector.payloads.readinessRequest],
    [RELAY_PATHS.createOrder, protocolVector.payloads.createOrderRequest],
    [RELAY_PATHS.lookupOrder, protocolVector.payloads.lookupOrderRequest],
    [RELAY_PATHS.rewardState, protocolVector.payloads.rewardStateRequest],
  ] as const;
  for (const [path, request] of requests) {
    assertEquals(parseRelayRequest(path, request), request);
    for (const environment of protocolVector.environments.active) {
      const variant = { ...request, environment };
      assertEquals(parseRelayRequest(path, variant), variant);
    }
  }

  const normalization = protocolVector.payloads.createOrderNormalization;
  const normalizedCreateOrder = parseRelayRequest(
    RELAY_PATHS.createOrder,
    {
      ...protocolVector.payloads.createOrderRequest,
      productIds: normalization.inputProductIds,
    },
  );
  assert(
    normalizedCreateOrder.operation === "create_order",
    "normalization vector must parse as create_order",
  );
  assertEquals(
    normalizedCreateOrder.productIds,
    normalization.expectedProductIds,
  );

  assertEquals(
    parseRelayReadinessResponse(protocolVector.payloads.readinessResponse),
    protocolVector.payloads.readinessResponse,
  );
  assertEquals(
    parseRelayOrderResponse(protocolVector.payloads.orderResponse),
    protocolVector.payloads.orderResponse,
  );
  assertEquals(
    parseRelayRewardStateResponse(protocolVector.payloads.rewardStateResponse),
    protocolVector.payloads.rewardStateResponse,
  );
  assertEquals(
    protocolVector.payloads.createOrderRequest.externalId,
    protocolVector.externalId.value,
  );
  assertEquals(
    protocolVector.payloads.createOrderRequest.drawResultId,
    protocolVector.externalId.drawResultId,
  );
});

Deno.test("Edge canonical JSON and HMAC material match immutable protocol vectors", async () => {
  const stable = protocolVector.stableJson;
  assertEquals(
    Object.keys(stable.value).sort(compareCodeUnits),
    ["A", "a", "é", "é", "𐀀", "😀", ""],
  );
  assertEquals(stableJson(stable.value), stable.canonical);
  assertEquals(await sha256Hex(stable.canonical), stable.sha256);

  const request = protocolVector.requestSignature;
  assertEquals(
    JSON.stringify(protocolVector.payloads.createOrderRequest),
    request.rawBody,
  );
  const requestHeaders = await buildRelaySignatureHeaders({
    secret: request.secret,
    method: request.method,
    path: request.path,
    body: request.rawBody,
    timestampSeconds: Number(request.timestamp),
    nonce: request.nonce,
  });
  assertEquals(requestHeaders, request.headers);
  assertEquals(
    canonicalRelayMessage({
      method: request.method,
      path: request.path,
      timestamp: request.timestamp,
      nonce: request.nonce,
      bodyHash: request.bodyHash,
    }),
    request.canonicalMessage,
  );

  const response = protocolVector.responseSignature;
  assertEquals(
    stableJson(protocolVector.payloads.orderResponse),
    response.stableBody,
  );
  const responseHeaders = await buildRelayResponseSignatureHeaders({
    secret: request.secret,
    path: response.path,
    status: response.status,
    requestTimestamp: response.requestTimestamp,
    requestNonce: response.requestNonce,
    body: protocolVector.payloads.orderResponse,
  });
  assertEquals(responseHeaders, response.headers);
  assertEquals(
    canonicalRelayResponseMessage({
      path: response.path,
      status: response.status,
      requestTimestamp: response.requestTimestamp,
      requestNonce: response.requestNonce,
      bodyHash: response.bodyHash,
    }),
    response.canonicalMessage,
  );
});

Deno.test("Edge relay deadline remains active through a stalled response body", async () => {
  let aborted = false;
  const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener("abort", () => {
          aborted = true;
          controller.error(new DOMException("aborted", "AbortError"));
        }, { once: true });
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
  const client = createRelayClient({
    baseUrl: "https://reward-gateway.mochirii.com",
    hmacSecret: protocolVector.requestSignature.secret,
    fetcher,
    timeoutMs: 1_000,
    now: () => 1_700_000_000_000,
    nonce: () => protocolVector.requestSignature.nonce,
  });
  const startedAt = Date.now();
  await assertRejects(() =>
    client.request(
      RELAY_PATHS.readiness,
      protocolVector.payloads.readinessRequest,
    )
  );
  assert(aborted, "stalled body was not aborted by the relay deadline");
  assert(
    Date.now() - startedAt < 2_000,
    "stalled body exceeded the bounded relay deadline",
  );
});

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

async function assertRejects(callback: () => Promise<unknown>): Promise<void> {
  let rejected = false;
  try {
    await callback();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Expected promise to reject.");
}
