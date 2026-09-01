export const APP_VERSION = "1.0.0";
export const ALGORITHM_VERSION = "uniform-uint32-rejection-v1";
export const ELIMINATION_APP_VERSION = "2.0.0";
export const ELIMINATION_ALGORITHM_VERSION = "uniform-elimination-uint32-rejection-v2";
export const ELIMINATION_ROUND_DURATION_MS = 5_000;
export const SPINNER_ROTATION_TOLERANCE_DEGREES = 1e-9;

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 100;
export const MAX_NAME_GRAPHEMES = 40;

export const ROSTER_STORAGE_KEY = "mochirii.raffle.roster.v1";
export const SETTINGS_STORAGE_KEY = "mochirii.raffle.settings.v1";
export const RECEIPTS_STORAGE_KEY = "mochirii.raffle.receipts.v1";

const UINT32_RANGE = 0x1_0000_0000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const BIDI_CONTROL_PATTERN = /[\u202a-\u202e\u2066-\u2069]/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

export interface ParticipantV1 {
  version: 1;
  id: string;
  displayName: string;
}

export interface RosterStateV1 {
  version: 1;
  participants: ParticipantV1[];
}

export type MotionMode = "full" | "reduced" | "off";
export type SpinnerDrawMode = "official" | "test";
export type SpinnerPersistedDrawMode = "unclassified" | SpinnerDrawMode;

export type RevealReason =
  | "animation-complete"
  | "animation-error"
  | "off"
  | "reduced"
  | "skip"
  | "visibility-hidden";

export interface DrawReceiptV1 {
  version: 1;
  drawMode: SpinnerPersistedDrawMode;
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
}

export interface EliminationReceiptRoundV2 {
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
}

export interface DrawReceiptV2 {
  version: 2;
  drawMode: SpinnerDrawMode;
  drawId: string;
  timestampIso: string;
  singaporeTime: string;
  appVersion: typeof ELIMINATION_APP_VERSION;
  algorithmVersion: typeof ELIMINATION_ALGORITHM_VERSION;
  rosterSnapshot: RosterStateV1;
  rosterHashSha256: string;
  planHashSha256: string;
  durationMs: typeof ELIMINATION_ROUND_DURATION_MS;
  startAt: string;
  revealAt: string;
  startRotation: number;
  finalRotation: number;
  rounds: EliminationReceiptRoundV2[];
  selectedIndex: number;
  winner: ParticipantV1;
}

export type DrawReceipt = DrawReceiptV1 | DrawReceiptV2;

export type NumberedParticipant = ParticipantV1 & { number: number };

export type NameValidationResult =
  | { valid: true; normalizedName: string }
  | { valid: false; normalizedName: string; error: string };

export interface BulkParseResult {
  names: string[];
  errors: string[];
}

export interface UniformSample {
  index: number;
  rejectionLimit: number;
  sampledWords: number[];
  acceptedWord: number;
}

type RandomWordSource = () => number;

/**
 * Owns one draw-producing promise and its immutable result. Presentation exit
 * paths may reveal that result repeatedly, but they can never invoke the draw
 * factory again. Reset only when the leader explicitly begins a new draw.
 */
export class DrawAttempt<T> {
  private creation: Promise<T> | null = null;

  private storedResult: T | undefined;

  private hasStoredResult = false;

  private revealReason: RevealReason | null = null;

  get active(): boolean {
    return this.creation !== null;
  }

  get ready(): boolean {
    return this.hasStoredResult;
  }

  get lastRevealReason(): RevealReason | null {
    return this.revealReason;
  }

  begin(factory: () => Promise<T>): Promise<T> {
    if (this.creation) return this.creation;

    this.creation = Promise.resolve()
      .then(factory)
      .then((result) => {
        this.storedResult = result;
        this.hasStoredResult = true;
        return result;
      });
    return this.creation;
  }

  reveal(reason: RevealReason): T | null {
    if (!this.hasStoredResult) return null;
    this.revealReason ??= reason;
    return this.storedResult as T;
  }

  reset(): void {
    this.creation = null;
    this.storedResult = undefined;
    this.hasStoredResult = false;
    this.revealReason = null;
  }
}

/** Counts user-perceived characters instead of UTF-16 code units. */
export function countGraphemes(value: string): number {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
    ).length;
  }

  // Array.from keeps surrogate pairs together. It is a conservative fallback
  // for runtimes too old to expose Intl.Segmenter.
  return Array.from(value).length;
}

