export const SPINNER_APP_VERSION = "2.0.0";
export const SPINNER_ALGORITHM_VERSION =
  "uniform-elimination-uint32-rejection-v2";
export const SPINNER_SNAPSHOT_VERSION = 2;
export const SPINNER_MIN_PARTICIPANTS = 2;
export const SPINNER_MAX_PARTICIPANTS = 100;
export const SPINNER_MAX_NAME_GRAPHEMES = 40;
export const SPINNER_MAX_COMMAND_BODY_BYTES = 64 * 1_024;
export const SPINNER_DEFAULT_DURATION_MS = 5_000;
export const SPINNER_ROUND_DURATION_MS = 5_000;
export const SPINNER_START_DELAY_MS = 60_000;
export const SPINNER_DISCORD_CHANNEL_KEY = "raffle_spins";
export const SPINNER_DISCORD_CHANNEL_ID = "1468667003366674721";
export const SPINNER_LIVE_URL = "https://mochirii.com/account?open=live-draw";

const UINT32_RANGE = 0x1_0000_0000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const BIDI_CONTROL_PATTERN = /[\u202a-\u202e\u2066-\u2069]/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const SPINNER_ROTATION_TOLERANCE_DEGREES = 1e-9;

export type ParticipantV1 = {
  version: 1;
  id: string;
  displayName: string;
};

export type RosterStateV1 = {
  version: 1;
  participants: ParticipantV1[];
};

export type SpinnerDrawMode = "official" | "test";

export type UniformSample = {
  index: number;
  rejectionLimit: number;
  sampledWords: number[];
  acceptedWord: number;
};

export type DrawReceiptV1 = {
  version: 1;
  drawMode: SpinnerDrawMode;
  drawId: string;
  timestampIso: string;
  singaporeTime: string;
  appVersion: string;
  algorithmVersion: string;
  rosterSnapshot: RosterStateV1;
  rosterHashSha256: string;
  rejectionLimit: number;
  sampledWords: number[];
  acceptedWord: number;
  selectedIndex: number;
  winner: ParticipantV1;
};

export type SpinnerRoundReceiptV2 = {
  roundIndex: number;
  activeCount: number;
  selectedIndex: number;
  eliminatedId: string;
  eliminatedParticipant: ParticipantV1;
  rejectionLimit: number;
  sampledWords: number[];
  acceptedWord: number;
  startedAt: string;
  revealAt: string;
  startRotation: number;
  finalRotation: number;
};

export type DrawReceiptV2 = {
  version: 2;
  drawMode: SpinnerDrawMode;
  drawId: string;
  timestampIso: string;
  singaporeTime: string;
  appVersion: string;
  algorithmVersion: typeof SPINNER_ALGORITHM_VERSION;
  rosterSnapshot: RosterStateV1;
  rosterHashSha256: string;
  planHashSha256: string;
  durationMs: typeof SPINNER_ROUND_DURATION_MS;
  startAt: string;
  revealAt: string;
  startRotation: number;
  finalRotation: number;
  rounds: SpinnerRoundReceiptV2[];
  selectedIndex: number;
  winner: ParticipantV1;
};

export type DrawReceipt = DrawReceiptV1 | DrawReceiptV2;

export type SpinnerSnapshotV1 = {
  version: 1;
  sessionId: string;
  revision: number;
  phase: "idle" | "spinning" | "revealed";
  drawMode: "unclassified" | SpinnerDrawMode;
  participants: ParticipantV1[];
  startedAt: string | null;
  revealAt: string | null;
  durationMs: number;
  startRotation: number;
  finalRotation: number;
  selectedIndex: number | null;
  winner: ParticipantV1 | null;
  drawId: string | null;
  updatedAt: string;
};

export type SpinnerRoundSnapshotV2 = Pick<
  SpinnerRoundReceiptV2,
  | "roundIndex"
  | "selectedIndex"
  | "eliminatedId"
  | "startedAt"
  | "revealAt"
  | "startRotation"
  | "finalRotation"
>;

