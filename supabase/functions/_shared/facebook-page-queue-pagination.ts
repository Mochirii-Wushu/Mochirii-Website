export const FACEBOOK_PAGE_QUEUE_DEFAULT_PAGE_SIZE = 25;
export const FACEBOOK_PAGE_QUEUE_MAX_PAGE_SIZE = 50;
export const FACEBOOK_PAGE_QUEUE_STATUSES = [
  "queued",
  "ineligible",
  "publishing",
  "published",
  "failed",
  "reconcile_required",
  "canceled",
] as const;

export type FacebookPageQueueStatus =
  | (typeof FACEBOOK_PAGE_QUEUE_STATUSES)[number]
  | "all";

export type FacebookPageQueueCursor = {
  updatedAt: string;
  id: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CURSOR_RE = /^[A-Za-z0-9_-]+$/;
const MAX_CURSOR_LENGTH = 512;

export function parseFacebookPageQueueStatus(
  value: unknown,
): FacebookPageQueueStatus | null {
  if (value === undefined || value === null || value === "") return "queued";
  if (typeof value !== "string") return null;
  const status = value.trim().toLowerCase();
  return status === "all" ||
      FACEBOOK_PAGE_QUEUE_STATUSES.includes(
        status as (typeof FACEBOOK_PAGE_QUEUE_STATUSES)[number],
      )
    ? status as FacebookPageQueueStatus
    : null;
}

export function parseFacebookPageQueuePageSize(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return FACEBOOK_PAGE_QUEUE_DEFAULT_PAGE_SIZE;
  }
  const pageSize = typeof value === "number" ? value : Number.NaN;
  return Number.isSafeInteger(pageSize) &&
      pageSize >= 1 &&
      pageSize <= FACEBOOK_PAGE_QUEUE_MAX_PAGE_SIZE
    ? pageSize
    : null;
}

function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 50) return null;
  if (!TIMESTAMPTZ_RE.test(value) || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  return value;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/u,
    "",
  );
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = `${base64}${"=".repeat((4 - base64.length % 4) % 4)}`;
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function encodeFacebookPageQueueCursor(
  status: FacebookPageQueueStatus,
  cursor: FacebookPageQueueCursor,
): string {
  const updatedAt = canonicalTimestamp(cursor.updatedAt);
  if (!updatedAt || !UUID_RE.test(cursor.id)) {
    throw new Error("Cannot encode an invalid Facebook Page queue cursor.");
  }
  return encodeBase64Url(
    JSON.stringify({ v: 1, s: status, u: updatedAt, i: cursor.id }),
  );
}

export function decodeFacebookPageQueueCursor(
  value: unknown,
  expectedStatus: FacebookPageQueueStatus,
): FacebookPageQueueCursor | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > MAX_CURSOR_LENGTH ||
    !CURSOR_RE.test(value)
  ) {
    throw new Error("Invalid Facebook Page queue cursor.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(value));
  } catch {
    throw new Error("Invalid Facebook Page queue cursor.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid Facebook Page queue cursor.");
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "i,s,u,v") {
    throw new Error("Invalid Facebook Page queue cursor.");
  }
  const updatedAt = canonicalTimestamp(record.u);
  if (
    record.v !== 1 ||
    record.s !== expectedStatus ||
    !updatedAt ||
    typeof record.i !== "string" ||
    !UUID_RE.test(record.i)
  ) {
    throw new Error("Invalid Facebook Page queue cursor.");
  }
  return { updatedAt, id: record.i };
}
