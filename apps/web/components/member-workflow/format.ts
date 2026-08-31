import { DISCORD_REQUIRED_ROLE_NAMES } from "@/lib/supabase/config";
import { hasRecentVerification, signedInName } from "@/lib/supabase/profile";
import { text, type GallerySubmission, type MemberAccessResponse, type MemberProfile } from "@/lib/supabase/types";
import { formatPublicDate, formatPublicDateTime } from "@/lib/public-date";
import type { User } from "@supabase/supabase-js";

export const editableProfileFields = [
  "display_name",
  "game_uid",
  "region",
  "timezone",
  "bio",
] as const;

export const coreProfileFields = [
  ["display_name", "Display name"],
  ["game_uid", "Game UID"],
  ["region", "Region"],
  ["timezone", "Timezone"],
] as const;

export const optionalProfileFields = [
  ["bio", "Bio"],
] as const;

export const submissionStatuses = ["pending", "approved", "rejected", "archived"] as const;

export function prettyStatus(status: unknown) {
  const value = text(status, "pending").toLowerCase();
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export function formatDate(value: unknown, fallback = "Not checked") {
  if (!value) return fallback;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return fallback;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return formatPublicDateTime(date, timeZone);
}

export function formatDateShort(value: unknown, fallback = "Not set") {
  if (!value) return fallback;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return fallback;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return formatPublicDate(date, timeZone);
}

export function formatBytes(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown size";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export function displayName(user: User | null, profile?: MemberProfile | null) {
  return profile?.display_name || signedInName(user, profile);
}

export function uploadAccess(profile?: MemberProfile | null, accessState?: MemberAccessResponse | null) {
  const status = text(profile?.member_status, "pending").toLowerCase();
  const hasRoles = profile?.has_required_discord_roles === true;
  const recent = hasRecentVerification(profile);
  const manualApproved = accessState?.manualApproved === true;
  const galleryEligible = accessState?.galleryEligible === true;
  const roleNames = [...DISCORD_REQUIRED_ROLE_NAMES];

  if (status === "suspended" || status === "archived") {
    return {
      ok: false,
      label: prettyStatus(status),
      tone: "danger",
      next: "Contact leadership if this status looks wrong.",
      guidance: "Gallery upload access is unavailable for this member status.",
    };
  }

  if (status === "active" && galleryEligible && manualApproved) {
    return {
      ok: true,
      label: "Approved by review",
      tone: "active",
      next: "Submit an image or review your gallery submission history.",
      guidance: "Gallery upload access is available from moderator-approved member verification.",
    };
  }

  if (!hasRoles) {
    return {
      ok: false,
      label: accessState?.verification?.status === "pending_review" ? "Review pending" : "Missing required roles",
      tone: "warning",
      next: accessState?.next || "Complete Discord verification or ask leadership to review your member verification.",
      guidance: accessState?.message || `Upload access needs both Discord roles: ${roleNames.join(" and ")} or moderator approval.`,
    };
  }

  if (!recent) {
    return {
      ok: false,
      label: "Verification expired",
      tone: "warning",
      next: "Run Check Verification to refresh your Discord role status.",
      guidance: "Your required roles were found before, but the website needs a recent Discord check before upload.",
    };
  }

  if (status !== "active") {
    return {
      ok: false,
      label: `${prettyStatus(status)} member status`,
      tone: "pending",
      next: "Wait for leadership to activate your website member status.",
      guidance: "Discord roles are verified, but upload access also needs active website member status.",
    };
  }

  return {
    ok: true,
    label: "Ready to upload",
    tone: "active",
    next: "Submit an image or review your gallery submission history.",
    guidance: "Gallery upload access is available.",
  };
}

export function profileCompletion(profile?: MemberProfile | null) {
  const missing = coreProfileFields
    .filter(([field]) => !text(profile?.[field], ""))
    .map(([, label]) => label);
  const optionalComplete = optionalProfileFields.filter(([field]) => text(profile?.[field], "")).length;
  const complete = coreProfileFields.length - missing.length;
  const percent = Math.round((complete / coreProfileFields.length) * 100);

  return {
    complete,
    total: coreProfileFields.length,
    percent,
    missing,
    optionalComplete,
  };
}

export function countSubmissions(submissions: GallerySubmission[]) {
  const counts: Record<string, number> = { total: submissions.length };
  submissionStatuses.forEach((status) => {
    counts[status] = 0;
  });

  submissions.forEach((submission) => {
    const status = text(submission.status, "pending").toLowerCase();
    if (Object.hasOwn(counts, status)) counts[status] += 1;
  });

  return counts;
}
