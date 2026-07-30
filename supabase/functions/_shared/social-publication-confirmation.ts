export type SocialPublicationDestination = "facebook_page" | "instagram";

export type SocialConfirmationState = {
  destination: SocialPublicationDestination;
  jobId: string;
  status: string;
  attemptCount: number;
  updatedAt: string;
  moderatorUserId: string;
  primaryCopy: string | null | undefined;
  altText?: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATUS_RE = /^[a-z][a-z0-9_]{0,39}$/;
const TIMESTAMPTZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .trim();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function validateState(values: SocialConfirmationState): string {
  if (
    !UUID_RE.test(values.jobId) ||
    !UUID_RE.test(values.moderatorUserId) ||
    !STATUS_RE.test(values.status) ||
    !Number.isSafeInteger(values.attemptCount) ||
    values.attemptCount < 0 ||
    !TIMESTAMPTZ_RE.test(values.updatedAt) ||
    !Number.isFinite(Date.parse(values.updatedAt))
  ) {
    throw new TypeError(
      "The social publication confirmation state is invalid.",
    );
  }
  const canonicalUpdatedAt = new Date(values.updatedAt).toISOString();
  if (!canonicalUpdatedAt) {
    throw new TypeError(
      "The social publication confirmation timestamp is invalid.",
    );
  }
  return canonicalUpdatedAt;
}

export async function socialPublicationCopyHash(
  values: Pick<
    SocialConfirmationState,
    "destination" | "primaryCopy" | "altText"
  >,
): Promise<string> {
  return await sha256Hex(JSON.stringify([
    "gallery-social-copy-v1",
    values.destination,
    normalizedText(values.primaryCopy),
    normalizedText(values.altText),
  ]));
}

export async function socialPublicationConfirmationFingerprint(
  values: SocialConfirmationState,
): Promise<{ copyHash: string; fingerprint: string }> {
  const canonicalUpdatedAt = validateState(values);
  const copyHash = await socialPublicationCopyHash(values);
  const fingerprint = await sha256Hex(JSON.stringify([
    "gallery-social-confirmation-v1",
    values.destination,
    values.jobId,
    values.status,
    values.attemptCount,
    canonicalUpdatedAt,
    values.moderatorUserId,
    copyHash,
  ]));
  return { copyHash, fingerprint };
}

export function socialPublicationFingerprintLooksValid(
  value: unknown,
): value is string {
  return SHA256_RE.test(String(value ?? ""));
}

export function constantTimeHexEqual(left: unknown, right: unknown): boolean {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (!SHA256_RE.test(a) || !SHA256_RE.test(b)) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