export function normalizeDisplayName(value: string): string {
  return value.normalize("NFKC").trim();
}

/**
 * Produces a deterministic, locale-independent approximation of Unicode case
 * folding. The upper/lower pass also makes values such as `Straße` and
 * `STRASSE` collide, while `und` avoids device-locale differences.
 */
export function normalizedNameKey(value: string): string {
  return normalizeDisplayName(value)
    .toLocaleUpperCase("und")
    .toLocaleLowerCase("und")
    .normalize("NFKC");
}

export function validateName(
  candidate: string,
  roster: readonly ParticipantV1[],
  editingId?: string,
): NameValidationResult {
  const normalizedName = normalizeDisplayName(candidate);

  if (normalizedName.length === 0) {
    return {
      valid: false,
      normalizedName,
      error: "Enter a name before adding it to the roster.",
    };
  }

  if (
    countGraphemes(normalizedName) > MAX_NAME_GRAPHEMES ||
    Array.from(normalizedName).length > MAX_NAME_GRAPHEMES ||
    CONTROL_PATTERN.test(normalizedName) ||
    BIDI_CONTROL_PATTERN.test(normalizedName)
  ) {
    return {
      valid: false,
      normalizedName,
      error: `Names can contain at most ${MAX_NAME_GRAPHEMES} characters.`,
    };
  }

  const editingExisting =
    editingId !== undefined && roster.some(({ id }) => id === editingId);
  if (!editingExisting && roster.length >= MAX_PARTICIPANTS) {
    return {
      valid: false,
      normalizedName,
      error: `A raffle can contain at most ${MAX_PARTICIPANTS} names.`,
    };
  }

  const key = normalizedNameKey(normalizedName);
  const duplicate = roster.some(
    (participant) =>
      participant.id !== editingId &&
      normalizedNameKey(participant.displayName) === key,
  );

  if (duplicate) {
    return {
      valid: false,
      normalizedName,
      error: "That name is already on the roster.",
    };
  }

  return { valid: true, normalizedName };
}

function requireCrypto(): Crypto {
  const provider = globalThis.crypto;
  if (!provider || typeof provider.getRandomValues !== "function") {
    throw new Error(
      "Secure randomness is unavailable in this browser. Drawing is disabled.",
    );
  }
  return provider;
}

function secureUuid(): string {
  const provider = requireCrypto();
  if (typeof provider.randomUUID === "function") {
    return provider.randomUUID();
  }

  const bytes = provider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function createParticipant(name: string, id?: string): ParticipantV1 {
  const result = validateName(name, []);
  if (!result.valid) {
    throw new Error(result.error);
  }
  const participantId = id ?? secureUuid();
  if (!UUID_PATTERN.test(participantId)) {
    throw new Error("Participant IDs must be UUIDs.");
  }

  return { version: 1, id: participantId, displayName: result.normalizedName };
}

export function renumberParticipants(
  participants: readonly ParticipantV1[],
): NumberedParticipant[] {
  return participants.map((participant, index) => ({
    ...participant,
    number: index + 1,
  }));
}

export function moveParticipant(
  participants: readonly ParticipantV1[],
  fromIndex: number,
  toIndex: number,
): ParticipantV1[] {
  const moved = [...participants];
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= moved.length ||
    toIndex >= moved.length ||
    fromIndex === toIndex
  ) {
    return moved;
  }

  const [participant] = moved.splice(fromIndex, 1);
  moved.splice(toIndex, 0, participant);
  return moved;
}

export function parseBulkNames(
  input: string,
  roster: readonly ParticipantV1[] = [],
): BulkParseResult {
  const tokens = input.split(/[\r\n\t,;]+/u);
  const names: string[] = [];
  const errors: string[] = [];
  const validationRoster: ParticipantV1[] = [...roster];

  for (const [index, token] of tokens.entries()) {
    if (normalizeDisplayName(token).length === 0) {
      continue;
    }

    const result = validateName(token, validationRoster);
    if (!result.valid) {
      errors.push(`Entry ${index + 1}: ${result.error}`);
      continue;
    }

    names.push(result.normalizedName);
    validationRoster.push({
      version: 1,
      id: `bulk-preview-${index}`,
      displayName: result.normalizedName,
    });
  }

  if (names.length === 0 && errors.length === 0) {
    errors.push("No names were found in the pasted text.");
  }

  return { names, errors };
}

export function secureRandomWord(): number {
  return requireCrypto().getRandomValues(new Uint32Array(1))[0];
}

