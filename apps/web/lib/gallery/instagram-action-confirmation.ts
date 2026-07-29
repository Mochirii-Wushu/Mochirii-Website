export type InstagramConfirmationAction =
  | "publish"
  | "reconcile-published"
  | "reconcile-not-published";

export type InstagramActionFingerprintInput = {
  jobId: string;
  status: string;
  attemptCount: number;
  action: InstagramConfirmationAction;
  caption?: string;
  altText?: string;
  mediaId?: string;
  permalink?: string;
  note?: string;
};

const INSTAGRAM_POST_CODE_RE = /^[A-Za-z0-9_-]+$/;

export function normalizeInstagramPostPermalink(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      (hostname !== "instagram.com" && hostname !== "www.instagram.com") ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
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

export function fingerprintInstagramAction(input: InstagramActionFingerprintInput) {
  const common = [
    input.jobId.trim(),
    input.status.trim().toLowerCase(),
    Math.max(0, Math.trunc(Number(input.attemptCount) || 0)),
    input.action,
  ];

  if (input.action === "publish") {
    return JSON.stringify([
      ...common,
      String(input.caption || "").trim().slice(0, 2200),
      String(input.altText || "").trim().slice(0, 1000),
    ]);
  }
  const evidencePermalink = input.action === "reconcile-published"
    ? normalizeInstagramPostPermalink(input.permalink) || String(input.permalink || "").trim().slice(0, 1000)
    : String(input.permalink || "").trim().slice(0, 1000);
  return JSON.stringify([
    ...common,
    String(input.mediaId || "").trim().slice(0, 255),
    evidencePermalink,
    String(input.note || "").trim().slice(0, 500),
  ]);
}
