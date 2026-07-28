export const RAFFLE_LEADERBOARD_MAX_ROWS = 250;
export const RAFFLE_LEADERBOARD_MAX_SKEW_SECONDS = 60;
export const RAFFLE_LEADERBOARD_HMAC_ENV =
  "MOCHIRII_RAFFLE_LEADERBOARD_HMAC_SECRET";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP_RE = /^[1-9][0-9]{9}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const SIGNATURE_RE = /^v1=([0-9a-f]{64})$/;
const CYCLE_ID_RE = /^[a-z0-9][a-z0-9-]{5,63}$/;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const BIDI_CONTROL_RE = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export type RaffleLeaderboardEntry = {
  rank: number;
  displayName: string;
  entryCount: number;
  isViewer: boolean;
};

export type RaffleLeaderboard = {
  cyclePublicId: string;
  cycleStatus: "ready" | "open" | "frozen" | "drawn" | "complete";
  closesAt: string;
  drawAt: string;
  maximumEntries: 10;
  participantCount: number;
  entries: RaffleLeaderboardEntry[];
};

export type SocialLeaderboardVerification =
  | { ok: true; subject: string }
  | {
    ok: false;
    status: 401 | 503;
    error: "not_configured" | "invalid_request" | "replayed_request";
  };

export type SocialLeaderboardVerificationDependencies = {
  secret: string;
  nowMs?: number;
  consumeNonce: (
    subject: string,
    nonce: string,
    expiresAt: string,
  ) => Promise<boolean>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index]);
}

function parseInstant(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function parseRaffleLeaderboard(
  value: unknown,
): RaffleLeaderboard | null {
  const record = asRecord(value);
  if (
    !exactKeys(record, [
      "closesAt",
      "cyclePublicId",
      "cycleStatus",
      "drawAt",
      "entries",
      "maximumEntries",
      "participantCount",
    ])
  ) return null;

  const cyclePublicId = typeof record.cyclePublicId === "string"
    ? record.cyclePublicId
    : "";
  const cycleStatus = record.cycleStatus;
  const closesAt = parseInstant(record.closesAt);
  const drawAt = parseInstant(record.drawAt);
  const participantCount = Number(record.participantCount);
  if (
    !CYCLE_ID_RE.test(cyclePublicId) ||
    !["ready", "open", "frozen", "drawn", "complete"].includes(
      String(cycleStatus),
    ) ||
    !closesAt ||
    !drawAt ||
    Date.parse(closesAt) >= Date.parse(drawAt) ||
    record.maximumEntries !== 10 ||
    !Number.isSafeInteger(participantCount) ||
    participantCount < 0 ||
    participantCount > 10_000 ||
    !Array.isArray(record.entries) ||
    record.entries.length > RAFFLE_LEADERBOARD_MAX_ROWS ||
    participantCount < record.entries.length
  ) return null;

  let viewerRows = 0;
  let previousRank = 0;
  let previousEntryCount = Number.POSITIVE_INFINITY;
  const entries: RaffleLeaderboardEntry[] = [];
  for (const value of record.entries) {
    const entry = asRecord(value);
    if (
      !exactKeys(entry, ["displayName", "entryCount", "isViewer", "rank"])
    ) return null;
    const rank = Number(entry.rank);
    const entryCount = Number(entry.entryCount);
    const displayName = typeof entry.displayName === "string"
      ? entry.displayName.trim()
      : "";
    if (
      !Number.isSafeInteger(rank) ||
      rank < 1 ||
      rank > participantCount ||
      !Number.isSafeInteger(entryCount) ||
      entryCount < 1 ||
      entryCount > 10 ||
      [...displayName].length < 2 ||
      [...displayName].length > 40 ||
      CONTROL_CHARACTER_RE.test(displayName) ||
      BIDI_CONTROL_RE.test(displayName) ||
      typeof entry.isViewer !== "boolean"
    ) return null;
    if (
      (entries.length === 0 && rank !== 1) ||
      (entries.length > 0 && entryCount > previousEntryCount) ||
      (entries.length > 0 && entryCount === previousEntryCount &&
        rank !== previousRank) ||
      (entries.length > 0 && entryCount < previousEntryCount &&
        rank !== previousRank + 1)
    ) return null;
    if (entry.isViewer) viewerRows += 1;
    entries.push({ rank, displayName, entryCount, isViewer: entry.isViewer });
    previousRank = rank;
    previousEntryCount = entryCount;
  }
  if (viewerRows > 1) return null;

  return {
    cyclePublicId,
    cycleStatus: cycleStatus as RaffleLeaderboard["cycleStatus"],
    closesAt,
    drawAt,
    maximumEntries: 10,
    participantCount,
    entries,
  };
}

export function socialLeaderboardCanonicalBytes(
  subject: string,
  unixTimestamp: string,
  nonce: string,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    ["v1", subject, unixTimestamp, nonce].join("\n"),
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function raffleLeaderboardHmacHex(
  secret: string,
  subject: string,
  unixTimestamp: string,
  nonce: string,
): Promise<string> {
  const secretBytes = new TextEncoder().encode(secret);
  if (secretBytes.byteLength < 32) {
    throw new Error("leaderboard_hmac_too_short");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    socialLeaderboardCanonicalBytes(subject, unixTimestamp, nonce),
  );
  return bytesToHex(new Uint8Array(signature));
}

export function constantTimeLowerHexMatches(
  expected: string,
  actual: string,
): boolean {
  if (
    expected.length !== actual.length ||
    !/^[0-9a-f]+$/.test(expected) ||
    !/^[0-9a-f]+$/.test(actual)
  ) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifySocialLeaderboardRequest(
  headers: Headers,
  body: unknown,
  dependencies: SocialLeaderboardVerificationDependencies,
): Promise<SocialLeaderboardVerification> {
  if (new TextEncoder().encode(dependencies.secret).byteLength < 32) {
    return { ok: false, status: 503, error: "not_configured" };
  }

  const bodyRecord = asRecord(body);
  const subject = typeof bodyRecord.sub === "string" ? bodyRecord.sub : "";
  const timestamp = headers.get("x-mochirii-raffle-timestamp") || "";
  const nonce = headers.get("x-mochirii-raffle-nonce") || "";
  const signature = headers.get("x-mochirii-raffle-signature") || "";
  const signatureMatch = SIGNATURE_RE.exec(signature);
  if (
    !exactKeys(bodyRecord, ["sub"]) ||
    !UUID_RE.test(subject) ||
    !TIMESTAMP_RE.test(timestamp) ||
    !NONCE_RE.test(nonce) ||
    !signatureMatch
  ) {
    return { ok: false, status: 401, error: "invalid_request" };
  }

  const requestSeconds = Number(timestamp);
  const nowSeconds = Math.floor((dependencies.nowMs ?? Date.now()) / 1000);
  if (
    !Number.isSafeInteger(requestSeconds) ||
    Math.abs(nowSeconds - requestSeconds) > RAFFLE_LEADERBOARD_MAX_SKEW_SECONDS
  ) {
    return { ok: false, status: 401, error: "invalid_request" };
  }

  const expected = await raffleLeaderboardHmacHex(
    dependencies.secret,
    subject,
    timestamp,
    nonce,
  );
  if (!constantTimeLowerHexMatches(expected, signatureMatch[1])) {
    return { ok: false, status: 401, error: "invalid_request" };
  }

  const expiresAt = new Date((requestSeconds + 120) * 1000).toISOString();
  if (!await dependencies.consumeNonce(subject, nonce, expiresAt)) {
    return { ok: false, status: 401, error: "replayed_request" };
  }
  return { ok: true, subject };
}