function assertParticipantCount(count: number, minimum = 1): void {
  if (
    !Number.isSafeInteger(count) ||
    count < minimum ||
    count > MAX_PARTICIPANTS
  ) {
    const range =
      minimum === MIN_PARTICIPANTS
        ? `${MIN_PARTICIPANTS}–${MAX_PARTICIPANTS}`
        : `1–${MAX_PARTICIPANTS}`;
    throw new RangeError(`Participant count must be in the range ${range}.`);
  }
}

function assertUint32(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
    throw new RangeError("The random source must return an unsigned 32-bit word.");
  }
}

/** Selects an equal-probability index without modulo bias. */
export function sampleUniformIndex(
  count: number,
  randomWord: RandomWordSource = secureRandomWord,
): UniformSample {
  assertParticipantCount(count);
  const rejectionLimit = Math.floor(UINT32_RANGE / count) * count;
  const sampledWords: number[] = [];

  for (;;) {
    const word = randomWord();
    assertUint32(word);
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

function snapshotRoster(
  roster: RosterStateV1 | readonly ParticipantV1[],
): RosterStateV1 {
  // Array.isArray does not narrow readonly arrays in TypeScript, so both
  // branches are annotated explicitly.
  const participants: readonly ParticipantV1[] = Array.isArray(roster)
    ? (roster as readonly ParticipantV1[])
    : (roster as RosterStateV1).participants;
  return {
    version: 1,
    participants: participants.map(({ version, id, displayName }) => ({
      version,
      id,
      displayName,
    })),
  };
}

export function canonicalRosterPayload(
  roster: RosterStateV1 | readonly ParticipantV1[],
): string {
  return JSON.stringify(snapshotRoster(roster));
}

export async function hashRoster(
  roster: RosterStateV1 | readonly ParticipantV1[],
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    throw new Error("SHA-256 hashing is unavailable in this browser.");
  }

  const bytes = new TextEncoder().encode(canonicalRosterPayload(roster));
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function assertValidRosterForDraw(roster: RosterStateV1): void {
  assertParticipantCount(roster.participants.length, MIN_PARTICIPANTS);
  const ids = new Set<string>();
  const nameKeys = new Set<string>();

  for (const participant of roster.participants) {
    if (
      participant.version !== 1 ||
      !UUID_PATTERN.test(participant.id) ||
      normalizeDisplayName(participant.displayName) !== participant.displayName ||
      participant.displayName.length === 0 ||
      countGraphemes(participant.displayName) > MAX_NAME_GRAPHEMES
    ) {
      throw new Error("The roster contains an invalid participant.");
    }

    const nameKey = normalizedNameKey(participant.displayName);
    if (ids.has(participant.id) || nameKeys.has(nameKey)) {
      throw new Error("The roster contains duplicate participants or names.");
    }
    ids.add(participant.id);
    nameKeys.add(nameKey);
  }
}

function resolveDate(now: Date | (() => Date)): Date {
  const date = typeof now === "function" ? now() : now;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("The draw timestamp is invalid.");
  }
  return new Date(date.getTime());
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

export async function createDrawReceipt(
  roster: RosterStateV1 | readonly ParticipantV1[],
  randomWord: RandomWordSource = secureRandomWord,
  uuidFactory: () => string = secureUuid,
  now: Date | (() => Date) = () => new Date(),
  drawMode: SpinnerDrawMode = "official",
): Promise<DrawReceiptV1> {
  // Copy synchronously before sampling so later roster edits cannot change the
  // selected participant or receipt.
  const rosterSnapshot = snapshotRoster(roster);
  assertValidRosterForDraw(rosterSnapshot);

  // Finish every operation that can fail before sampling. Once the winning
  // word is accepted, receipt construction below is synchronous and cannot
  // strand a selected result that a later retry could replace.
  const rosterHashSha256 = await hashRoster(rosterSnapshot);
  const timestamp = resolveDate(now);
  const timestampIso = timestamp.toISOString();
  const singaporeTime = formatSingaporeTime(timestamp);
  const drawId = uuidFactory();
  if (typeof drawId !== "string" || drawId.length === 0) {
    throw new Error("The draw ID is invalid.");
  }

  // Sampling happens exactly once per receipt. Rejection retries are recorded
  // by that same invocation and are part of the replayable audit trail.
  const sample = sampleUniformIndex(rosterSnapshot.participants.length, randomWord);
  const winner = { ...rosterSnapshot.participants[sample.index] };

  return {
    version: 1,
    drawMode,
    drawId,
    timestampIso,
    singaporeTime,
    appVersion: APP_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    rosterSnapshot,
    rosterHashSha256,
    rejectionLimit: sample.rejectionLimit,
    sampledWords: [...sample.sampledWords],
    acceptedWord: sample.acceptedWord,
    selectedIndex: sample.index,
    winner,
  };
}

/** Angular center measured clockwise from the top pointer. */
export function segmentCenterDegrees(selectedIndex: number, count: number): number {
  assertParticipantCount(count);
  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= count
  ) {
    throw new RangeError("The selected index is outside the wheel.");
  }
  return (selectedIndex * 360) / count;
}

/** Positive clockwise rotation that lands the selected center at the top. */
export function targetRotationDegrees(
  selectedIndex: number,
  count: number,
  turns = 6,
): number {
  if (!Number.isFinite(turns) || turns < 1) {
    throw new RangeError("The wheel must complete at least one turn.");
  }
  return turns * 360 - segmentCenterDegrees(selectedIndex, count);
}

function decodeStoredValue(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return input;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidParticipant(value: unknown): value is ParticipantV1 {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.id === "string" &&
    UUID_PATTERN.test(value.id) &&
    typeof value.displayName === "string" &&
    value.displayName.length > 0 &&
    normalizeDisplayName(value.displayName) === value.displayName &&
    countGraphemes(value.displayName) <= MAX_NAME_GRAPHEMES
  );
}

function parseRosterCandidate(value: unknown): RosterStateV1 | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.participants) ||
    value.participants.length > MAX_PARTICIPANTS ||
    !value.participants.every(isValidParticipant)
  ) {
    return null;
  }

  const participants = value.participants.map((participant) => ({ ...participant }));
  const ids = new Set(participants.map(({ id }) => id));
  const names = new Set(
    participants.map(({ displayName }) => normalizedNameKey(displayName)),
  );
  if (ids.size !== participants.length || names.size !== participants.length) {
    return null;
  }

  return { version: 1, participants };
}