export type SpinnerSnapshotV2 = {
  version: 2;
  sessionId: string;
  revision: number;
  phase: "spinning" | "revealed";
  drawMode: SpinnerDrawMode;
  participants: ParticipantV1[];
  startedAt: string;
  revealAt: string;
  durationMs: typeof SPINNER_ROUND_DURATION_MS;
  startRotation: number;
  finalRotation: number;
  planHashSha256: string;
  rounds: SpinnerRoundSnapshotV2[];
  selectedIndex: number | null;
  winner: ParticipantV1 | null;
  drawId: string;
  updatedAt: string;
};

export type SpinnerSnapshot = SpinnerSnapshotV1 | SpinnerSnapshotV2;

type RandomWordSource = () => number;

function graphemes(value: string): string[] {
  const Segmenter = Intl.Segmenter;
  if (typeof Segmenter === "function") {
    return Array.from(
      new Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      (part) => part.segment,
    );
  }
  return Array.from(value);
}

export function normalizeDisplayName(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

function normalizedNameKey(value: string): string {
  return normalizeDisplayName(value)
    .toLocaleUpperCase("und")
    .toLocaleLowerCase("und")
    .normalize("NFKC");
}

export async function readBoundedSpinnerJsonObject(
  req: Request,
  maxBytes = SPINNER_MAX_COMMAND_BODY_BYTES,
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 413 }
> {
  const mediaType = (req.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, status: 400 };
  }

  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/.test(normalizedLength)) {
      return { ok: false, status: 400 };
    }
    const declaredBytes = Number(normalizedLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      return { ok: false, status: 400 };
    }
    if (declaredBytes > maxBytes) return { ok: false, status: 413 };
  }

  if (!req.body) return { ok: false, status: 400 };
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let raw = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return { ok: false, status: 400 };
  }

  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { ok: true, value: value as Record<string, unknown> }
      : { ok: false, status: 400 };
  } catch {
    return { ok: false, status: 400 };
  }
}

export function normalizeParticipants(value: unknown): ParticipantV1[] {
  if (!Array.isArray(value) || value.length > SPINNER_MAX_PARTICIPANTS) {
    throw new RangeError(
      `A live roster supports 0–${SPINNER_MAX_PARTICIPANTS} participants.`,
    );
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map((candidate) => {
    const participant = normalizeParticipant(candidate);
    const { id, displayName } = participant;
    const nameKey = normalizedNameKey(displayName);
    if (ids.has(id) || names.has(nameKey)) {
      throw new TypeError("Participant IDs and names must be unique.");
    }

    ids.add(id);
    names.add(nameKey);
    return participant;
  });
}

function normalizeParticipant(candidate: unknown): ParticipantV1 {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new TypeError("The live roster contains an invalid participant.");
  }
  const record = candidate as Record<string, unknown>;
  const id = String(record.id || "").trim();
  const displayName = normalizeDisplayName(record.displayName);
  if (
    record.version !== 1 || !UUID_PATTERN.test(id) || !displayName ||
    graphemes(displayName).length > SPINNER_MAX_NAME_GRAPHEMES ||
    Array.from(displayName).length > SPINNER_MAX_NAME_GRAPHEMES ||
    CONTROL_PATTERN.test(displayName) || BIDI_CONTROL_PATTERN.test(displayName)
  ) {
    throw new TypeError("The live roster contains an invalid participant.");
  }
  return { version: 1, id, displayName };
}

export function secureRandomWord(): number {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("Secure drawing is unavailable.");
  }
  const words = new Uint32Array(1);
  cryptoApi.getRandomValues(words);
  return words[0];
}

