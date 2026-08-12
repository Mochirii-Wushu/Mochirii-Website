import type {
  MemberAccessResponse,
  SocialServiceEntitlementV1,
} from "./types";

export const SOCIAL_SERVICE_ENTITLEMENT_CONTRACT =
  "mochirii.social-service-entitlement" as const;
export const SOCIAL_SERVICE_ENTITLEMENT_VERSION = 1 as const;
export const SOCIAL_SERVICE_ENTITLEMENT_RESPONSE_MAX_AGE_MS = 5 * 60 * 1_000;
const CLOCK_SKEW_MS = 30 * 1_000;
const MAX_VERIFICATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const ENTITLEMENT_KEYS = [
  "allowed",
  "contract",
  "discordVerified",
  "evaluatedAt",
  "memberStatus",
  "reason",
  "service",
  "validUntil",
  "version",
] as const;
const DENIAL_REASONS = new Set([
  "inactive_member",
  "discord_verification_required",
  "discord_verification_invalid",
  "discord_verification_stale",
]);

export type SocialServiceEntitlementDecision =
  | "allowed"
  | "denied"
  | "unavailable";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}

function entitlementFromAccess(
  access: Record<string, unknown>,
  nowMs: number,
): SocialServiceEntitlementV1 | null {
  const entitlement = record(access.socialEntitlement);
  const profile = record(access.profile);
  if (!entitlement || !profile || !Number.isFinite(nowMs)) return null;

  if (
    JSON.stringify(Object.keys(entitlement).sort()) !==
      JSON.stringify([...ENTITLEMENT_KEYS].sort())
  ) {
    return null;
  }

  if (
    entitlement.contract !== SOCIAL_SERVICE_ENTITLEMENT_CONTRACT ||
    entitlement.version !== SOCIAL_SERVICE_ENTITLEMENT_VERSION ||
    entitlement.service !== "social" ||
    typeof entitlement.allowed !== "boolean" ||
    (typeof entitlement.memberStatus !== "string" &&
      entitlement.memberStatus !== null) ||
    typeof entitlement.discordVerified !== "boolean" ||
    typeof entitlement.reason !== "string"
  ) {
    return null;
  }

  const evaluatedAtMs = canonicalTimestamp(entitlement.evaluatedAt);
  if (
    evaluatedAtMs === null ||
    evaluatedAtMs > nowMs + CLOCK_SKEW_MS ||
    nowMs - evaluatedAtMs > SOCIAL_SERVICE_ENTITLEMENT_RESPONSE_MAX_AGE_MS
  ) {
    return null;
  }

  let validUntilMs: number | null = null;
  if (entitlement.validUntil !== null) {
    validUntilMs = canonicalTimestamp(entitlement.validUntil);
    if (
      validUntilMs === null ||
      validUntilMs <= evaluatedAtMs ||
      validUntilMs > evaluatedAtMs + MAX_VERIFICATION_WINDOW_MS
    ) {
      return null;
    }
  }

  if (
    access.memberStatus !== entitlement.memberStatus ||
    profile.member_status !== entitlement.memberStatus ||
    access.discordVerified !== entitlement.discordVerified
  ) {
    return null;
  }

  if (entitlement.allowed) {
    if (
      entitlement.memberStatus !== "active" ||
      entitlement.discordVerified !== true ||
      entitlement.reason !== "allowed" ||
      validUntilMs === null ||
      validUntilMs <= nowMs
    ) {
      return null;
    }
  } else {
    if (
      entitlement.discordVerified !== false ||
      entitlement.validUntil !== null ||
      !DENIAL_REASONS.has(entitlement.reason)
    ) {
      return null;
    }
    if (
      (entitlement.memberStatus === "active") ===
        (entitlement.reason === "inactive_member")
    ) {
      return null;
    }
  }

  return entitlement as unknown as SocialServiceEntitlementV1;
}

export function socialServiceEntitlementDecision(
  value: unknown,
  nowMs = Date.now(),
): SocialServiceEntitlementDecision {
  const access = record(value);
  if (!access) return "unavailable";
  const entitlement = entitlementFromAccess(access, nowMs);
  if (!entitlement) return "unavailable";
  return entitlement.allowed ? "allowed" : "denied";
}

export function socialServiceEntitlementEnvelopeDecision(
  value: unknown,
  nowMs = Date.now(),
): SocialServiceEntitlementDecision {
  const envelope = record(value);
  if (!envelope || envelope.ok !== true) return "unavailable";
  return socialServiceEntitlementDecision(envelope.data, nowMs);
}

export function socialServiceEntitlementAllowsAccess(
  value: MemberAccessResponse | unknown,
  nowMs = Date.now(),
): boolean {
  return socialServiceEntitlementDecision(value, nowMs) === "allowed";
}
