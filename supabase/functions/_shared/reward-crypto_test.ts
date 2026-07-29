import {
  buildRelayResponseSignatureHeaders,
  buildRelaySignatureHeaders,
  constantTimeHexEquals,
  hmacSha256Hex,
  PROVIDER_WEBHOOK_SIGNATURE_HEADER,
  type ReplayStore,
  sha256Hex,
  stableJson,
  verifyProviderWebhookSignature,
  verifyRelayRequest,
  verifyRelayResponse,
} from "./reward-crypto.ts";

const encoder = new TextEncoder();
const secret = "0123456789abcdef0123456789abcdef";
const nowMs = 1_800_000_000_000;

Deno.test("relay HMAC covers method, path, timestamp, nonce, and exact body", async () => {
  const body = JSON.stringify({ operation: "readiness" });
  const headers = new Headers(
    await buildRelaySignatureHeaders({
      secret,
      method: "POST",
      path: "/v1/readiness",
      body,
      timestampSeconds: Math.floor(nowMs / 1_000),
      nonce: "01234567-89ab-4cde-8fab-0123456789ab",
    }),
  );
  const used = new Set<string>();
  const replayStore: ReplayStore = {
    consume(nonce) {
      if (used.has(nonce)) return false;
      used.add(nonce);
      return true;
    },
  };
  const valid = await verifyRelayRequest({
    secret,
    method: "POST",
    path: "/v1/readiness",
    headers,
    body: encoder.encode(body),
    replayStore,
    nowMs,
  });
  assert(valid.ok, "expected a valid signed relay request");

  const replay = await verifyRelayRequest({
    secret,
    method: "POST",
    path: "/v1/readiness",
    headers,
    body: encoder.encode(body),
    replayStore,
    nowMs,
  });
  assertEquals(replay, { ok: false, reason: "replayed_nonce" });
});

Deno.test("relay verifier rejects body tampering, stale timestamps, and oversized bodies", async () => {
  const body = "{}";
  const headers = new Headers(
    await buildRelaySignatureHeaders({
      secret,
      method: "POST",
      path: "/v1/orders",
      body,
      timestampSeconds: Math.floor(nowMs / 1_000),
      nonce: "01234567-89ab-4cde-8fab-0123456789ab",
    }),
  );
  const replayStore: ReplayStore = { consume: () => true };
  const tampered = await verifyRelayRequest({
    secret,
    method: "POST",
    path: "/v1/orders",
    headers,
    body: encoder.encode('{"changed":true}'),
    replayStore,
    nowMs,
  });
  assertEquals(tampered, { ok: false, reason: "body_hash_mismatch" });

  const stale = await verifyRelayRequest({
    secret,
    method: "POST",
    path: "/v1/orders",
    headers,
    body: encoder.encode(body),
    replayStore,
    nowMs: nowMs + 61_000,
  });
  assertEquals(stale, { ok: false, reason: "expired_timestamp" });

  const oversized = await verifyRelayRequest({
    secret,
    method: "POST",
    path: "/v1/orders",
    headers,
    body: new Uint8Array(17),
    replayStore,
    nowMs,
    maxBodyBytes: 16,
  });
  assertEquals(oversized, { ok: false, reason: "body_too_large" });
});

Deno.test("relay verifier rejects missing and malformed authentication material", async () => {
  const base = {
    secret,
    method: "POST",
    path: "/v1/orders",
    headers: new Headers(),
    body: encoder.encode("{}"),
    replayStore: { consume: () => true } satisfies ReplayStore,
    nowMs,
  };
  assertEquals(await verifyRelayRequest(base), {
    ok: false,
    reason: "missing_header",
  });
  assertEquals(await verifyRelayRequest({ ...base, secret: "" }), {
    ok: false,
    reason: "missing_secret",
  });

  const headers = new Headers({
    "x-mochirii-timestamp": "not-a-time",
    "x-mochirii-nonce": "0123456789abcdef",
    "x-mochirii-body-sha256": "0".repeat(64),
    "x-mochirii-signature": "0".repeat(64),
  });
  assertEquals(await verifyRelayRequest({ ...base, headers }), {
    ok: false,
    reason: "invalid_timestamp",
  });
});

Deno.test("relay response authentication binds canonical body, request nonce, path, and status", async () => {
  const path = "/v1/readiness";
  const status = 200;
  const requestTimestamp = String(Math.floor(nowMs / 1_000));
  const requestNonce = "01234567-89ab-4cde-8fab-0123456789ab";
  const body = { ready: true, nested: { b: 2, a: 1 } };
  const headers = new Headers(
    await buildRelayResponseSignatureHeaders({
      secret,
      path,
      status,
      requestTimestamp,
      requestNonce,
      body,
    }),
  );
  assert(
    await verifyRelayResponse({
      secret,
      path,
      status,
      requestTimestamp,
      requestNonce,
      headers,
      body: { nested: { a: 1, b: 2 }, ready: true },
    }),
    "valid canonical relay response was rejected",
  );
  assertEquals(stableJson(body), '{"nested":{"a":1,"b":2},"ready":true}');

  const substitutions = [
    { body: { ...body, ready: false } },
    { requestNonce: "fedcba98-7654-4cde-8fab-0123456789ab" },
    { path: "/v1/orders" },
    { status: 201 },
  ];
  for (const substitution of substitutions) {
    const verified = await verifyRelayResponse({
      secret,
      path,
      status,
      requestTimestamp,
      requestNonce,
      headers,
      body,
      ...substitution,
    });
    assert(!verified, "relay response substitution passed authentication");
  }

  assert(
    !await verifyRelayResponse({
      secret,
      path,
      status,
      requestTimestamp,
      requestNonce,
      headers: new Headers(),
      body,
    }),
    "unsigned relay response passed authentication",
  );
});

Deno.test("webhook HMAC verifies the unchanged raw bytes and rejects substitution", async () => {
  const rawBody = encoder.encode(
    '{"uuid":"00000000-0000-4000-8000-000000000001"}',
  );
  const signature = await hmacSha256Hex(secret, rawBody);
  const valid = await verifyProviderWebhookSignature({
    secret,
    rawBody,
    signature: `sha256=${signature}`,
  });
  assert(valid.ok, `expected ${PROVIDER_WEBHOOK_SIGNATURE_HEADER} to verify`);
  if (valid.ok) assertEquals(valid.bodyHash, await sha256Hex(rawBody));

  const invalid = await verifyProviderWebhookSignature({
    secret,
    rawBody: encoder.encode('{"uuid":"00000000-0000-4000-8000-000000000002"}'),
    signature,
  });
  assertEquals(invalid, { ok: false, reason: "invalid_signature" });
  const tooLarge = await verifyProviderWebhookSignature({
    secret,
    rawBody: new Uint8Array(5),
    signature,
    maxBodyBytes: 4,
  });
  assertEquals(tooLarge, { ok: false, reason: "body_too_large" });
});

Deno.test("constant-time hex comparison fails closed for malformed and unequal values", () => {
  assert(
    constantTimeHexEquals("ab".repeat(32), "ab".repeat(32)),
    "equal digests should match",
  );
  assert(
    !constantTimeHexEquals("ab".repeat(32), "ac".repeat(32)),
    "different digests should not match",
  );
  assert(
    !constantTimeHexEquals("not-hex", "not-hex"),
    "malformed values must not match",
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
