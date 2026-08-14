import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  buildForumsDiscourseConnectRedirect,
  deterministicForumsUsername,
  normalizedForumsDisplayName,
  verifyDiscourseConnectRequest,
} from "./discourse-connect-core.ts";
import {
  approvedForumsDiscourseConnectRedirect,
  FORUMS_DISCOURSE_CONNECT_CALLBACK,
} from "./discourse-connect-callback.ts";

const secret = "a".repeat(64);
const nonce = "0123456789abcdef0123456789abcdef";
const memberId = "00000000-0000-4000-8000-000000000001";

function sign(payload: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function requestPayload(fields: [string, string][] = [
  ["nonce", nonce],
  ["return_sso_url", FORUMS_DISCOURSE_CONNECT_CALLBACK],
]) {
  const encodedPayload = Buffer.from(new URLSearchParams(fields).toString()).toString("base64");
  return { encodedPayload, signatureHex: sign(encodedPayload), secret };
}

test("validates the exact signed request and callback", () => {
  assert.deepEqual(verifyDiscourseConnectRequest(requestPayload()), {
    ok: true,
    request: { nonce, returnUrl: FORUMS_DISCOURSE_CONNECT_CALLBACK },
  });
  assert.equal(verifyDiscourseConnectRequest(requestPayload([
    ["return_sso_url", FORUMS_DISCOURSE_CONNECT_CALLBACK],
    ["nonce", nonce],
  ])).ok, true);
});

test("checks the HMAC before attempting to decode the payload", () => {
  const malformed = "not base64!";
  assert.deepEqual(
    verifyDiscourseConnectRequest({
      encodedPayload: malformed,
      signatureHex: "0".repeat(64),
      secret,
    }),
    { ok: false, reason: "invalid_signature" },
  );
  assert.deepEqual(
    verifyDiscourseConnectRequest({
      encodedPayload: malformed,
      signatureHex: sign(malformed),
      secret,
    }),
    { ok: false, reason: "malformed_payload" },
  );
});

test("rejects hostile request shapes", () => {
  const wrongReturn = requestPayload([
    ["nonce", nonce],
    ["return_sso_url", "https://forums.mochirii.com/session/sso_login?next=/admin"],
  ]);
  assert.deepEqual(verifyDiscourseConnectRequest(wrongReturn), {
    ok: false,
    reason: "invalid_return_url",
  });

  for (const fields of [
    [["nonce", nonce], ["nonce", nonce], ["return_sso_url", FORUMS_DISCOURSE_CONNECT_CALLBACK]],
    [["nonce", "short"], ["return_sso_url", FORUMS_DISCOURSE_CONNECT_CALLBACK]],
    [["nonce", nonce], ["return_sso_url", FORUMS_DISCOURSE_CONNECT_CALLBACK], ["admin", "true"]],
  ] as [string, string][][]) {
    assert.equal(verifyDiscourseConnectRequest(requestPayload(fields)).ok, false);
  }
});

test("derives a stable collision-resistant 20-character ASCII username", () => {
  const username = deterministicForumsUsername(memberId);
  assert.equal(username, deterministicForumsUsername(memberId.toUpperCase()));
  assert.match(username, /^[a-z0-9_]{20}$/);
  assert.notEqual(
    username,
    deterministicForumsUsername("00000000-0000-4000-8000-000000000002"),
  );
  assert.throws(() => deterministicForumsUsername("not-a-uuid"));
});

test("keeps the current display name separate and rejects unsafe names", () => {
  assert.equal(normalizedForumsDisplayName("  Moon   Pearl  "), "Moon Pearl");
  assert.equal(normalizedForumsDisplayName("Mōchirīī Member"), "Mōchirīī Member");
  assert.equal(normalizedForumsDisplayName("x"), null);
  assert.equal(normalizedForumsDisplayName(`safe\u202ename`), null);
  assert.equal(normalizedForumsDisplayName("x".repeat(41)), null);
});

test("signs only an exact Forums callback and denies elevated privileges", () => {
  const redirect = buildForumsDiscourseConnectRedirect({
    nonce,
    email: "member@example.com",
    externalId: memberId,
    username: deterministicForumsUsername(memberId),
    name: "Moon Pearl",
    secret,
  });
  assert.equal(approvedForumsDiscourseConnectRedirect(redirect), redirect);

  const url = new URL(redirect);
  const encodedPayload = url.searchParams.get("sso") || "";
  assert.equal(url.searchParams.get("sig"), sign(encodedPayload));
  const fields = new URLSearchParams(Buffer.from(encodedPayload, "base64").toString("utf8"));
  assert.equal(fields.get("nonce"), nonce);
  assert.equal(fields.get("email"), "member@example.com");
  assert.equal(fields.get("external_id"), memberId);
  assert.equal(fields.get("username"), deterministicForumsUsername(memberId));
  assert.equal(fields.get("name"), "Moon Pearl");
  assert.equal(fields.get("admin"), "false");
  assert.equal(fields.get("moderator"), "false");
});

test("client redirect validation rejects every alternate destination", () => {
  const valid = buildForumsDiscourseConnectRedirect({
    nonce,
    email: "member@example.com",
    externalId: memberId,
    username: deterministicForumsUsername(memberId),
    name: "Moon Pearl",
    secret,
  });
  const url = new URL(valid);
  const variants = [
    valid.replace("https://forums.mochirii.com", "https://example.com"),
    `${valid}&next=https://example.com`,
    `${valid}#fragment`,
    valid.replace("/session/sso_login", "/session/sso_login/"),
    valid.replace("https://", "https://user@"),
    `${FORUMS_DISCOURSE_CONNECT_CALLBACK}?sig=${url.searchParams.get("sig")}&sso=${encodeURIComponent(url.searchParams.get("sso") || "")}`,
  ];
  for (const variant of variants) assert.equal(approvedForumsDiscourseConnectRedirect(variant), null);
});