export function sampleUniformIndex(
  count: number,
  randomWord: RandomWordSource = secureRandomWord,
): UniformSample {
  if (
    !Number.isSafeInteger(count) || count < SPINNER_MIN_PARTICIPANTS ||
    count > SPINNER_MAX_PARTICIPANTS
  ) {
    throw new RangeError(
      `Participant count must be ${SPINNER_MIN_PARTICIPANTS}–${SPINNER_MAX_PARTICIPANTS}.`,
    );
  }

  const rejectionLimit = Math.floor(UINT32_RANGE / count) * count;
  const sampledWords: number[] = [];
  for (;;) {
    const word = randomWord();
    if (!Number.isInteger(word) || word < 0 || word >= UINT32_RANGE) {
      throw new RangeError(
        "The random source must return an unsigned 32-bit word.",
      );
    }
    sampledWords.push(word);
    if (word < rejectionLimit) {
      return {
        index: word % count,
        rejectionLimit,
        sampledWords,
        acceptedWord: word,
      };
    }
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    throw new Error("Secure hashing is unavailable.");
  }
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

export function canonicalRosterPayload(
  participants: readonly ParticipantV1[],
): string {
  return JSON.stringify({
    version: 1,
    participants: participants.map(({ version, id, displayName }) => ({
      version,
      id,
      displayName,
    })),
  });
}

export function normalizeDurationMs(value: unknown): number {
  if (value == null || value === SPINNER_ROUND_DURATION_MS) {
    return SPINNER_ROUND_DURATION_MS;
  }
  throw new RangeError("Each elimination round is fixed at five seconds.");
}

export function normalizeDrawMode(value: unknown): SpinnerDrawMode {
  if (value !== "official" && value !== "test") {
    throw new TypeError("Choose an official or test draw.");
  }
  return value;
}

export function targetRotationDegrees(
  selectedIndex: number,
  count: number,
  turns = 6,
): number {
  if (
    !Number.isSafeInteger(selectedIndex) || selectedIndex < 0 ||
    selectedIndex >= count
  ) {
    throw new RangeError("The selected participant is outside the roster.");
  }
  if (!Number.isSafeInteger(turns) || turns < 1) {
    throw new RangeError("A draw needs at least one full turn.");
  }
  return turns * 360 - selectedIndex * (360 / count);
}

function normalizedRotationDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function rotationsAreEquivalent(
  left: number,
  right: number,
): boolean {
  const difference = Math.abs(
    normalizedRotationDegrees(left) - normalizedRotationDegrees(right),
  );
  return Math.min(difference, 360 - difference) <=
    SPINNER_ROTATION_TOLERANCE_DEGREES;
}

function formatSingaporeTime(date: Date): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}

