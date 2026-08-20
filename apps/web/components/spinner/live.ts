import {
  MAX_PARTICIPANTS,
  parseStoredReceipts,
  parseStoredRoster,
  type DrawReceiptV1,
  type MotionMode,
  type ParticipantV1,
  type SpinnerDrawMode,
  type SpinnerPersistedDrawMode,
} from "./raffle.ts";
import { SPINNER_BROWSER_REQUEST_TIMEOUT_MS } from "../../lib/spinner/request-timeouts.ts";

export const LIVE_SPINNER_POLL_MS = 2_000;
export const LIVE_SPINNER_ACTIVE_POLL_MS = 750;
export const LIVE_SPINNER_ERROR_RETRY_BASE_MS = 2_500;
export const LIVE_SPINNER_ERROR_RETRY_MAX_MS = 30_000;
export const SPINNER_SESSION_INVALID_EVENT = "mochirii:spinner-session-invalid";
export const PENDING_SPINNER_COMMAND_STORAGE_KEY = "mochirii.raffle.pending-spin.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SpinnerLivePhase = "idle" | "spinning" | "revealed";

export interface SpinnerLiveSnapshotV1 {
  version: 1;
  sessionId: string;
  revision: number;
  phase: SpinnerLivePhase;
  drawMode: SpinnerPersistedDrawMode;
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
}

export interface SpinnerLiveResultV1 {
  snapshot: SpinnerLiveSnapshotV1;
  receipt: DrawReceiptV1 | null;
  commandId: string | null;
  serverNow: string;
}

export interface SpinnerLiveSnapshotCache {
  etag: string | null;
  result: SpinnerLiveResultV1 | null;
}

export interface SpinnerLiveTimeline {
  startDelayMs: number;
  revealDelayMs: number;
  motionDurationMs: number;
  motionDelayMs: number;
}

export interface SpinnerLiveMotionRotations {
  startRotation: number;
  finalRotation: number;
}

export interface SpinnerDrawAnnouncementState {
  countdownDrawId: string | null;
  spinDrawId: string | null;
}

export interface SpinnerServerClockAnchor {
  serverNowMs: number;
  monotonicAtMs: number;
}

export function spinnerLiveErrorRetryDelay(
  consecutiveFailures: number,
  jitterUnit = 0.5,
): number {
  const attempt = Number.isFinite(consecutiveFailures)
    ? Math.max(1, Math.trunc(consecutiveFailures))
    : 1;
  const exponent = Math.min(4, attempt - 1);
  const boundedJitter = Number.isFinite(jitterUnit)
    ? Math.min(1, Math.max(0, jitterUnit))
    : 0.5;
  const jitterFactor = 0.8 + (boundedJitter * 0.4);
  return Math.min(
    LIVE_SPINNER_ERROR_RETRY_MAX_MS,
    Math.round(LIVE_SPINNER_ERROR_RETRY_BASE_MS * (2 ** exponent) * jitterFactor),
  );
}

export function createSpinnerServerClockAnchor(
  serverNow: string,
  monotonicAtMs: number,
): SpinnerServerClockAnchor | null {
  const serverNowMs = Date.parse(serverNow);
  if (!Number.isFinite(serverNowMs) || !Number.isFinite(monotonicAtMs)) return null;
  return { serverNowMs, monotonicAtMs };
}

export function spinnerServerClockNow(
  anchor: SpinnerServerClockAnchor | null,
  monotonicNowMs: number,
): number {
  if (!anchor || !Number.isFinite(monotonicNowMs)) return Number.NaN;
  return anchor.serverNowMs + Math.max(0, monotonicNowMs - anchor.monotonicAtMs);
}

