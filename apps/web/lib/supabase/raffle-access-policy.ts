type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

export function verifiedClaimsSubject(value: unknown) {
  const claims = record(value);
  const subject = typeof claims.sub === "string" ? claims.sub.trim() : "";
  const role = typeof claims.role === "string" ? claims.role.trim() : "";
  if (!subject || role !== "authenticated" || claims.is_anonymous === true) return null;
  return subject;
}

export function freshGuildVerificationPasses(value: unknown) {
  const payload = record(value);
  return Boolean(
    payload.verified === true &&
      payload.hasGuildMembership === true &&
      payload.hasRequiredRoles === true &&
      payload.pending === false &&
      payload.memberStatus === "active",
  );
}

export function freshModeratorVerificationPasses(value: unknown) {
  const payload = record(value);
  const nested = record(payload.data);
  return payload.ok === true && payload.hasAccess === true && nested.hasAccess === true;
}

export type ClaimPageDecision = "redirect-auth" | "not-found" | "unavailable" | "claim";

export function claimPageDecision({
  authenticated,
  freshGuildMember,
  claimAvailable = false,
}: {
  authenticated: boolean;
  freshGuildMember: boolean;
  claimAvailable?: boolean;
}): ClaimPageDecision {
  if (!authenticated) return "redirect-auth";
  if (!freshGuildMember) return "not-found";
  return claimAvailable ? "claim" : "unavailable";
}

export type ModeratorPageDecision = "redirect-auth" | "not-found" | "moderator";

export function moderatorPageDecision({
  authenticated,
  freshModerator,
}: {
  authenticated: boolean;
  freshModerator: boolean;
}): ModeratorPageDecision {
  if (!authenticated) return "redirect-auth";
  return freshModerator ? "moderator" : "not-found";
}