export async function createLiveDrawPlan(
  participantsValue: unknown,
  options: {
    now?: Date;
    startRotation?: number;
    randomWord?: RandomWordSource;
    uuidFactory?: () => string;
    drawMode?: SpinnerDrawMode;
  } = {},
): Promise<{
  receipt: DrawReceiptV2;
  planHashSha256: string;
  startAt: string;
  revealAt: string;
  durationMs: typeof SPINNER_ROUND_DURATION_MS;
  startRotation: number;
  finalRotation: number;
}> {
  const participants = normalizeParticipants(participantsValue);
  if (participants.length < SPINNER_MIN_PARTICIPANTS) {
    throw new RangeError(
      `A draw requires ${SPINNER_MIN_PARTICIPANTS}–${SPINNER_MAX_PARTICIPANTS} participants.`,
    );
  }
  const now = options.now ? new Date(options.now.getTime()) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new TypeError("The draw timestamp is invalid.");
  }
  const durationMs = SPINNER_ROUND_DURATION_MS;
  const drawMode = normalizeDrawMode(options.drawMode ?? "official");
  const requestedStartRotation = Number(options.startRotation || 0);
  if (!Number.isFinite(requestedStartRotation)) {
    throw new TypeError("The starting rotation is invalid.");
  }
  const startRotation = normalizedRotationDegrees(requestedStartRotation);

  // Hash and construct every fallible field before selection. One invocation
  // owns the complete elimination sequence; callers never sample a round.
  const rosterSnapshot: RosterStateV1 = { version: 1, participants };
  const rosterHashSha256 = await sha256Hex(
    canonicalRosterPayload(participants),
  );
  const drawId = (options.uuidFactory || (() => crypto.randomUUID()))();
  if (!UUID_PATTERN.test(drawId)) {
    throw new TypeError("The draw ID is invalid.");
  }
  const timestampIso = now.toISOString();
  const startAtDate = new Date(now.getTime() + SPINNER_START_DELAY_MS);
  const randomWord = options.randomWord || secureRandomWord;
  const activeParticipants = participants.map((participant) => ({
    ...participant,
  }));
  const rounds: SpinnerRoundReceiptV2[] = [];
  let roundStartRotation = startRotation;

  for (
    let roundIndex = 0;
    roundIndex < participants.length - 1;
    roundIndex += 1
  ) {
    const activeCount = activeParticipants.length;
    const sample = sampleUniformIndex(activeCount, randomWord);
    const eliminatedParticipant = { ...activeParticipants[sample.index] };
    const roundStartedAt = new Date(
      startAtDate.getTime() + roundIndex * SPINNER_ROUND_DURATION_MS,
    );
    const roundRevealAt = new Date(
      roundStartedAt.getTime() + SPINNER_ROUND_DURATION_MS,
    );
    const targetAngle = normalizedRotationDegrees(
      targetRotationDegrees(sample.index, activeCount),
    );
    const alignmentTravel = normalizedRotationDegrees(
      targetAngle - roundStartRotation,
    );
    const roundFinalRotation = roundStartRotation + 6 * 360 + alignmentTravel;

    rounds.push({
      roundIndex,
      activeCount,
      selectedIndex: sample.index,
      eliminatedId: eliminatedParticipant.id,
      eliminatedParticipant,
      rejectionLimit: sample.rejectionLimit,
      sampledWords: [...sample.sampledWords],
      acceptedWord: sample.acceptedWord,
      startedAt: roundStartedAt.toISOString(),
      revealAt: roundRevealAt.toISOString(),
      startRotation: roundStartRotation,
      finalRotation: roundFinalRotation,
    });

    activeParticipants.splice(sample.index, 1);
    roundStartRotation = normalizedRotationDegrees(roundFinalRotation);
  }

  const winner = { ...activeParticipants[0] };
  const selectedIndex = participants.findIndex(({ id }) => id === winner.id);
  if (selectedIndex < 0) {
    throw new TypeError("The final survivor is outside the frozen roster.");
  }
  const revealAtDate = new Date(
    startAtDate.getTime() + rounds.length * SPINNER_ROUND_DURATION_MS,
  );

  // These top-level rotations remain the bounded final-winner media recap.
  // Live clients use the per-round rotations above for the elimination wheel.
  const recapTargetAngle = normalizedRotationDegrees(
    targetRotationDegrees(selectedIndex, participants.length),
  );
  const recapAlignmentTravel = normalizedRotationDegrees(
    recapTargetAngle - startRotation,
  );
  const finalRotation = startRotation + 6 * 360 + recapAlignmentTravel;
  const startAt = startAtDate.toISOString();
  const revealAt = revealAtDate.toISOString();
  const planHashInput: Parameters<typeof canonicalDrawPlanPayload>[0] = {
    version: 2 as const,
    drawId,
    drawMode,
    algorithmVersion: SPINNER_ALGORITHM_VERSION,
    rosterHashSha256,
    durationMs,
    startAt,
    revealAt,
    startRotation,
    finalRotation,
    rounds,
    selectedIndex,
    winner,
  };
  const planHashSha256 = await sha256Hex(
    canonicalDrawPlanPayload(planHashInput),
  );

  return {
    receipt: {
      version: 2,
      drawMode,
      drawId,
      timestampIso,
      singaporeTime: formatSingaporeTime(now),
      appVersion: SPINNER_APP_VERSION,
      algorithmVersion: SPINNER_ALGORITHM_VERSION,
      rosterSnapshot,
      rosterHashSha256,
      planHashSha256,
      durationMs,
      startAt,
      revealAt,
      startRotation,
      finalRotation,
      rounds,
      selectedIndex,
      winner,
    },
    planHashSha256,
    startAt,
    revealAt,
    durationMs,
    startRotation,
    finalRotation,
  };
}

