import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildResponseSignatureHeaders,
  buildSignatureHeaders,
  canonicalRelayMessage,
  canonicalRelayResponseMessage,
  compareCodeUnits,
  drawResultIdFromExternalId,
  parseRelayRequest,
  RELAY_PATHS,
  sha256Hex,
  stableJson,
} from "../src/protocol.mjs";

const protocolVector = JSON.parse(readFileSync(
  new URL("../../../contracts/reward-relay-protocol-v1.json", import.meta.url),
  "utf8",
));

test("Node relay consumes the same paths, environments, and request schemas as Edge", () => {
  assert.deepEqual(RELAY_PATHS, {
    ...protocolVector.paths.edge,
    ...protocolVector.paths.relayOnly,
  });
  assert.deepEqual(protocolVector.environments.active, [
    "sandbox",
    "production",
  ]);

  const requests = [
    [RELAY_PATHS.readiness, protocolVector.payloads.readinessRequest],
    [RELAY_PATHS.createOrder, protocolVector.payloads.createOrderRequest],
    [RELAY_PATHS.lookupOrder, protocolVector.payloads.lookupOrderRequest],
    [RELAY_PATHS.rewardState, protocolVector.payloads.rewardStateRequest],
  ];
  for (const [path, request] of requests) {
    assert.deepEqual(parseRelayRequest(path, request), request);
    for (const environment of protocolVector.environments.active) {
      const variant = { ...request, environment };
      assert.deepEqual(parseRelayRequest(path, variant), variant);
    }
  }

  const normalization = protocolVector.payloads.createOrderNormalization;
  const normalizedCreateOrder = parseRelayRequest(RELAY_PATHS.createOrder, {
    ...protocolVector.payloads.createOrderRequest,
    productIds: normalization.inputProductIds,
  });
  assert.deepEqual(
    normalizedCreateOrder.productIds,
    normalization.expectedProductIds,
  );
  assert.equal(
    drawResultIdFromExternalId(protocolVector.externalId.value),
    protocolVector.externalId.drawResultId,
  );
  assert.deepEqual(
    Object.keys(protocolVector.payloads.readinessResponse).sort(
      compareCodeUnits,
    ),
    [
      "accountStatus",
      "apiOrders",
      "availableBalanceCents",
      "campaignMatches",
      "configurationMatches",
      "environment",
      "ordersEnabled",
      "organizationMatches",
      "pendingBalanceCents",
      "ready",
    ],
  );
  assert.deepEqual(
    Object.keys(protocolVector.payloads.orderResponse).sort(compareCodeUnits),
    ["orderReference", "outcome", "rewardReference", "sanitizedStatus"],
  );
  assert.deepEqual(
    Object.keys(protocolVector.payloads.rewardStateResponse).sort(
      compareCodeUnits,
    ),
    ["deliveryState", "rewardReference", "state"],
  );
});

test("Node canonical JSON and HMAC material match the immutable shared vectors", () => {
  const stable = protocolVector.stableJson;
  assert.deepEqual(
    Object.keys(stable.value).sort(compareCodeUnits),
    ["A", "a", "é", "é", "𐀀", "😀", ""],
  );
  assert.equal(stableJson(stable.value), stable.canonical);
  assert.equal(sha256Hex(Buffer.from(stable.canonical)), stable.sha256);

  const request = protocolVector.requestSignature;
  assert.equal(
    JSON.stringify(protocolVector.payloads.createOrderRequest),
    request.rawBody,
  );
  assert.deepEqual(
    buildSignatureHeaders({
      secret: request.secret,
      method: request.method,
      path: request.path,
      body: request.rawBody,
      timestampSeconds: Number(request.timestamp),
      nonce: request.nonce,
    }),
    request.headers,
  );
  assert.equal(
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
  assert.equal(
    stableJson(protocolVector.payloads.orderResponse),
    response.stableBody,
  );
  assert.deepEqual(
    buildResponseSignatureHeaders({
      secret: request.secret,
      path: response.path,
      status: response.status,
      requestTimestamp: response.requestTimestamp,
      requestNonce: response.requestNonce,
      body: protocolVector.payloads.orderResponse,
    }),
    response.headers,
  );
  assert.equal(
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
