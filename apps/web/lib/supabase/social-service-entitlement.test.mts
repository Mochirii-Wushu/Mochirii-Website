import assert from "node:assert/strict";
import test from "node:test";
import {
  socialServiceEntitlementDecision,
  socialServiceEntitlementEnvelopeDecision,
} from "./social-service-entitlement.ts";
import { buildSocialServiceEntitlement } from "../../../../supabase/functions/_shared/social-service-entitlement.ts";

const NOW = Date.parse("2026-08-12T02:00:00.000Z");

function access(overrides: Record<string, unknown> = {}) {
  return {
    galleryEligible: false,
    manualApproved: false,
    memberStatus: "active",
    discordVerified: true,
    profile: { member_status: "active" },
    socialEntitlement: {
      contract: "mochirii.social-service-entitlement",
      version: 1,
      service: "social",
      allowed: true,
      memberStatus: "active",
      discordVerified: true,
      reason: "allowed",
      evaluatedAt: new Date(NOW).toISOString(),
      validUntil: new Date(NOW + 60_000).toISOString(),
    },
    ...overrides,
  };
}

test("strict Social entitlement accepts only the direct consistent v1 response", () => {
  assert.equal(socialServiceEntitlementDecision(access(), NOW), "allowed");
  assert.equal(
    socialServiceEntitlementEnvelopeDecision({ ok: true, data: access() }, NOW),
    "allowed",
  );
});

test("the Edge producer round-trips through the independent Website consumer", () => {
  const socialEntitlement = buildSocialServiceEntitlement({
    memberStatus: "active",
    discordVerified: true,
    discordVerifiedAt: new Date(NOW - 1_000).toISOString(),
    evaluatedAtMs: NOW,
  });
  const response = JSON.parse(JSON.stringify(access({ socialEntitlement })));

  assert.equal(socialServiceEntitlementDecision(response, NOW), "allowed");
  response.socialEntitlement.memberStatus = "Active";
  assert.equal(socialServiceEntitlementDecision(response, NOW), "unavailable");
});

test("manual-only Gallery access is a valid Social denial", () => {
  const manualOnly = access({
    galleryEligible: true,
    manualApproved: true,
    discordVerified: false,
    socialEntitlement: {
      contract: "mochirii.social-service-entitlement",
      version: 1,
      service: "social",
      allowed: false,
      memberStatus: "active",
      discordVerified: false,
      reason: "discord_verification_required",
      evaluatedAt: new Date(NOW).toISOString(),
      validUntil: null,
    },
  });

  assert.equal(manualOnly.galleryEligible, true);
  assert.equal(socialServiceEntitlementDecision(manualOnly, NOW), "denied");
});

test("legacy, nested, wrong-version, inconsistent, and failed envelopes fail unavailable", () => {
  const valid = access();
  const cases = [
    { ...valid, socialEntitlement: undefined },
    { data: valid },
    access({ socialEntitlement: { ...(valid.socialEntitlement as object), version: 2 } }),
    access({ socialEntitlement: { ...(valid.socialEntitlement as object), version: "1" } }),
    access({ socialEntitlement: { ...(valid.socialEntitlement as object), service: "gallery" } }),
    access({ discordVerified: false }),
    access({ memberStatus: "pending" }),
    access({ profile: { member_status: "suspended" } }),
    access({ socialEntitlement: { ...(valid.socialEntitlement as object), discordVerified: false } }),
    access({ socialEntitlement: { ...(valid.socialEntitlement as object), reason: "inactive_member" } }),
    access({ socialEntitlement: { ...(valid.socialEntitlement as object), unexpected: true } }),
    access({ socialEntitlement: { ...(valid.socialEntitlement as object), allowed: "true" } }),
    access({ socialEntitlement: { ...(valid.socialEntitlement as object), discordVerified: 1 } }),
    access({ socialEntitlement: { ...(valid.socialEntitlement as object), memberStatus: "Active" } }),
    access({ socialEntitlement: { ...(valid.socialEntitlement as object), memberStatus: "active " } }),
    access({ socialEntitlement: { ...(valid.socialEntitlement as object), validUntil: undefined } }),
  ];

  for (const value of cases) {
    assert.equal(socialServiceEntitlementDecision(value, NOW), "unavailable");
  }

  assert.equal(
    socialServiceEntitlementEnvelopeDecision({ ok: false, data: valid }, NOW),
    "unavailable",
  );
  assert.equal(
    socialServiceEntitlementEnvelopeDecision({ ok: "true", data: valid }, NOW),
    "unavailable",
  );
  assert.equal(
    socialServiceEntitlementEnvelopeDecision({ ok: true, data: { data: valid } }, NOW),
    "unavailable",
  );
});

test("denials require the exact v1 reason and null verification capability", () => {
  const valid = access();
  const entitlement = valid.socialEntitlement as Record<string, unknown>;
  const denied = (overrides: Record<string, unknown>) => access({
    discordVerified: false,
    socialEntitlement: {
      ...entitlement,
      allowed: false,
      discordVerified: false,
      reason: "discord_verification_required",
      validUntil: null,
      ...overrides,
    },
  });

  assert.equal(socialServiceEntitlementDecision(denied({}), NOW), "denied");
  assert.equal(
    socialServiceEntitlementDecision(denied({ memberStatus: "pending", reason: "inactive_member" }), NOW),
    "unavailable",
  );
  assert.equal(
    socialServiceEntitlementDecision(
      access({
        memberStatus: "pending",
        discordVerified: false,
        profile: { member_status: "pending" },
        socialEntitlement: {
          ...entitlement,
          allowed: false,
          memberStatus: "pending",
          discordVerified: false,
          reason: "inactive_member",
          validUntil: null,
        },
      }),
      NOW,
    ),
    "denied",
  );

  for (const value of [
    denied({ reason: "manual_review" }),
    denied({ reason: "allowed" }),
    denied({ discordVerified: true }),
    denied({ validUntil: new Date(NOW + 60_000).toISOString() }),
    denied({ memberStatus: "pending", reason: "discord_verification_required" }),
  ]) {
    assert.equal(socialServiceEntitlementDecision(value, NOW), "unavailable");
  }
});

test("stale, future, malformed, and expired entitlement timestamps fail unavailable", () => {
  const valid = access();
  const entitlement = valid.socialEntitlement as Record<string, unknown>;
  const cases = [
    access({ socialEntitlement: { ...entitlement, evaluatedAt: "not-a-time" } }),
    access({ socialEntitlement: { ...entitlement, evaluatedAt: new Date(NOW - 300_001).toISOString() } }),
    access({ socialEntitlement: { ...entitlement, evaluatedAt: new Date(NOW + 30_001).toISOString() } }),
    access({
      socialEntitlement: {
        ...entitlement,
        evaluatedAt: new Date(NOW + 30_000).toISOString(),
        validUntil: new Date(NOW + 30_000).toISOString(),
      },
    }),
    access({ socialEntitlement: { ...entitlement, validUntil: new Date(NOW).toISOString() } }),
    access({ socialEntitlement: { ...entitlement, validUntil: "2026-08-12T02:01:00Z" } }),
  ];

  for (const value of cases) {
    assert.equal(socialServiceEntitlementDecision(value, NOW), "unavailable");
  }
});