export function canonicalDrawPlanPayload(
  plan: {
    version: 2;
    drawId: string;
    drawMode: SpinnerDrawMode;
    algorithmVersion: typeof SPINNER_ALGORITHM_VERSION;
    rosterHashSha256: string;
    durationMs: typeof SPINNER_ROUND_DURATION_MS;
    startAt: string;
    revealAt: string;
    startRotation: number;
    finalRotation: number;
    rounds: readonly SpinnerRoundReceiptV2[];
    selectedIndex: number;
    winner: ParticipantV1;
  },
): string {
  return JSON.stringify({
    version: plan.version,
    drawId: plan.drawId,
    drawMode: plan.drawMode,
    algorithmVersion: plan.algorithmVersion,
    rosterHashSha256: plan.rosterHashSha256,
    durationMs: plan.durationMs,
    startAt: plan.startAt,
    revealAt: plan.revealAt,
    startRotation: plan.startRotation,
    finalRotation: plan.finalRotation,
    rounds: plan.rounds.map((round) => ({
      roundIndex: round.roundIndex,
      activeCount: round.activeCount,
      selectedIndex: round.selectedIndex,
      eliminatedId: round.eliminatedId,
      eliminatedParticipant: {
        version: round.eliminatedParticipant.version,
        id: round.eliminatedParticipant.id,
        displayName: round.eliminatedParticipant.displayName,
      },
      rejectionLimit: round.rejectionLimit,
      sampledWords: [...round.sampledWords],
      acceptedWord: round.acceptedWord,
      startedAt: round.startedAt,
      revealAt: round.revealAt,
      startRotation: round.startRotation,
      finalRotation: round.finalRotation,
    })),
    selectedIndex: plan.selectedIndex,
    winner: {
      version: plan.winner.version,
      id: plan.winner.id,
      displayName: plan.winner.displayName,
    },
  });
}

const NO_MENTIONS = Object.freeze({
  parse: [],
  users: [],
  roles: [],
  replied_user: false,
});

export function sanitizeDiscordDisplayName(value: string): string {
  const plain = normalizeDisplayName(value)
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/@/gu, "＠")
    .replace(/</gu, "‹")
    .replace(/>/gu, "›")
    .replace(/[`*_~|\\]/gu, "");
  return graphemes(plain).slice(0, SPINNER_MAX_NAME_GRAPHEMES).join("") ||
    "Mōchirīī member";
}

export function buildDiscordOutboxPayloads(
  receipt: DrawReceipt,
  startAt: string,
): {
  channelKey: string;
  channelId: string;
  startPayload: Record<string, unknown>;
  resultPayload: Record<string, unknown>;
} {
  const startAtMs = Date.parse(startAt);
  if (!Number.isFinite(startAtMs)) {
    throw new TypeError("The live draw start timestamp is invalid.");
  }
  const startAtUnixSeconds = Math.floor(startAtMs / 1_000);
  const winner = sanitizeDiscordDisplayName(receipt.winner.displayName);
  const nonce = receipt.drawId.replace(/-/gu, "").slice(0, 25);
  return {
    channelKey: SPINNER_DISCORD_CHANNEL_KEY,
    channelId: SPINNER_DISCORD_CHANNEL_ID,
    startPayload: {
      content:
        `A Mōchirīī monthly guild raffle begins <t:${startAtUnixSeconds}:R>.\nWatch the moonwheel live: ${SPINNER_LIVE_URL}`,
      nonce,
      enforce_nonce: true,
      allowed_mentions: { ...NO_MENTIONS, parse: [], users: [], roles: [] },
    },
    resultPayload: {
      content:
        `Mōchirīī raffle complete.\nWinner: **${winner}**\nDraw: \`${receipt.drawId}\`\nReceipt: \`${receipt.rosterHashSha256}\``,
      allowed_mentions: { ...NO_MENTIONS, parse: [], users: [], roles: [] },
    },
  };
}

export async function commandRequestHash(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(value));
}

export function serializeSnapshot(
  value: unknown,
  now = new Date(),
): SpinnerSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Live spinner state is unavailable.");
  }
  const row = value as Record<string, unknown>;
  return row.version === 2
    ? serializeSnapshotV2(row)
    : serializeSnapshotV1(row, now);
}

