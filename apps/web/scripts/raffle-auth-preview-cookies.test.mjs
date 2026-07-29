import assert from "node:assert/strict";
import test from "node:test";
import {
  applySetCookieChanges,
  hasNonemptyAuthTokenCookie,
  parseSetCookieChange,
} from "./raffle-auth-preview-cookies.mjs";

test("accepts an empty PKCE verifier deletion cookie", () => {
  assert.deepEqual(
    parseSetCookieChange("sb-project-auth-token-code-verifier=; Path=/; Max-Age=0; Secure"),
    { name: "sb-project-auth-token-code-verifier", value: "", deletion: true },
  );
});

test("recognizes explicit expiry and max-age deletion semantics", () => {
  const now = Date.parse("2026-07-28T00:00:00Z");
  assert.equal(parseSetCookieChange("session=value; Max-Age=0", now)?.deletion, true);
  assert.equal(parseSetCookieChange("session=value; Expires=Mon, 27 Jul 2026 00:00:00 GMT", now)?.deletion, true);
  assert.equal(parseSetCookieChange("session=value; Max-Age=3600", now)?.deletion, false);
});

test("rejects malformed or control-character response cookies", () => {
  assert.equal(parseSetCookieChange("missing-separator"), null);
  assert.equal(parseSetCookieChange("bad name=value"), null);
  assert.equal(parseSetCookieChange("session=value\r\nInjected: yes"), null);
});

test("applies deletions while retaining a nonempty callback auth token", () => {
  const jar = new Map([
    ["sb-project-auth-token-code-verifier", "verifier"],
  ]);
  const changes = [
    parseSetCookieChange("sb-project-auth-token-code-verifier=; Path=/; Max-Age=0"),
    parseSetCookieChange("sb-project-auth-token.0=session-part; Path=/; HttpOnly"),
  ];

  applySetCookieChanges(jar, changes);

  assert.equal(jar.has("sb-project-auth-token-code-verifier"), false);
  assert.equal(jar.get("sb-project-auth-token.0"), "session-part");
  assert.equal(hasNonemptyAuthTokenCookie(jar), true);
});

test("an empty or deleted auth token never satisfies the session requirement", () => {
  const jar = new Map([["sb-project-auth-token", "old-session"]]);
  applySetCookieChanges(jar, [parseSetCookieChange("sb-project-auth-token=; Max-Age=0")]);

  assert.equal(jar.has("sb-project-auth-token"), false);
  assert.equal(hasNonemptyAuthTokenCookie(jar), false);
  assert.equal(hasNonemptyAuthTokenCookie(new Map([["sb-project-auth-token", ""]])), false);
});
