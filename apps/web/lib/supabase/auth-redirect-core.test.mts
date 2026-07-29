import assert from "node:assert/strict";
import test from "node:test";
import { authCallbackPath, authLoginPath, resolveAuthReturnPath } from "./auth-redirect.ts";

test("auth return paths are restricted to reviewed local destinations", () => {
  for (const path of [
    "/account",
    "/gallery-submit",
    "/games/mochi-pets",
    "/leader-dashboard",
    "/leader-dashboard/raffle",
    "/raffle/claim",
    "/social",
  ]) assert.equal(resolveAuthReturnPath(path), path);
});

test("auth return paths reject external, malformed, and unreviewed destinations", () => {
  for (const path of [
    "https://example.com/account",
    "//example.com/account",
    "/\\example.com",
    "/account?next=https://example.com",
    "/unknown",
    "/%2f%2fexample.com",
    "\u0000/account",
  ]) assert.equal(resolveAuthReturnPath(path), "/account");
});

test("OAuth consent preserves only one bounded authorization identifier", () => {
  assert.equal(
    resolveAuthReturnPath("/oauth/consent?authorization_id=abc-123_def.xyz~value"),
    "/oauth/consent?authorization_id=abc-123_def.xyz~value",
  );
  assert.equal(
    resolveAuthReturnPath("/oauth/consent?authorization_id=opaque%2Bvalue%2Fwith%3Dpadding"),
    "/oauth/consent?authorization_id=opaque%2Bvalue%2Fwith%3Dpadding",
  );
  assert.equal(resolveAuthReturnPath("/oauth/consent?authorization_id=abc&extra=value"), "/account");
  assert.equal(resolveAuthReturnPath("/oauth/consent?authorization_id=abc&authorization_id=def"), "/account");
});

test("callback and login paths encode the reviewed destination", () => {
  assert.equal(authCallbackPath("/raffle/claim"), "/auth/callback?next=%2Fraffle%2Fclaim");
  assert.equal(
    authLoginPath("/leader-dashboard/raffle"),
    "/auth?redirect=%2Fleader-dashboard%2Fraffle",
  );
});
