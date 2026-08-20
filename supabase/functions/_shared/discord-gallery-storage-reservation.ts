type JsonRecord = Record<string, unknown>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATUS_RE = /^(?:pending|approved|rejected|archived)$/;

export type DiscordGalleryReadySubmission = {
  submissionId: string;
  status: string;
  createdAt: string;
};

export type DiscordGalleryReservationAcquisition =
  | ({ outcome: "ready" } & DiscordGalleryReadySubmission)
  | {
    outcome: "acquired";
    leaseToken: string;
    leaseExpiresAt: string;
    storagePath: string;
  }
  | { outcome: "busy" | "conflict" | "invalid" | "tombstoned" };

export type DiscordGalleryUploadConfirmation =
  | { outcome: "confirmed" }
  | {
    outcome:
      | "busy"
      | "invalid"
      | "missing"
      | "object_mismatch"
      | "ready";
  };

export type DiscordGalleryReservationFinalization =
  | ({ outcome: "created" | "ready" } & DiscordGalleryReadySubmission)
  | {
    outcome:
      | "busy"
      | "conflict"
      | "invalid"
      | "missing"
      | "object_changed";
  };

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function exactString(record: JsonRecord, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

function parseReady(record: JsonRecord): DiscordGalleryReadySubmission | null {
  const submissionId = exactString(record, "submissionId");
  const status = exactString(record, "status");
  const createdAt = exactString(record, "createdAt");
  if (
    !submissionId || !UUID_RE.test(submissionId) || !status ||
    !STATUS_RE.test(status) || !createdAt ||
    !Number.isFinite(Date.parse(createdAt))
  ) return null;
  return { submissionId, status, createdAt };
}

function extensionForMime(mimeType: string): string | null {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return null;
}

export function parseDiscordGalleryReservationAcquisition(
  value: unknown,
  expectedUserId: string,
  expectedMimeType: string,
): DiscordGalleryReservationAcquisition | null {
  const record = asRecord(value);
  const outcome = record && exactString(record, "outcome");
  if (!record || !outcome) return null;
  if (["busy", "conflict", "invalid", "tombstoned"].includes(outcome)) {
    return { outcome } as DiscordGalleryReservationAcquisition;
  }
  if (outcome === "ready") {
    const ready = parseReady(record);
    return ready ? { outcome, ...ready } : null;
  }
  if (outcome !== "acquired" || !UUID_RE.test(expectedUserId)) return null;

  const leaseToken = exactString(record, "leaseToken");
  const leaseExpiresAt = exactString(record, "leaseExpiresAt");
  const storagePath = exactString(record, "storagePath");
  const extension = extensionForMime(expectedMimeType);
  const expectedStoragePath = leaseToken && extension
    ? `${expectedUserId}/discord-ingest/${leaseToken}.${extension}`
    : null;
  if (
    !leaseToken || !UUID_RE.test(leaseToken) || !leaseExpiresAt ||
    !Number.isFinite(Date.parse(leaseExpiresAt)) || !storagePath ||
    !expectedStoragePath || storagePath !== expectedStoragePath
  ) return null;

  return { outcome, leaseToken, leaseExpiresAt, storagePath };
}

export function parseDiscordGalleryUploadConfirmation(
  value: unknown,
): DiscordGalleryUploadConfirmation | null {
  const record = asRecord(value);
  const outcome = record && exactString(record, "outcome");
  return outcome && [
      "confirmed",
      "busy",
      "invalid",
      "missing",
      "object_mismatch",
      "ready",
    ].includes(outcome)
    ? { outcome } as DiscordGalleryUploadConfirmation
    : null;
}

export function parseDiscordGalleryReservationFinalization(
  value: unknown,
): DiscordGalleryReservationFinalization | null {
  const record = asRecord(value);
  const outcome = record && exactString(record, "outcome");
  if (!record || !outcome) return null;
  if (
    ["busy", "conflict", "invalid", "missing", "object_changed"].includes(
      outcome,
    )
  ) {
    return { outcome } as DiscordGalleryReservationFinalization;
  }
  if (outcome !== "created" && outcome !== "ready") return null;
  const ready = parseReady(record);
  return ready ? { outcome, ...ready } : null;
}