export function parseStoredRoster(input: unknown): RosterStateV1 {
  return parseRosterCandidate(decodeStoredValue(input)) ?? {
    version: 1,
    participants: [],
  };
}

export function parseStoredMotion(input: unknown): MotionMode {
  const decoded = decodeStoredValue(input);
  const candidate =
    isRecord(decoded) && decoded.version === 1 ? decoded.motionMode : decoded;
  return candidate === "full" || candidate === "reduced" || candidate === "off"
    ? candidate
    : "full";
}

function isUint32(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < UINT32_RANGE
  );
}

function parseReceiptV1Candidate(value: unknown): DrawReceiptV1 | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.drawId !== "string" ||
    value.drawId.length === 0 ||
    typeof value.timestampIso !== "string" ||
    Number.isNaN(Date.parse(value.timestampIso)) ||
    typeof value.singaporeTime !== "string" ||
    value.singaporeTime.length === 0 ||
    typeof value.appVersion !== "string" ||
    typeof value.algorithmVersion !== "string" ||
    typeof value.rosterHashSha256 !== "string" ||
    !SHA256_PATTERN.test(value.rosterHashSha256) ||
    typeof value.rejectionLimit !== "number" ||
    !Number.isSafeInteger(value.rejectionLimit) ||
    !Array.isArray(value.sampledWords) ||
    value.sampledWords.length === 0 ||
    !value.sampledWords.every(isUint32) ||
    !isUint32(value.acceptedWord) ||
    typeof value.selectedIndex !== "number" ||
    !Number.isInteger(value.selectedIndex)
  ) {
    return null;
  }

  const rosterSnapshot = parseRosterCandidate(value.rosterSnapshot);
  const drawMode = value.drawMode === "official" || value.drawMode === "test"
    ? value.drawMode
    : value.drawMode == null
      ? "unclassified"
      : null;
  if (
    !rosterSnapshot ||
    !drawMode ||
    rosterSnapshot.participants.length < MIN_PARTICIPANTS ||
    !isValidParticipant(value.winner)
  ) {
    return null;
  }

  const count = rosterSnapshot.participants.length;
  const expectedLimit = Math.floor(UINT32_RANGE / count) * count;
  const selectedIndex = value.selectedIndex;
  const acceptedWord = value.acceptedWord;
  const sampledWords = value.sampledWords as number[];
  const expectedWinner = rosterSnapshot.participants[selectedIndex];
  if (
    value.rejectionLimit !== expectedLimit ||
    selectedIndex < 0 ||
    selectedIndex >= count ||
    acceptedWord >= expectedLimit ||
    acceptedWord % count !== selectedIndex ||
    sampledWords.at(-1) !== acceptedWord ||
    sampledWords.slice(0, -1).some((word) => word < expectedLimit) ||
    !expectedWinner ||
    value.winner.id !== expectedWinner.id ||
    value.winner.displayName !== expectedWinner.displayName
  ) {
    return null;
  }

  return {
    version: 1,
    drawMode,
    drawId: value.drawId,
    timestampIso: value.timestampIso,
    singaporeTime: value.singaporeTime,
    appVersion: value.appVersion,
    algorithmVersion: value.algorithmVersion,
    rosterSnapshot,
    rosterHashSha256: value.rosterHashSha256.toLowerCase(),
    rejectionLimit: expectedLimit,
    sampledWords: [...sampledWords],
    acceptedWord,
    selectedIndex,
    winner: { ...value.winner },
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizedRotationDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function parseIso(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function rotationsLandOnIndex(
  startRotation: number,
  finalRotation: number,
  selectedIndex: number,
  count: number,
): boolean {
  const travel = finalRotation - startRotation;
  if (
    travel < 6 * 360 - SPINNER_ROTATION_TOLERANCE_DEGREES ||
    travel > 7 * 360 + SPINNER_ROTATION_TOLERANCE_DEGREES
  ) return false;
  const target = normalizedRotationDegrees(-selectedIndex * (360 / count));
  const actual = normalizedRotationDegrees(finalRotation);
  const error = Math.abs(actual - target);
  return Math.min(error, 360 - error) <= SPINNER_ROTATION_TOLERANCE_DEGREES;
}

function parseReceiptV2Candidate(value: unknown): DrawReceiptV2 | null {
  if (
    !isRecord(value) || value.version !== 2 ||
    (value.drawMode !== "official" && value.drawMode !== "test") ||
    typeof value.drawId !== "string" || !UUID_PATTERN.test(value.drawId) ||
    value.appVersion !== ELIMINATION_APP_VERSION ||
    value.algorithmVersion !== ELIMINATION_ALGORITHM_VERSION ||
    typeof value.singaporeTime !== "string" || !value.singaporeTime ||
    typeof value.rosterHashSha256 !== "string" || !SHA256_PATTERN.test(value.rosterHashSha256) ||
    typeof value.planHashSha256 !== "string" || !SHA256_PATTERN.test(value.planHashSha256) ||
    value.durationMs !== ELIMINATION_ROUND_DURATION_MS ||
    !Array.isArray(value.rounds)
  ) return null;

  const timestampIso = parseIso(value.timestampIso);
  const startAt = parseIso(value.startAt);
  const revealAt = parseIso(value.revealAt);
  const rosterSnapshot = parseRosterCandidate(value.rosterSnapshot);
  const startRotation = finiteNumber(value.startRotation);
  const finalRotation = finiteNumber(value.finalRotation);
  if (
    !timestampIso || !startAt || !revealAt || !rosterSnapshot ||
    rosterSnapshot.participants.length < MIN_PARTICIPANTS ||
    startRotation == null || startRotation < 0 || startRotation >= 360 || finalRotation == null ||
    value.rounds.length !== rosterSnapshot.participants.length - 1 ||
    Date.parse(startAt) - Date.parse(timestampIso) !== 60_000 ||
    Date.parse(revealAt) - Date.parse(startAt) !== value.rounds.length * ELIMINATION_ROUND_DURATION_MS
  ) return null;

  const remaining = rosterSnapshot.participants.map((participant) => ({ ...participant }));
  const rounds: EliminationReceiptRoundV2[] = [];
  let previousRotation: number | null = null;
  for (let roundIndex = 0; roundIndex < value.rounds.length; roundIndex += 1) {
    const source = value.rounds[roundIndex];
    if (!isRecord(source)) return null;
    const selectedIndex = Number(source.selectedIndex);
    const activeCount = Number(source.activeCount);
    const rejectionLimit = Number(source.rejectionLimit);
    const acceptedWord = Number(source.acceptedWord);
    const sampledWords = source.sampledWords;
    const roundStartedAt = parseIso(source.startedAt);
    const roundRevealAt = parseIso(source.revealAt);
    const roundStartRotation = finiteNumber(source.startRotation);
    const roundFinalRotation = finiteNumber(source.finalRotation);
    const expectedLimit = Math.floor(UINT32_RANGE / remaining.length) * remaining.length;
    const expectedStartMs = Date.parse(startAt) + roundIndex * ELIMINATION_ROUND_DURATION_MS;
    const eliminated = remaining[selectedIndex];
    if (
      source.roundIndex !== roundIndex || activeCount !== remaining.length ||
      !Number.isSafeInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= remaining.length ||
      rejectionLimit !== expectedLimit || !Array.isArray(sampledWords) || sampledWords.length < 1 ||
      !sampledWords.every(isUint32) || !isUint32(acceptedWord) ||
      sampledWords.at(-1) !== acceptedWord ||
      sampledWords.slice(0, -1).some((word) => word < expectedLimit) ||
      acceptedWord >= expectedLimit || acceptedWord % remaining.length !== selectedIndex ||
      typeof source.eliminatedId !== "string" || source.eliminatedId !== eliminated?.id ||
      !isValidParticipant(source.eliminatedParticipant) ||
      source.eliminatedParticipant.id !== eliminated?.id ||
      source.eliminatedParticipant.displayName !== eliminated?.displayName ||
      !roundStartedAt || !roundRevealAt || Date.parse(roundStartedAt) !== expectedStartMs ||
      Date.parse(roundRevealAt) !== expectedStartMs + ELIMINATION_ROUND_DURATION_MS ||
      roundStartRotation == null || roundStartRotation < 0 || roundStartRotation >= 360 ||
      roundFinalRotation == null ||
      (roundIndex === 0 &&
        Math.abs(roundStartRotation - startRotation) > SPINNER_ROTATION_TOLERANCE_DEGREES) ||
      (previousRotation != null &&
        Math.abs(roundStartRotation - normalizedRotationDegrees(previousRotation)) >
          SPINNER_ROTATION_TOLERANCE_DEGREES) ||
      !rotationsLandOnIndex(roundStartRotation, roundFinalRotation, selectedIndex, remaining.length)
    ) return null;

    rounds.push({
      roundIndex,
      activeCount,
      selectedIndex,
      eliminatedId: eliminated.id,
      eliminatedParticipant: { ...eliminated },
      rejectionLimit,
      sampledWords: [...sampledWords],
      acceptedWord,
      startedAt: roundStartedAt,
      revealAt: roundRevealAt,
      startRotation: roundStartRotation,
      finalRotation: roundFinalRotation,
    });
    previousRotation = roundFinalRotation;
    remaining.splice(selectedIndex, 1);
  }

  const winner = remaining[0];
  const selectedIndex = Number(value.selectedIndex);
  if (
    remaining.length !== 1 || !winner || !Number.isSafeInteger(selectedIndex) ||
    selectedIndex < 0 || selectedIndex >= rosterSnapshot.participants.length ||
    rosterSnapshot.participants[selectedIndex]?.id !== winner.id ||
    !isValidParticipant(value.winner) || value.winner.id !== winner.id ||
    value.winner.displayName !== winner.displayName ||
    !rotationsLandOnIndex(startRotation, finalRotation, selectedIndex, rosterSnapshot.participants.length)
  ) return null;

  return {
    version: 2,
    drawMode: value.drawMode,
    drawId: value.drawId,
    timestampIso,
    singaporeTime: value.singaporeTime,
    appVersion: ELIMINATION_APP_VERSION,
    algorithmVersion: ELIMINATION_ALGORITHM_VERSION,
    rosterSnapshot,
    rosterHashSha256: value.rosterHashSha256.toLowerCase(),
    planHashSha256: value.planHashSha256.toLowerCase(),
    durationMs: ELIMINATION_ROUND_DURATION_MS,
    startAt,
    revealAt,
    startRotation,
    finalRotation,
    rounds,
    selectedIndex,
    winner: { ...winner },
  };
}

function parseReceiptCandidate(value: unknown): DrawReceipt | null {
  if (!isRecord(value)) return null;
  return value.version === 2 ? parseReceiptV2Candidate(value) : parseReceiptV1Candidate(value);
}

export function parseStoredReceipts(input: unknown): DrawReceipt[] {
  const decoded = decodeStoredValue(input);
  const candidates =
    isRecord(decoded) && decoded.version === 1 && Array.isArray(decoded.receipts)
      ? decoded.receipts
      : decoded;
  if (!Array.isArray(candidates)) {
    return [];
  }

  return candidates
    .map(parseReceiptCandidate)
    .filter((receipt): receipt is DrawReceipt => receipt !== null)
    .slice(0, 100);
}
