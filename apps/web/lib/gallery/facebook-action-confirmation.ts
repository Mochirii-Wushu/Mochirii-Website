import { sha256Hex } from "./social-publication-confirmation.ts";
import {
  buildFacebookPagePublicationRequest,
  type FacebookPagePublicationRequest,
} from "./social-publication-request.ts";

type FacebookActionJob = {
  id?: unknown;
  status?: unknown;
  attemptCount?: unknown;
  updatedAt?: unknown;
};

const FACEBOOK_PERMALINK_HOSTS = new Set(["facebook.com", "www.facebook.com"]);

export function normalizeFacebookPermalink(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 1000 || raw.includes("#") || /[\u0000-\u0020\u007f]/.test(raw)) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" || url.username || url.password || url.port ||
      !FACEBOOK_PERMALINK_HOSTS.has(url.hostname.toLowerCase()) ||
      /%(?:2f|5c)/i.test(url.pathname)
    ) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const safe = (segment: string, max = 255) =>
      segment.length <= max && /^[A-Za-z0-9_.:-]+$/.test(segment);
    url.hostname = "www.facebook.com";
    if (
      segments.length === 3 && segments[1] === "posts" &&
      safe(segments[0], 100) && safe(segments[2])
    ) {
      url.pathname = `/${segments.join("/")}`;
      url.search = "";
    } else if (
      segments.length >= 3 && segments.length <= 5 && segments[1] === "photos" &&
      segments.every((segment, index) => safe(segment, index === 0 ? 100 : 255))
    ) {
      url.pathname = `/${segments.join("/")}`;
      url.search = "";
    } else if (segments.length === 1 && ["photo", "photo.php"].includes(segments[0])) {
      const fbid = url.searchParams.getAll("fbid");
      const set = url.searchParams.getAll("set");
      if (fbid.length !== 1 || !safe(fbid[0]) || set.length > 1 || (set[0] && !safe(set[0]))) return null;
      url.pathname = "/photo.php";
      url.search = "";
      url.searchParams.set("fbid", fbid[0]);
      if (set[0]) url.searchParams.set("set", set[0]);
    } else if (segments.length === 1 && ["story.php", "permalink.php"].includes(segments[0])) {
      const story = url.searchParams.getAll("story_fbid");
      const page = url.searchParams.getAll("id");
      if (story.length !== 1 || page.length !== 1 || !safe(story[0]) || !safe(page[0], 100)) return null;
      url.pathname = `/${segments[0]}`;
      url.search = "";
      url.searchParams.set("story_fbid", story[0]);
      url.searchParams.set("id", page[0]);
    } else {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export type FacebookReconciliationDraft = {
  resolution: "confirmed_published" | "confirmed_not_published" | "";
  note: string;
  facebookPhotoId: string;
  facebookPostId: string;
  facebookPermalink: string;
};

function clean(value: unknown, maximumLength: number): string {
  return String(value ?? "").normalize("NFC").trim().slice(0, maximumLength);
}

function jobState(job: FacebookActionJob) {
  const attemptCount = Number(job.attemptCount);
  return [
    clean(job.id, 80).toLowerCase(),
    clean(job.status, 40).toLowerCase(),
    Number.isSafeInteger(attemptCount) && attemptCount >= 0 ? attemptCount : -1,
    clean(job.updatedAt, 80),
  ] as const;
}

export async function facebookPagePublishConfirmation(
  job: FacebookActionJob,
  moderatorUserId: string,
  message: string,
): Promise<FacebookPagePublicationRequest> {
  return buildFacebookPagePublicationRequest({
    job,
    moderatorUserId,
    primaryCopy: message,
  });
}

export async function facebookPageReconciliationFingerprint(
  job: FacebookActionJob,
  draft: FacebookReconciliationDraft,
): Promise<string> {
  return sha256Hex(JSON.stringify([
    "facebook-page-reconciliation-ui-v1",
    ...jobState(job),
    draft.resolution,
    clean(draft.note, 500),
    draft.resolution === "confirmed_published" ? clean(draft.facebookPhotoId, 255) : "",
    draft.resolution === "confirmed_published" ? clean(draft.facebookPostId, 255) : "",
    draft.resolution === "confirmed_published" ? clean(draft.facebookPermalink, 1000) : "",
  ]));
}