function serializeSnapshotV1(
  row: Record<string, unknown>,
  now: Date,
): SpinnerSnapshotV1 {
  const participants = normalizeParticipants(row.participants);
  const storedPhase = row.phase === "spinning" || row.phase === "revealed"
    ? row.phase
    : "idle";
  const revealAt = typeof row.revealAt === "string" ? row.revealAt : null;
  const revealedByTime = storedPhase === "spinning" && revealAt !== null &&
    Date.parse(revealAt) <= now.getTime();
  const phase = revealedByTime ? "revealed" : storedPhase;
  const drawMode = row.drawMode === "official" || row.drawMode === "test"
    ? row.drawMode
    : "unclassified";
  if (phase !== "idle" && drawMode === "unclassified") {
    throw new TypeError("Live spinner draw classification is unavailable.");
  }
  const includeWinner = phase === "revealed";
  const winner = includeWinner && row.winner && typeof row.winner === "object"
    ? normalizeParticipant(row.winner)
    : null;

  return {
    version: 1,
    sessionId: String(row.sessionId || ""),
    revision: Number(row.revision || 0),
    phase,
    drawMode,
    participants,
    startedAt: typeof row.startedAt === "string" ? row.startedAt : null,
    revealAt,
    durationMs: Number(row.durationMs || 0),
    startRotation: Number(row.startRotation || 0),
    finalRotation: Number(row.finalRotation || 0),
    selectedIndex: includeWinner && Number.isInteger(Number(row.selectedIndex))
      ? Number(row.selectedIndex)
      : null,
    winner,
    drawId: typeof row.drawId === "string" ? row.drawId : null,
    updatedAt: String(row.updatedAt || now.toISOString()),
  };
}