export function reconcileSpinnerServerClockAnchor(
  current: SpinnerServerClockAnchor | null,
  serverNow: string,
  monotonicAtMs: number,
): SpinnerServerClockAnchor | null {
  const candidate = createSpinnerServerClockAnchor(serverNow, monotonicAtMs);
  if (!candidate) return current;
  const currentNowMs = spinnerServerClockNow(current, monotonicAtMs);
  return {
    serverNowMs: Number.isFinite(currentNowMs)
      ? Math.max(candidate.serverNowMs, currentNowMs)
      : candidate.serverNowMs,
    monotonicAtMs,
  };
}

export function spinnerServerClockAnchorForSnapshot(
  current: SpinnerServerClockAnchor | null,
  serverNow: string,
  monotonicAtMs: number,
  snapshotChanged: boolean,
): SpinnerServerClockAnchor | null {
  return snapshotChanged
    ? reconcileSpinnerServerClockAnchor(current, serverNow, monotonicAtMs)
    : current;
}

export function spinnerDrawAnnouncementTransition(
  drawId: string,
  countdownPending: boolean,
  state: SpinnerDrawAnnouncementState,
): { announcement: string | null; state: SpinnerDrawAnnouncementState } {
  if (countdownPending) {
    if (state.countdownDrawId === drawId) return { announcement: null, state };
    return {
      announcement: "The roster is locked. The moonwheel countdown is underway.",
      state: { ...state, countdownDrawId: drawId },
    };
  }
  if (state.spinDrawId === drawId) return { announcement: null, state };
  return {
    announcement: "The shared draw is underway.",
    state: { ...state, spinDrawId: drawId },
  };
}

export function spinnerSkipControlVisible({
  phase,
  wheelMotionDrawId,
  motionStartedDrawId,
  effectsActive,
}: {
  phase: SpinnerLivePhase;
  wheelMotionDrawId: string | null;
  motionStartedDrawId: string | null;
  effectsActive: boolean;
}): boolean {
  return effectsActive || (
    phase === "spinning"
    && wheelMotionDrawId != null
    && motionStartedDrawId === wheelMotionDrawId
  );
}

export function spinnerCountdownSeconds(startedAt: string | null, authoritativeNowMs: number): number {
  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(authoritativeNowMs)) return 0;
  return Math.max(0, Math.ceil((startedAtMs - authoritativeNowMs) / 1_000));
}

export function formatSpinnerCountdown(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function spinnerLiveHasStarted(
  snapshot: SpinnerLiveSnapshotV1,
  authoritativeNowMs: number,
): boolean {
  if (snapshot.phase !== "spinning" || !snapshot.startedAt) return false;
  const startedAtMs = Date.parse(snapshot.startedAt);
  return Number.isFinite(authoritativeNowMs)
    && Number.isFinite(startedAtMs)
    && authoritativeNowMs >= startedAtMs;
}

export function spinnerLivePollInterval(snapshot: SpinnerLiveSnapshotV1, serverNow: string): number {
  return spinnerLiveHasStarted(snapshot, Date.parse(serverNow))
    ? LIVE_SPINNER_ACTIVE_POLL_MS
    : LIVE_SPINNER_POLL_MS;
}

export interface PendingSpinnerCommandV1 {
  version: 1;
  commandId: string;
  expectedRevision: number;
  createdAt: string;
  drawMode: SpinnerDrawMode;
}

export class SpinnerLiveRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "SpinnerLiveRequestError";
    this.status = status;
    this.code = code;
  }
}

export function isTerminalSpinnerSpinFailure(error: unknown): error is SpinnerLiveRequestError {
  return error instanceof SpinnerLiveRequestError && error.code === "spin_result_not_durable";
}

export function spinnerSkipStateForDraw({
  skipRequested,
  skippedDrawId,
  skippedCommandId,
  resultCommandId,
  drawId,
}: {
  skipRequested: boolean;
  skippedDrawId: string | null;
  skippedCommandId: string | null;
  resultCommandId: string | null;
  drawId: string;
}): { skipRequested: boolean; skippedDrawId: string | null; skippedCommandId: string | null } {
  const recoveredPendingDraw = skippedCommandId !== null && skippedCommandId === resultCommandId;
  const appliesToDraw = skipRequested && (skippedDrawId === drawId || recoveredPendingDraw);
  return appliesToDraw
    ? { skipRequested: true, skippedDrawId: drawId, skippedCommandId: null }
    : { skipRequested: false, skippedDrawId: null, skippedCommandId: null };
}

