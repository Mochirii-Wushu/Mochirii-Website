import assert from "node:assert/strict";
import test from "node:test";
import {
  hasSupabaseAuthCookie,
  leaderDashboardAccessDisposition,
  resolveVerifiedServerSession,
} from "./server-access-policy.ts";

const validSession = {
  data: { session: { access_token: "header.payload.signature" } },
  error: null,
};

test("absent auth cookies remain signed out without touching Auth", async () => {
  let called = false;
  const result = await resolveVerifiedServerSession({
    credentialPresent: false,
    auth: {
      getSession: async () => {
        called = true;
        return validSession;
      },
      getClaims: async () => {
        called = true;
        return { data: { claims: { sub: "member-id" } }, error: null };
      },
    },
  });

  assert.deepEqual(result, { ok: false, reason: "signed-out" });
  assert.equal(called, false);
});

test("invalid verified claims remain signed out", async () => {
  const result = await resolveVerifiedServerSession({
    credentialPresent: true,
    auth: {
      getSession: async () => validSession,
      getClaims: async () => ({
        data: null,
        error: { name: "AuthInvalidJwtError", status: 400, code: "invalid_jwt" },
      }),
    },
  });

  assert.deepEqual(result, { ok: false, reason: "signed-out" });
});

test("a valid-cookie Auth outage is unavailable rather than signed out", async () => {
  const sessionOutage = await resolveVerifiedServerSession({
    credentialPresent: true,
    auth: {
      getSession: async () => ({
        data: { session: null },
        error: { name: "AuthRetryableFetchError", status: 0 },
      }),
      getClaims: async () => ({ data: null, error: null }),
    },
  });
  const claimsOutage = await resolveVerifiedServerSession({
    credentialPresent: true,
    auth: {
      getSession: async () => validSession,
      getClaims: async () => ({
        data: null,
        error: { name: "AuthRetryableFetchError", status: 503 },
      }),
    },
  });

  assert.deepEqual(sessionOutage, { ok: false, reason: "unavailable" });
  assert.deepEqual(claimsOutage, { ok: false, reason: "unavailable" });
});

test("verified claims return only the access identity needed by the DAL", async () => {
  const result = await resolveVerifiedServerSession({
    credentialPresent: true,
    auth: {
      getSession: async () => validSession,
      getClaims: async () => ({ data: { claims: { sub: " member-id " } }, error: null }),
    },
  });

  assert.deepEqual(result, {
    ok: true,
    accessToken: "header.payload.signature",
    userId: "member-id",
  });
});

test("only the exact Supabase session cookie or numeric chunks count as credentials", () => {
  const url = "https://project-ref.supabase.co";
  assert.equal(hasSupabaseAuthCookie([], url), false);
  assert.equal(hasSupabaseAuthCookie(["sb-project-ref-auth-token"], url), true);
  assert.equal(hasSupabaseAuthCookie(["sb-project-ref-auth-token.0"], url), true);
  assert.equal(hasSupabaseAuthCookie(["sb-project-ref-auth-token-code-verifier"], url), false);
  assert.equal(hasSupabaseAuthCookie(["sb-project-ref-auth-token.attacker"], url), false);
});

test("moderators render while authenticated non-moderators stay opaque", () => {
  assert.equal(leaderDashboardAccessDisposition({ ok: true }), "authorized");
  assert.equal(leaderDashboardAccessDisposition({ ok: false, reason: "denied" }), "not-found");
  assert.equal(leaderDashboardAccessDisposition({ ok: false, reason: "invalid-token" }), "not-found");
  assert.equal(leaderDashboardAccessDisposition({ ok: false, reason: "upstream" }), "unavailable");
  assert.equal(leaderDashboardAccessDisposition({ ok: false, reason: "rate-limited" }), "unavailable");
});
