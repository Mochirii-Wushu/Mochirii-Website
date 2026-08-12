import { MEMBER_VERIFICATION_MAX_AGE_MS } from "./member-access-policy.ts";

export const SOCIAL_SERVICE_ENTITLEMENT_CONTRACT =
  "mochirii.social-service-entitlement" as const;
export const SOCIAL_SERVICE_ENTITLEMENT_VERSION = 1 as const;
export const SOCIAL_SERVICE = "social" as const;

export type SocialServiceEntitlementReason =
  | "allowed"
  | "inactive_member"
  | "discord_verification_required"
  | "discord_verification_invalid"
  | "discord_verification_stale";

export type SocialServiceEntitlementV1 = {
  contract: typeof SOCIAL_SERVICE_ENTITLEMENT_CONTRACT;
  version: typeof SOCIAL_SERVICE_ENTITLEMENT_VERSION;
  service: typeof SOCIAL_SERVICE;
  allowed: boolean;
  memberStatus: string | null;
  discordVerified: boolean;
  reason: SocialServiceEntitlementReason;
  evaluatedAt: string;
  validUntil: string | null;
};

function memberStatusValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function verificationWindow(
  value: unknown,
  evaluatedAtMs: number,
): {
  current: boolean;
  validUntil: string | null;
  reason: SocialServiceEntitlementReason;
} {
  if (typeof value !== "string" || value.length === 0) {
    return {
      current: false,
      validUntil: null,
      reason: "discord_verification_invalid",
    };
  }

  const verifiedAtMs = Date.parse(value);
  if (!Number.isFinite(verifiedAtMs) || verifiedAtMs > evaluatedAtMs) {
    return {
      current: false,
      validUntil: null,
      reason: "discord_verification_invalid",
    };
  }

  const validUntilMs = verifiedAtMs + MEMBER_VERIFICATION_MAX_AGE_MS;
  const validUntil = new Date(validUntilMs);
  if (!Number.isFinite(validUntil.getTime())) {
    return {
      current: false,
      validUntil: null,
      reason: "discord_verification_invalid",
    };
  }

  return {
    current: validUntilMs > evaluatedAtMs,
    validUntil: validUntil.toISOString(),
    reason: validUntilMs > evaluatedAtMs
      ? "allowed"
      : "discord_verification_stale",
  };
}

export function buildSocialServiceEntitlement({
  memberStatus,
  discordVerified,
  discordVerifiedAt,
  evaluatedAtMs = Date.now(),
}: {
  memberStatus: unknown;
  discordVerified: unknown;
  discordVerifiedAt: unknown;
  evaluatedAtMs?: number;
}): SocialServiceEntitlementV1 {
  const evaluatedAt = new Date(evaluatedAtMs);
  if (
    !Number.isFinite(evaluatedAtMs) || !Number.isFinite(evaluatedAt.getTime())
  ) {
    throw new TypeError("Social entitlement evaluation time must be finite.");
  }

  const normalizedMemberStatus = memberStatusValue(memberStatus);
  const exactDiscordVerified = discordVerified === true;
  const verification = verificationWindow(discordVerifiedAt, evaluatedAtMs);

  const allowed = normalizedMemberStatus === "active" &&
    exactDiscordVerified && verification.current;

  let reason: SocialServiceEntitlementReason;
  if (normalizedMemberStatus !== "active") {
    reason = "inactive_member";
  } else if (allowed) {
    reason = "allowed";
  } else if (!exactDiscordVerified && verification.reason === "allowed") {
    reason = "discord_verification_required";
  } else {
    reason = verification.reason;
  }

  return {
    contract: SOCIAL_SERVICE_ENTITLEMENT_CONTRACT,
    version: SOCIAL_SERVICE_ENTITLEMENT_VERSION,
    service: SOCIAL_SERVICE,
    allowed,
    memberStatus: normalizedMemberStatus,
    discordVerified: allowed,
    reason,
    evaluatedAt: evaluatedAt.toISOString(),
    validUntil: allowed ? verification.validUntil : null,
  };
}
