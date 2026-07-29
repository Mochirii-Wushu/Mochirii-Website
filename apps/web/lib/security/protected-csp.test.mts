import assert from "node:assert/strict";
import test from "node:test";
import { protectedPageContentSecurityPolicy } from "./protected-csp.ts";

test("protected pages use a nonce-based strict script policy", () => {
  const nonce = "0123456789abcdef0123456789abcdef";
  const policy = protectedPageContentSecurityPolicy(nonce);
  const scriptDirective = policy.split("; ").find((directive) => directive.startsWith("script-src "));

  assert.equal(scriptDirective, `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
  assert.doesNotMatch(String(scriptDirective), /unsafe-inline/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
});

test("protected page policies reject reusable or malformed nonces", () => {
  for (const nonce of ["", "fixed", "0123456789abcdef", "g".repeat(32), "0".repeat(33)]) {
    assert.throws(() => protectedPageContentSecurityPolicy(nonce));
  }
});