export type SpinnerLiveCommand =
  | {
      action: "set_roster";
      commandId: string;
      expectedRevision: number;
      participants: ParticipantV1[];
    }
  | {
      action: "spin";
      commandId: string;
      expectedRevision: number;
      drawMode: SpinnerDrawMode;
    }
  | {
      action: "reset";
      commandId: string;
      expectedRevision: number;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function integer(value: unknown, minimum = 0): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum ? Number(value) : null;
}

function spinnerEntityTag(value: string | null): string | null {
  const normalized = value?.trim() || "";
  if (
    normalized.length === 0 || normalized.length > 256 ||
    !/^(?:W\/)?"[\x21\x23-\x7e]*"$/u.test(normalized)
  ) return null;
  return normalized;
}

function participant(value: unknown): ParticipantV1 | null {
  const roster = parseStoredRoster({ version: 1, participants: [value] });
  return roster.participants.length === 1 ? roster.participants[0] : null;
}

export function parseSpinnerLiveSnapshot(value: unknown): SpinnerLiveSnapshotV1 | null {
  const source = record(value);
  if (!source || source.version !== 1) return null;
  const rawParticipants = source.participants;
  if (!Array.isArray(rawParticipants) || rawParticipants.length > MAX_PARTICIPANTS) return null;
  const sessionId = typeof source.sessionId === "string" ? source.sessionId : "";
  const revision = integer(source.revision);
  const phase = source.phase;
  const drawMode = source.drawMode === "official" || source.drawMode === "test"
    ? source.drawMode
    : source.drawMode === "unclassified"
      ? source.drawMode
      : null;
  const roster = parseStoredRoster({ version: 1, participants: rawParticipants });
  if (roster.participants.length !== rawParticipants.length) return null;
  const startedAt = isoOrNull(source.startedAt);
  const revealAt = isoOrNull(source.revealAt);
  const durationMs = integer(source.durationMs);
  const startRotation = typeof source.startRotation === "number" && Number.isFinite(source.startRotation)
    ? source.startRotation
    : null;
  const selectedIndex = source.selectedIndex == null ? null : integer(source.selectedIndex);
  const winner = source.winner == null ? null : participant(source.winner);
  const drawId = source.drawId == null ? null : typeof source.drawId === "string" ? source.drawId : "";
  const updatedAt = isoOrNull(source.updatedAt);
  const finalRotation = typeof source.finalRotation === "number" && Number.isFinite(source.finalRotation)
    ? source.finalRotation
    : null;

  if (
    !UUID_PATTERN.test(sessionId) || revision == null || !drawMode || !["idle", "spinning", "revealed"].includes(String(phase)) ||
    roster.participants.length > MAX_PARTICIPANTS || durationMs == null || startRotation == null || finalRotation == null ||
    !updatedAt || drawId === ""
  ) return null;

  if (phase === "idle") {
    if (drawMode !== "unclassified" || durationMs !== 0 || startedAt || revealAt || selectedIndex != null || winner || drawId) return null;
  } else {
    if (drawMode === "unclassified") return null;
    if (
      !startedAt || !revealAt || !drawId || !UUID_PATTERN.test(drawId) ||
      roster.participants.length < 2 || durationMs < 4_000 || durationMs > 30_000
    ) return null;
    if (phase === "spinning" && (selectedIndex != null || winner)) return null;
    if (phase === "revealed") {
      if (selectedIndex == null || !winner || selectedIndex >= roster.participants.length) return null;
      if (winner.id !== roster.participants[selectedIndex]?.id) return null;
    }
    if (Date.parse(revealAt) - Date.parse(startedAt) !== durationMs) return null;
  }

  return {
    version: 1,
    sessionId,
    revision,
    phase: phase as SpinnerLivePhase,
    drawMode,
    participants: roster.participants,
    startedAt,
    revealAt,
    durationMs,
    startRotation,
    finalRotation,
    selectedIndex,
    winner,
    drawId,
    updatedAt,
  };
}