function serializeSnapshotV2(
  row: Record<string, unknown>,
): SpinnerSnapshotV2 {
  const participants = normalizeParticipants(row.participants);
  const sessionId = String(row.sessionId || "");
  const revision = Number(row.revision);
  const phase = row.phase === "spinning" || row.phase === "revealed"
    ? row.phase
    : null;
  const drawMode = row.drawMode === "official" || row.drawMode === "test"
    ? row.drawMode
    : null;
  const startedAt = typeof row.startedAt === "string" ? row.startedAt : "";
  const revealAt = typeof row.revealAt === "string" ? row.revealAt : "";
  const drawId = typeof row.drawId === "string" ? row.drawId : "";
  const planHashSha256 = String(row.planHashSha256 || "");
  const durationMs = Number(row.durationMs);
  const startRotation = Number(row.startRotation);
  const finalRotation = Number(row.finalRotation);
  const startedAtMs = Date.parse(startedAt);
  const revealAtMs = Date.parse(revealAt);

  if (
    participants.length < SPINNER_MIN_PARTICIPANTS ||
    !UUID_PATTERN.test(sessionId) || !UUID_PATTERN.test(drawId) ||
    !Number.isSafeInteger(revision) || revision < 0 || !phase || !drawMode ||
    !SHA256_PATTERN.test(planHashSha256) ||
    durationMs !== SPINNER_ROUND_DURATION_MS ||
    !Number.isFinite(startedAtMs) || !Number.isFinite(revealAtMs) ||
    !Number.isFinite(startRotation) || startRotation < 0 ||
    startRotation >= 360 || !Number.isFinite(finalRotation) ||
    finalRotation <= startRotation || finalRotation >= 2_880 ||
    !Array.isArray(row.rounds) ||
    row.rounds.length !== participants.length - 1
  ) {
    throw new TypeError("Live spinner v2 state is invalid.");
  }

  const activeParticipants = participants.map((participant) => ({
    ...participant,
  }));
  const rounds: SpinnerRoundSnapshotV2[] = [];
  let expectedStartedAtMs = startedAtMs;
  let expectedStartRotation = startRotation;

  for (let roundIndex = 0; roundIndex < row.rounds.length; roundIndex += 1) {
    const value = row.rounds[roundIndex];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Live spinner v2 round is invalid.");
    }
    const round = value as Record<string, unknown>;
    const selectedIndex = Number(round.selectedIndex);
    const eliminatedId = String(round.eliminatedId || "");
    const roundStartedAt = typeof round.startedAt === "string"
      ? round.startedAt
      : "";
    const roundRevealAt = typeof round.revealAt === "string"
      ? round.revealAt
      : "";
    const roundStartedAtMs = Date.parse(roundStartedAt);
    const roundRevealAtMs = Date.parse(roundRevealAt);
    const roundStartRotation = Number(round.startRotation);
    const roundFinalRotation = Number(round.finalRotation);
    if (
      Number(round.roundIndex) !== roundIndex ||
      !Number.isSafeInteger(selectedIndex) || selectedIndex < 0 ||
      selectedIndex >= activeParticipants.length ||
      !UUID_PATTERN.test(eliminatedId) ||
      activeParticipants[selectedIndex]?.id !== eliminatedId ||
      roundStartedAtMs !== expectedStartedAtMs ||
      roundRevealAtMs - roundStartedAtMs !== SPINNER_ROUND_DURATION_MS ||
      !Number.isFinite(roundStartRotation) || roundStartRotation < 0 ||
      roundStartRotation >= 360 || !Number.isFinite(roundFinalRotation) ||
      roundFinalRotation <= roundStartRotation || roundFinalRotation >= 2_880 ||
      Math.abs(roundStartRotation - expectedStartRotation) >
        SPINNER_ROTATION_TOLERANCE_DEGREES ||
      !rotationsAreEquivalent(
        roundFinalRotation,
        targetRotationDegrees(selectedIndex, activeParticipants.length),
      )
    ) {
      throw new TypeError("Live spinner v2 round is invalid.");
    }

    rounds.push({
      roundIndex,
      selectedIndex,
      eliminatedId,
      startedAt: roundStartedAt,
      revealAt: roundRevealAt,
      startRotation: roundStartRotation,
      finalRotation: roundFinalRotation,
    });
    activeParticipants.splice(selectedIndex, 1);
    expectedStartedAtMs = roundRevealAtMs;
    expectedStartRotation = normalizedRotationDegrees(roundFinalRotation);
  }

  if (expectedStartedAtMs !== revealAtMs || activeParticipants.length !== 1) {
    throw new TypeError("Live spinner v2 timeline is invalid.");
  }
  const finalSurvivor = activeParticipants[0];
  const finalSelectedIndex = participants.findIndex(
    ({ id }) => id === finalSurvivor.id,
  );
  if (
    !rotationsAreEquivalent(
      finalRotation,
      targetRotationDegrees(finalSelectedIndex, participants.length),
    )
  ) {
    throw new TypeError("Live spinner v2 recap rotation is invalid.");
  }
  const includeWinner = phase === "revealed";
  let selectedIndex: number | null = null;
  let winner: ParticipantV1 | null = null;
  if (includeWinner) {
    selectedIndex = Number(row.selectedIndex);
    winner = normalizeParticipant(row.winner);
    if (
      !Number.isSafeInteger(selectedIndex) ||
      selectedIndex !== finalSelectedIndex || winner.id !== finalSurvivor.id ||
      winner.displayName !== finalSurvivor.displayName
    ) {
      throw new TypeError("Live spinner v2 winner is invalid.");
    }
  } else if (row.selectedIndex != null || row.winner != null) {
    throw new TypeError("Live spinner v2 winner was revealed early.");
  }

  return {
    version: 2,
    sessionId,
    revision,
    phase,
    drawMode,
    participants,
    startedAt,
    revealAt,
    durationMs: SPINNER_ROUND_DURATION_MS,
    startRotation,
    finalRotation,
    planHashSha256,
    rounds,
    selectedIndex,
    winner,
    drawId,
    updatedAt: String(row.updatedAt || revealAt),
  };
}

export function buildSnapshotResponseData(
  mode: "controller" | "viewer",
  snapshot: SpinnerSnapshot,
  serverNow: string,
  receipt?: Record<string, unknown>,
  commandId?: string,
): Record<string, unknown> {
  return {
    mode,
    snapshot,
    serverNow,
    ...(mode === "controller" && receipt ? { receipt } : {}),
    ...(mode === "controller" && commandId ? { commandId } : {}),
  };
}
