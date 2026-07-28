const MAX_LEADERBOARD_ROWS = 250;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const BIDI_CONTROL_RE = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const CYCLE_ID_RE = /^[a-z0-9][a-z0-9-]{5,63}$/;

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
  asOf: string;
};

export type RaffleLeaderboardRead =
  | { ok: true; data: RaffleLeaderboard | null }
  | { ok: false; data: null };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
) {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function normalizedInstant(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

export function parseRaffleLeaderboardApi(
  value: unknown,
): RaffleLeaderboard | null {
  const envelope = asRecord(value);
  if (
    !hasExactKeys(envelope, ["data", "ok"]) ||
    envelope.ok !== true ||
    envelope.data === null
  ) return null;

  const record = asRecord(envelope.data);
  if (
    !hasExactKeys(record, [
      "asOf",
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
  const cycleStatus = String(record.cycleStatus);
  const closesAt = normalizedInstant(record.closesAt);
  const drawAt = normalizedInstant(record.drawAt);
  const asOf = normalizedInstant(record.asOf);
  const participantCount = Number(record.participantCount);
  if (
    !CYCLE_ID_RE.test(cyclePublicId) ||
    !["ready", "open", "frozen", "drawn", "complete"].includes(cycleStatus) ||
    !closesAt ||
    !drawAt ||
    !asOf ||
    Date.parse(closesAt) >= Date.parse(drawAt) ||
    record.maximumEntries !== 10 ||
    !Number.isSafeInteger(participantCount) ||
    participantCount < 0 ||
    participantCount > 10_000 ||
    !Array.isArray(record.entries) ||
    record.entries.length > MAX_LEADERBOARD_ROWS ||
    participantCount < record.entries.length
  ) return null;

  let viewerRows = 0;
  let previousRank = 0;
  let previousEntryCount = Number.POSITIVE_INFINITY;
  const entries: RaffleLeaderboardEntry[] = [];
  for (const value of record.entries) {
    const entry = asRecord(value);
    if (
      !hasExactKeys(entry, ["displayName", "entryCount", "isViewer", "rank"])
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
    asOf,
  };
}

export function raffleLeaderboardApiIsEmpty(value: unknown): boolean {
  const record = asRecord(value);
  return hasExactKeys(record, ["data", "ok"]) &&
    record.ok === true &&
    record.data === null;
}