export function parseSpinnerLiveResult(value: unknown): SpinnerLiveResultV1 | null {
  const envelope = record(value);
  const data = record(envelope?.data ?? value);
  const snapshot = parseSpinnerLiveSnapshot(data?.snapshot);
  const serverNow = isoOrNull(data?.serverNow);
  if (!snapshot || !serverNow) return null;
  const commandId = data?.commandId == null
    ? null
    : typeof data.commandId === "string" && UUID_PATTERN.test(data.commandId)
      ? data.commandId
      : undefined;
  if (commandId === undefined) return null;
  const receipt = data?.receipt == null
    ? null
    : parseStoredReceipts({ version: 1, receipts: [data.receipt] })[0] ?? null;
  if (receipt && receipt.drawId !== snapshot.drawId) return null;
  return { snapshot, receipt, commandId, serverNow };
}

export function spinnerLiveTimeline(
  snapshot: SpinnerLiveSnapshotV1,
  authoritativeNow: string | number,
  motionMode: MotionMode,
): SpinnerLiveTimeline {
  const serverNowMs = typeof authoritativeNow === "number"
    ? authoritativeNow
    : Date.parse(authoritativeNow);
  const startedAtMs = snapshot.startedAt ? Date.parse(snapshot.startedAt) : serverNowMs;
  const revealAtMs = snapshot.revealAt ? Date.parse(snapshot.revealAt) : serverNowMs;
  const revealDelayMs = Math.max(0, revealAtMs - serverNowMs);
  const preferredDurationMs = motionMode === "off"
    ? 0
    : motionMode === "reduced"
      ? Math.min(1_650, snapshot.durationMs)
      : snapshot.durationMs;
  const motionStartMs = motionMode === "full"
    ? startedAtMs
    : revealAtMs - preferredDurationMs;
  const startDelayMs = Math.max(0, motionStartMs - serverNowMs);
  const motionDurationMs = motionMode === "off" || revealDelayMs === 0
    ? 0
    : preferredDurationMs;
  const motionDelayMs = motionDurationMs === 0 ? revealDelayMs : motionStartMs - serverNowMs;
  return { startDelayMs, revealDelayMs, motionDurationMs, motionDelayMs };
}

export function spinnerLiveMotionRotations(
  snapshot: SpinnerLiveSnapshotV1,
  motionMode: MotionMode,
): SpinnerLiveMotionRotations {
  if (motionMode === "off") {
    return {
      startRotation: snapshot.startRotation,
      finalRotation: snapshot.startRotation,
    };
  }
  if (motionMode === "reduced") {
    const landingDelta = ((snapshot.finalRotation - snapshot.startRotation) % 360 + 360) % 360;
    return {
      startRotation: snapshot.startRotation,
      finalRotation: snapshot.startRotation + landingDelta,
    };
  }
  return {
    startRotation: snapshot.startRotation,
    finalRotation: snapshot.finalRotation,
  };
}

export function parsePendingSpinnerCommand(value: unknown): PendingSpinnerCommandV1 | null {
  const source = record(value);
  const createdAt = isoOrNull(source?.createdAt);
  const expectedRevision = integer(source?.expectedRevision);
  const commandId = typeof source?.commandId === "string" ? source.commandId : "";
  const drawMode = source?.drawMode === "official" || source?.drawMode === "test"
    ? source.drawMode
    : null;
  if (source?.version !== 1 || !UUID_PATTERN.test(commandId) || expectedRevision == null || !createdAt || !drawMode) return null;
  return { version: 1, commandId, expectedRevision, createdAt, drawMode };
}

