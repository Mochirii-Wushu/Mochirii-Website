import assert from "node:assert/strict";
import test from "node:test";
import {
  claimPageDecision,
  freshGuildVerificationPasses,
  freshModeratorVerificationPasses,
  moderatorPageDecision,
  verifiedClaimsSubject,
} from "./raffle-access-policy.ts";

test("verified claims require an authenticated, non-anonymous subject", () => {
  assert.equal(verifiedClaimsSubject({ sub: "member-1", role: "authenticated" }), "member-1");
  assert.equal(verifiedClaimsSubject({ sub: "member-1", role: "anon" }), null);
  assert.equal(verifiedClaimsSubject({ sub: "member-1", role: "authenticated", is_anonymous: true }), null);
  assert.equal(verifiedClaimsSubject({ role: "authenticated" }), null);
});

test("guild verification requires the complete fresh active-member result", () => {
  const verified = {
    verified: true,
    hasGuildMembership: true,
    hasRequiredRoles: true,
    pending: false,
    memberStatus: "active",
  };
  assert.equal(freshGuildVerificationPasses(verified), true);
  assert.equal(freshGuildVerificationPasses({ ...verified, pending: true }), false);
  assert.equal(freshGuildVerificationPasses({ ...verified, memberStatus: "suspended" }), false);
  assert.equal(freshGuildVerificationPasses({ ...verified, hasRequiredRoles: false }), false);
});

test("claim page redirects before rendering, hides denied members, and stays disabled", () => {
  assert.equal(claimPageDecision({ authenticated: false, freshGuildMember: false }), "redirect-auth");
  assert.equal(claimPageDecision({ authenticated: true, freshGuildMember: false }), "not-found");
  assert.equal(claimPageDecision({ authenticated: true, freshGuildMember: true }), "unavailable");
});

test("moderator page requires independently verified current moderator access", () => {
  assert.equal(freshModeratorVerificationPasses({ ok: true, hasAccess: true, data: { hasAccess: true } }), true);
  assert.equal(freshModeratorVerificationPasses({ ok: true, data: { hasAccess: true } }), false);
  assert.equal(freshModeratorVerificationPasses({ ok: true, hasAccess: true, data: { hasAccess: false } }), false);
  assert.equal(moderatorPageDecision({ authenticated: false, freshModerator: false }), "redirect-auth");
  assert.equal(moderatorPageDecision({ authenticated: true, freshModerator: false }), "not-found");
  assert.equal(moderatorPageDecision({ authenticated: true, freshModerator: true }), "moderator");
});
