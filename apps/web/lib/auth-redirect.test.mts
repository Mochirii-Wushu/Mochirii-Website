import assert from "node:assert/strict";
import test from "node:test";
import { authCallbackPath, safeInternalRedirectPath } from "./auth-redirect.ts";

test("auth callbacks preserve a local route and its OAuth authorization id", () => {
  const next = "/oauth/consent?authorization_id=request_123";
  const callback = new URL(authCallbackPath(next), "https://mochirii.com");

  assert.equal(callback.pathname, "/auth/callback");
  assert.equal(callback.searchParams.get("next"), next);
});

test("auth redirects reject external and URL-confusion destinations", () => {
  for (const value of [
    "https://example.invalid/steal",
    "//example.invalid/steal",
    "/\\example.invalid/steal",
    "javascript:alert(1)",
    "",
  ]) {
    assert.equal(safeInternalRedirectPath(value), "/account");
  }
});

test("auth redirects keep local query strings and fragments", () => {
  assert.equal(
    safeInternalRedirectPath("/leader-dashboard?spinner=expired#main"),
    "/leader-dashboard?spinner=expired#main",
  );
});
