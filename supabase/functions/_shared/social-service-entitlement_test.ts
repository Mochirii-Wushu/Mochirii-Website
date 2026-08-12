import {
  buildSocialServiceEntitlement,
  SOCIAL_SERVICE_ENTITLEMENT_CONTRACT,
  SOCIAL_SERVICE_ENTITLEMENT_VERSION,
} from "./social-service-entitlement.ts";
import {
  currentMemberAccess,
  MEMBER_VERIFICATION_MAX_AGE_MS,
} from "./member-access-policy.ts";

const NOW = Date.parse("2026-08-12T02:00:00.000Z");
const VERIFIED_AT = new Date(NOW - 1_000).toISOString();

Deno.test("Social entitlement v1 allows only an active currently Discord-verified member", () => {
  const entitlement = buildSocialServiceEntitlement({
    memberStatus: "active",
    discordVerified: true,
    discordVerifiedAt: VERIFIED_AT,
    evaluatedAtMs: NOW,
  });

  assert(entitlement.contract === SOCIAL_SERVICE_ENTITLEMENT_CONTRACT);
  assert(entitlement.version === SOCIAL_SERVICE_ENTITLEMENT_VERSION);
  assert(entitlement.service === "social");
  assert(entitlement.allowed === true);
  assert(entitlement.memberStatus === "active");
  assert(entitlement.discordVerified === true);
  assert(entitlement.reason === "allowed");
  assert(entitlement.evaluatedAt === new Date(NOW).toISOString());
  assert(
    entitlement.validUntil ===
      new Date(Date.parse(VERIFIED_AT) + MEMBER_VERIFICATION_MAX_AGE_MS)
        .toISOString(),
  );
});

Deno.test("manual Gallery approval never grants the Social entitlement", () => {
  const manualAccess = currentMemberAccess({
    profile: { member_status: "active" },
    verification: {
      gallery_access_status: "approved",
      gallery_access_verified_at: new Date(NOW - 1_000).toISOString(),
      gallery_access_expires_at: new Date(NOW + 60_000).toISOString(),
    },
    trustedDiscordUserId: null,
    nowMs: NOW,
  });
  assert(manualAccess.eligible === true);
  assert(manualAccess.manualApproved === true);
  assert(manualAccess.discordVerified === false);

  const entitlement = buildSocialServiceEntitlement({
    memberStatus: "active",
    discordVerified: manualAccess.discordVerified,
    discordVerifiedAt: null,
    evaluatedAtMs: NOW,
  });
  assert(entitlement.allowed === false);
  assert(entitlement.reason === "discord_verification_invalid");
});

Deno.test("Social entitlement rejects inactive, inexact, future, and stale evidence", () => {
  const cases = [
    {
      memberStatus: "pending",
      discordVerified: true,
      discordVerifiedAt: VERIFIED_AT,
    },
    {
      memberStatus: "suspended",
      discordVerified: true,
      discordVerifiedAt: VERIFIED_AT,
    },
    {
      memberStatus: "archived",
      discordVerified: true,
      discordVerifiedAt: VERIFIED_AT,
    },
    {
      memberStatus: "Active",
      discordVerified: true,
      discordVerifiedAt: VERIFIED_AT,
    },
    {
      memberStatus: "active ",
      discordVerified: true,
      discordVerifiedAt: VERIFIED_AT,
    },
    {
      memberStatus: "active",
      discordVerified: "true",
      discordVerifiedAt: VERIFIED_AT,
    },
    {
      memberStatus: "active",
      discordVerified: 1,
      discordVerifiedAt: VERIFIED_AT,
    },
    {
      memberStatus: "active",
      discordVerified: true,
      discordVerifiedAt: new Date(NOW + 1).toISOString(),
    },
    {
      memberStatus: "active",
      discordVerified: true,
      discordVerifiedAt: new Date(
        NOW - MEMBER_VERIFICATION_MAX_AGE_MS - 1,
      ).toISOString(),
    },
    {
      memberStatus: "active",
      discordVerified: true,
      discordVerifiedAt: new Date(
        NOW - MEMBER_VERIFICATION_MAX_AGE_MS,
      ).toISOString(),
    },
  ];

  for (const input of cases) {
    assert(
      buildSocialServiceEntitlement({ ...input, evaluatedAtMs: NOW })
        .allowed === false,
      `Social entitlement should fail closed: ${JSON.stringify(input)}`,
    );
  }
});

Deno.test("Social entitlement emits one exact fail-closed denial shape", () => {
  const inactive = buildSocialServiceEntitlement({
    memberStatus: "suspended",
    discordVerified: true,
    discordVerifiedAt: VERIFIED_AT,
    evaluatedAtMs: NOW,
  });
  assert(inactive.allowed === false);
  assert(inactive.discordVerified === false);
  assert(inactive.reason === "inactive_member");
  assert(inactive.validUntil === null);

  const required = buildSocialServiceEntitlement({
    memberStatus: "active",
    discordVerified: false,
    discordVerifiedAt: VERIFIED_AT,
    evaluatedAtMs: NOW,
  });
  assert(required.reason === "discord_verification_required");
  assert(required.validUntil === null);

  const invalid = buildSocialServiceEntitlement({
    memberStatus: "active",
    discordVerified: false,
    discordVerifiedAt: null,
    evaluatedAtMs: NOW,
  });
  assert(invalid.reason === "discord_verification_invalid");

  const stale = buildSocialServiceEntitlement({
    memberStatus: "active",
    discordVerified: false,
    discordVerifiedAt: new Date(
      NOW - MEMBER_VERIFICATION_MAX_AGE_MS - 1,
    ).toISOString(),
    evaluatedAtMs: NOW,
  });
  assert(stale.reason === "discord_verification_stale");
});

Deno.test("Social entitlement rejects invalid evaluation dates before serialization", () => {
  for (const evaluatedAtMs of [Number.NaN, Number.POSITIVE_INFINITY, 9e15]) {
    let rejected = false;
    try {
      buildSocialServiceEntitlement({
        memberStatus: "active",
        discordVerified: true,
        discordVerifiedAt: VERIFIED_AT,
        evaluatedAtMs,
      });
    } catch (error) {
      rejected = error instanceof TypeError;
    }
    assert(
      rejected,
      `Expected invalid evaluation time to reject: ${evaluatedAtMs}`,
    );
  }
});

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