export function resolveInitialViewerMotion(
  storedValue: string | null,
  prefersReducedMotion: boolean,
): MotionMode {
  const preferred = storedValue === "full" || storedValue === "reduced" || storedValue === "off"
    ? storedValue
    : "full";
  return preferred === "full" && prefersReducedMotion ? "reduced" : preferred;
}

export function createSpinnerCommandId(): string {
  const provider = globalThis.crypto;
  if (!provider || typeof provider.getRandomValues !== "function") {
    throw new Error("A secure command identifier could not be created.");
  }
  if (typeof provider.randomUUID === "function") return provider.randomUUID();

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

export function createSpinnerLiveSnapshotCache(): SpinnerLiveSnapshotCache {
  return { etag: null, result: null };
}

export function clearSpinnerLiveSnapshotCache(cache: SpinnerLiveSnapshotCache): void {
  cache.etag = null;
  cache.result = null;
}

async function spinnerLiveRequest(
  init: RequestInit,
  snapshotCache: SpinnerLiveSnapshotCache | null = null,
): Promise<SpinnerLiveResultV1> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SPINNER_BROWSER_REQUEST_TIMEOUT_MS);
  try {
    const method = String(init.method || "GET").toUpperCase();
    const cacheForSnapshot = method === "GET" ? snapshotCache : null;
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (cacheForSnapshot?.etag) {
      headers.set("If-None-Match", cacheForSnapshot.etag);
    }
    const response = await fetch("/spinner/live", {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
      headers,
      signal: controller.signal,
    });

    if (response.status === 304) {
      const responseEtag = spinnerEntityTag(response.headers.get("etag"));
      const serverNow = isoOrNull(response.headers.get("x-mochirii-server-time"));
      if (
        !cacheForSnapshot?.etag || !cacheForSnapshot.result ||
        responseEtag !== cacheForSnapshot.etag || !serverNow
      ) {
        if (snapshotCache) clearSpinnerLiveSnapshotCache(snapshotCache);
        throw new SpinnerLiveRequestError(
          "The live draw could not be synchronized.",
          response.status,
        );
      }
      const result = { ...cacheForSnapshot.result, serverNow };
      cacheForSnapshot.result = result;
      return result;
    }

    const payload = await response.json().catch(() => null);
    const parsed = parseSpinnerLiveResult(payload);
    if (!response.ok || !parsed) {
      if ([401, 403, 404].includes(response.status)) {
        if (snapshotCache) clearSpinnerLiveSnapshotCache(snapshotCache);
        window.dispatchEvent(new Event(SPINNER_SESSION_INVALID_EVENT));
      } else if (cacheForSnapshot && response.ok) {
        clearSpinnerLiveSnapshotCache(cacheForSnapshot);
      }
      const errorCode = typeof record(payload)?.error === "string"
        ? String(record(payload)?.error)
        : null;
      const message = errorCode === "spin_result_not_durable"
        ? "That draw attempt was not retained. No winner was kept. Select Spin again to create a new draw."
        : response.status === 409
          ? "The live roster changed in another moderator session. Refreshing the shared stage."
          : "The live draw could not be synchronized.";
      throw new SpinnerLiveRequestError(message, response.status, errorCode);
    }
    if (cacheForSnapshot) {
      const etag = spinnerEntityTag(response.headers.get("etag"));
      if (etag) {
        cacheForSnapshot.etag = etag;
        cacheForSnapshot.result = parsed;
      } else {
        clearSpinnerLiveSnapshotCache(cacheForSnapshot);
      }
    }
    return parsed;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function fetchSpinnerLiveSnapshot(cache: SpinnerLiveSnapshotCache) {
  return spinnerLiveRequest({ method: "GET" }, cache);
}

export function sendSpinnerLiveCommand(command: SpinnerLiveCommand) {
  return spinnerLiveRequest({ method: "POST", body: JSON.stringify(command) });
}
