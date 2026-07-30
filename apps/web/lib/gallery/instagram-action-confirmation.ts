import { sha256Hex } from "./social-publication-confirmation.ts";
import {
  buildInstagramPublicationRequest,
  type InstagramPublicationRequest,
} from "./social-publication-request.ts";

type InstagramActionJob = {
  id?: unknown;
  status?: unknown;
  attemptCount?: unknown;
  updatedAt?: unknown;
};

export type InstagramReconciliationDraft = {
  resolution: "confirmed_published" | "confirmed_not_published" | "";
  note: string;
  instagramMediaId: string;
  instagramPermalink: string;
};

const INSTAGRAM_POST_CODE_RE = /^[A-Za-z0-9_-]+$/;

function clean(value: unknown, maximumLength: number): string {
  return String(value ?? "").normalize("NFC").trim().slice(0, maximumLength);
}

function jobState(job: InstagramActionJob) {
  const attemptCount = Number(job.attemptCount);
  return [
    clean(job.id, 80).toLowerCase(),
    clean(job.status, 40).toLowerCase(),
    Number.isSafeInteger(attemptCount) && attemptCount >= 0 ? attemptCount : -1,
    clean(job.updatedAt, 80),
  ] as const;
}

export function normalizeInstagramPostPermalink(value: unknown): string | null {
  const raw = clean(value, 1000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      (hostname !== "instagram.com" && hostname !== "www.instagram.com") ||
      url.username || url.password || url.port || url.hash
    ) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      segments.length !== 2 ||
      !["p", "reel"].includes(segments[0]) ||
      !INSTAGRAM_POST_CODE_RE.test(segments[1])
    ) return null;
    return `https://www.instagram.com/${segments[0]}/${segments[1]}/`;
  } catch {
    return null;
  }
}

export async function instagramPublishConfirmation(
  job: InstagramActionJob,
  moderatorUserId: string,
  caption: string,
  altText: string,
): Promise<InstagramPublicationRequest> {
  return buildInstagramPublicationRequest({
    job,
    moderatorUserId,
    primaryCopy: caption,
    altText,
  });
}

export async function instagramReconciliationFingerprint(
  job: InstagramActionJob,
  draft: InstagramReconciliationDraft,
): Promise<string> {
  return sha256Hex(JSON.stringify([
    "instagram-reconciliation-ui-v1",
    ...jobState(job),
    draft.resolution,
    clean(draft.note, 500),
    draft.resolution === "confirmed_published"
      ? clean(draft.instagramMediaId, 255)
      : "",
    draft.resolution === "confirmed_published"
      ? normalizeInstagramPostPermalink(draft.instagramPermalink) || "invalid"
      : "",
  ]));
}
