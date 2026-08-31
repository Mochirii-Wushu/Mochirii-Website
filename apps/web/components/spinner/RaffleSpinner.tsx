"use client";

import Image from "next/image";
import { formatPublicDateTime } from "@/lib/public-date";
import {
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  APP_VERSION,
  MAX_NAME_GRAPHEMES,
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  RECEIPTS_STORAGE_KEY,
  ROSTER_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  DrawAttempt,
  createParticipant,
  moveParticipant,
  normalizeDisplayName,
  parseBulkNames,
  parseStoredMotion,
  parseStoredReceipts,
  parseStoredRoster,
  renumberParticipants,
  validateName,
  type DrawReceipt,
  type MotionMode,
  type ParticipantV1,
  type RevealReason,
  type RosterStateV1,
  type SpinnerDrawMode,
  type SpinnerPersistedDrawMode,
} from "./raffle";
import { startCelebration, type CelebrationHandle } from "./celebration";
import { resolveCelebrationMotionMode } from "./celebration-scene";
import {
  createSpinnerCommandId,
  isTerminalSpinnerSpinFailure,
  parsePendingSpinnerCommand,
  PENDING_SPINNER_COMMAND_STORAGE_KEY,
  sendSpinnerLiveCommand,
  spinnerDrawAnnouncementTransition,
  spinnerLiveHasStarted,
  spinnerLiveMotionRotations,
  spinnerSequenceRoundMotionRotations,
  spinnerSequenceRoundTimeline,
  spinnerSequenceMutationReady,
  spinnerSequenceReceiptForPromotion,
  spinnerSkipControlVisible,
  spinnerSkipStateForDraw,
  spinnerLiveTimeline,
  spinnerServerClockAnchorForSnapshot,
  spinnerServerClockNow,
  type PendingSpinnerCommandV1,
  type SpinnerLiveResultV1,
  type SpinnerLiveSnapshot,
  type SpinnerLiveSnapshotV2,
  type SpinnerServerClockAnchor,
} from "./live";
import { useSpinnerCountdown, useSpinnerSequencePresentation } from "./use-spinner-countdown";
import { useSpinnerLive } from "./use-spinner-live";
import { drawWheel } from "./wheel";

type DrawPhase = "idle" | "spinning" | "revealed";
type WheelMotion = {
  drawId: string;
  animationKey: string;
  startRotation: number;
  finalRotation: number;
  durationMs: number;
  delayMs: number;
};
type WheelMotionStyle = CSSProperties & {
  "--spinner-wheel-start"?: string;
  "--spinner-wheel-finish"?: string;
};
type CelebrationStyle = CSSProperties & {
  "--spinner-celebration-delay"?: string;
};

const RECEIPT_HISTORY_LIMIT = 100;
const SPINNER_PAGE_ID = "spinner-page";

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readStoredJson(key: string) {
  try {
    return { available: true, value: parseJson(window.localStorage.getItem(key)) };
  } catch {
    return { available: false, value: undefined };
  }
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function receiptTimestamp(receipt: DrawReceipt) {
  const timestamp = new Date(receipt.timestampIso);
  return Number.isNaN(timestamp.valueOf())
    ? "Saved draw"
    : `${formatPublicDateTime(timestamp, "Asia/Singapore")} UTC+8`;
}

function receiptId(receipt: DrawReceipt) {
  const record = receipt as unknown as Record<string, unknown>;
  return typeof record.drawId === "string" ? record.drawId : "draw";
}

function filenameTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

export function RaffleSpinner() {
  const [participants, setParticipants] = useState<ParticipantV1[]>([]);
  const [motionMode, setMotionMode] = useState<MotionMode>("full");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [receipts, setReceipts] = useState<DrawReceipt[]>([]);
  const [phase, setPhase] = useState<DrawPhase>("idle");
  const [winnerReceipt, setWinnerReceipt] = useState<DrawReceipt | null>(null);
  const [status, setStatus] = useState("Add at least two names to begin a fair draw.");
  const [drawAnnouncement, setDrawAnnouncement] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [wheelMotion, setWheelMotion] = useState<WheelMotion | null>(null);
  const [effectsActive, setEffectsActive] = useState(false);
  const [celebrationRequestId, setCelebrationRequestId] = useState(0);
  const [celebrationAnimationDelayMs, setCelebrationAnimationDelayMs] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [secureRandomAvailable, setSecureRandomAvailable] = useState(true);
  const [liveReady, setLiveReady] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveWinner, setLiveWinner] = useState<ParticipantV1 | null>(null);
  const [liveWinnerIndex, setLiveWinnerIndex] = useState<number | null>(null);
  const [countdownStartedAt, setCountdownStartedAt] = useState<string | null>(null);
  const [serverClockAnchor, setServerClockAnchor] = useState<SpinnerServerClockAnchor | null>(null);
  const [wheelMotionStartedDrawId, setWheelMotionStartedDrawId] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [activeDrawMode, setActiveDrawMode] = useState<SpinnerPersistedDrawMode>("unclassified");
  const [sequenceSnapshot, setSequenceSnapshot] = useState<SpinnerLiveSnapshotV2 | null>(null);
  const [liveWinnerParticipantCount, setLiveWinnerParticipantCount] = useState(0);
  const [sequenceReceipt, setSequenceReceipt] = useState<DrawReceipt | null>(null);

  const wheelCanvasRef = useRef<HTMLCanvasElement>(null);
  const wheelFrameRef = useRef<HTMLDivElement>(null);
  const celebrationCanvasRef = useRef<HTMLCanvasElement>(null);
  const winnerRevealRef = useRef<HTMLDivElement>(null);
  const pendingCelebrationRef = useRef<{
    drawId: string;
    revealAt: string | null | undefined;
    replay: boolean;
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const pendingReceiptRef = useRef<DrawReceipt | null>(null);
  const drawAttemptRef = useRef(new DrawAttempt<DrawReceipt>());
  const drawLockedRef = useRef(false);
  const skipRequestedRef = useRef(false);
  const skippedDrawIdRef = useRef<string | null>(null);
  const skippedCommandIdRef = useRef<string | null>(null);
  const revealedDrawIdRef = useRef<string | null>(null);
  const pendingRotationRef = useRef(0);
  const effectiveMotionModeRef = useRef<MotionMode>("full");
  const previousEffectiveMotionModeRef = useRef<MotionMode>("full");
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const celebrationRef = useRef<CelebrationHandle | null>(null);
  const liveRevisionRef = useRef(0);
  const liveSnapshotRef = useRef<SpinnerLiveSnapshot | null>(null);
  const liveCommandIdRef = useRef<string | null>(null);
  const liveApplyKeyRef = useRef("");
  const receivedReceiptDrawIdRef = useRef<string | null>(null);
  const promotedSequenceReceiptDrawIdRef = useRef<string | null>(null);
  const commandBusyRef = useRef(false);
  const pendingSpinCommandRef = useRef<PendingSpinnerCommandV1 | null>(null);
  const preparingDrawRef = useRef(false);
  const serverClockAnchorRef = useRef<SpinnerServerClockAnchor | null>(null);
  const countdownAnnouncementDrawIdRef = useRef<string | null>(null);
  const spinStartedAnnouncementDrawIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const refreshLiveSnapshotRef = useRef<(() => void) | null>(null);

  const effectiveMotionMode = resolveCelebrationMotionMode(motionMode, prefersReducedMotion);
  const countdown = useSpinnerCountdown(countdownStartedAt, serverClockAnchor);
  const sequencePresentation = useSpinnerSequencePresentation(sequenceSnapshot, serverClockAnchor);

  const rosterLocked = phase === "spinning" || sequenceSnapshot?.phase === "spinning" || liveBusy || !liveReady;
  const numberedParticipants = useMemo(() => renumberParticipants(participants), [participants]);
  const wheelParticipants = sequencePresentation?.participants ?? participants;
  const canSpin = participants.length >= MIN_PARTICIPANTS
    && participants.length <= MAX_PARTICIPANTS
    && secureRandomAvailable
    && !rosterLocked
    && liveReady;

  const stopScheduledAnimation = useCallback(() => {
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }, []);

  const stopCelebration = useCallback(() => {
    pendingCelebrationRef.current = null;
    celebrationRef.current?.stop();
    celebrationRef.current = null;
    setEffectsActive(false);
  }, []);

  const clearPendingSpinCommand = useCallback(() => {
    pendingSpinCommandRef.current = null;
    try {
      window.localStorage.removeItem(PENDING_SPINNER_COMMAND_STORAGE_KEY);
    } catch {
      // The in-memory identifier still protects retries in this mounted session.
    }
  }, []);

  const pendingSpinCommand = useCallback((expectedRevision: number, drawMode: SpinnerDrawMode) => {
    const existing = pendingSpinCommandRef.current;
    if (existing?.expectedRevision === expectedRevision && existing.drawMode === drawMode) return existing;
    const next: PendingSpinnerCommandV1 = {
      version: 1,
      commandId: createSpinnerCommandId(),
      expectedRevision,
      createdAt: new Date().toISOString(),
      drawMode,
    };
    pendingSpinCommandRef.current = next;
    try {
      window.localStorage.setItem(PENDING_SPINNER_COMMAND_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The identifier remains stable for retries in this mounted session.
    }
    return next;
  }, []);

  const playCelebration = useCallback((
    drawId: string,
    revealAt: string | null | undefined,
    replay = false,
  ) => {
    const canvas = celebrationCanvasRef.current;
    const selectedMode = effectiveMotionModeRef.current;
    stopCelebration();
    if (!canvas || selectedMode === "off") return;
    const authoritativeNowMs = spinnerServerClockNow(serverClockAnchorRef.current, performance.now());
    if (!Number.isFinite(authoritativeNowMs)) return;
    const parsedRevealAtMs = revealAt ? Date.parse(revealAt) : Number.NaN;
    const revealAtMs = replay || !Number.isFinite(parsedRevealAtMs)
      ? authoritativeNowMs
      : parsedRevealAtMs;
    const handle = startCelebration(canvas, {
      mode: selectedMode,
      drawId,
      revealAtMs,
      authoritativeNowMs,
      protectedRegion: winnerRevealRef.current?.getBoundingClientRect() ?? null,
    });
    if (!handle.active) return;
    setCelebrationAnimationDelayMs(-Math.min(4_800, Math.max(0, authoritativeNowMs - revealAtMs)));
    celebrationRef.current = handle;
    setEffectsActive(true);
    void handle.finished.then(() => {
      if (mountedRef.current && celebrationRef.current === handle) {
        celebrationRef.current = null;
        setEffectsActive(false);
      }
    });
  }, [stopCelebration]);

  const queueCelebration = useCallback((
    drawId: string,
    revealAt: string | null | undefined,
    replay = false,
  ) => {
    pendingCelebrationRef.current = { drawId, revealAt, replay };
    setCelebrationRequestId((current) => current + 1);
  }, []);

  useEffect(() => {
    const pending = pendingCelebrationRef.current;
    if (!pending || phase !== "revealed") return;
    const animationFrame = requestAnimationFrame(() => {
      if (pendingCelebrationRef.current !== pending) return;
      pendingCelebrationRef.current = null;
      playCelebration(pending.drawId, pending.revealAt, pending.replay);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [celebrationRequestId, phase, playCelebration]);

  const revealPendingWinner = useCallback((reason: RevealReason = "animation-complete") => {
    const snapshot = liveSnapshotRef.current;
    const receiptCandidate = drawAttemptRef.current.reveal(reason) ?? pendingReceiptRef.current;
    const receipt = receiptCandidate && (!snapshot?.drawId || receiptId(receiptCandidate) === snapshot.drawId)
      ? receiptCandidate
      : null;
    const drawId = receipt ? receiptId(receipt) : snapshot?.drawId ?? null;
    const selectedWinner = receipt?.winner ?? snapshot?.winner ?? null;
    const selectedIndex = receipt?.selectedIndex ?? snapshot?.selectedIndex ?? null;
    if (!drawId || !selectedWinner || selectedIndex == null || revealedDrawIdRef.current === drawId) return;
    stopScheduledAnimation();
    revealedDrawIdRef.current = drawId;
    pendingReceiptRef.current = null;
    drawLockedRef.current = false;
    setCountdownStartedAt(null);
    setWheelMotionStartedDrawId(null);
    setPhase("revealed");
    setWheelMotion(null);
    setWheelRotation(pendingRotationRef.current);
    setWinnerReceipt(receipt);
    setLiveWinner(selectedWinner);
    setLiveWinnerIndex(selectedIndex);
    setLiveWinnerParticipantCount(snapshot?.participants.length ?? 0);
    if (receipt) {
      setReceipts((current) => [receipt, ...current.filter((item) => receiptId(item) !== receiptId(receipt))]
        .slice(0, RECEIPT_HISTORY_LIMIT));
    }
    const winnerStatus = `Winner: ${selectedWinner.displayName}.`;
    setStatus(winnerStatus);
    setDrawAnnouncement(winnerStatus);
    if (!skipRequestedRef.current && !document.hidden) {
      queueCelebration(drawId, snapshot?.revealAt);
    }
  }, [queueCelebration, stopScheduledAnimation]);

  const applyLiveResult = useCallback((result: SpinnerLiveResultV1) => {
    const { snapshot, receipt, commandId, serverNow } = result;
    if (snapshot.revision < liveRevisionRef.current) return;
    liveCommandIdRef.current = snapshot.drawId ? commandId : null;
    const planKey = snapshot.version === 2 ? snapshot.planHashSha256 : "v1";
    const applyKey = `${snapshot.version}:${snapshot.revision}:${snapshot.phase}:${snapshot.drawMode}:${snapshot.drawId || "idle"}:${planKey}`;
    const sameSnapshot = liveApplyKeyRef.current === applyKey;
    const newReceipt = receipt && receivedReceiptDrawIdRef.current !== receiptId(receipt);
    const monotonicNowMs = performance.now();
    const nextClockAnchor = spinnerServerClockAnchorForSnapshot(
      serverClockAnchorRef.current,
      serverNow,
      monotonicNowMs,
      !sameSnapshot,
    );
    const serverNowMs = spinnerServerClockNow(nextClockAnchor, monotonicNowMs);
    if (nextClockAnchor && nextClockAnchor !== serverClockAnchorRef.current) {
      serverClockAnchorRef.current = nextClockAnchor;
      setServerClockAnchor(nextClockAnchor);
    }
    if (sameSnapshot && !newReceipt) return;

    if (receipt) {
      pendingReceiptRef.current = receipt;
      receivedReceiptDrawIdRef.current = receiptId(receipt);
      if (snapshot.version === 2) setSequenceReceipt(receipt);
    } else if (!sameSnapshot && snapshot.version === 2) {
      const retainedReceipt = pendingReceiptRef.current;
      setSequenceReceipt(
        retainedReceipt?.version === 2 && retainedReceipt.drawId === snapshot.drawId
          ? retainedReceipt
          : null,
      );
    }
    const storedCommand = pendingSpinCommandRef.current;
    if (receipt || (storedCommand && snapshot.revision > storedCommand.expectedRevision)) {
      clearPendingSpinCommand();
    }

    if (sameSnapshot) {
      if (snapshot.version === 2) return;
      setLiveWinner(receipt?.winner ?? snapshot.winner);
      setLiveWinnerIndex(receipt?.selectedIndex ?? snapshot.selectedIndex);
      setLiveWinnerParticipantCount(snapshot.participants.length);
      const revealAtMs = snapshot.revealAt ? Date.parse(snapshot.revealAt) : 0;
      if (snapshot.phase === "revealed" || serverNowMs >= revealAtMs) {
        revealPendingWinner("animation-complete");
      }
      return;
    }

    liveApplyKeyRef.current = applyKey;
    liveRevisionRef.current = snapshot.revision;
    liveSnapshotRef.current = snapshot;
    setLiveReady(true);
    setParticipants(snapshot.participants);
    setActiveDrawMode(snapshot.drawMode);

    if (snapshot.version === 2) {
      stopScheduledAnimation();
      preparingDrawRef.current = false;
      drawLockedRef.current = true;
      const skipState = spinnerSkipStateForDraw({
        skipRequested: skipRequestedRef.current,
        skippedDrawId: skippedDrawIdRef.current,
        skippedCommandId: skippedCommandIdRef.current,
        resultCommandId: commandId,
        drawId: snapshot.drawId,
      });
      skipRequestedRef.current = skipState.skipRequested;
      skippedDrawIdRef.current = skipState.skippedDrawId;
      skippedCommandIdRef.current = skipState.skippedCommandId;
      setWinnerReceipt(null);
      setSequenceSnapshot(snapshot);
      return;
    }
    setSequenceSnapshot(null);
    setSequenceReceipt(null);

    if (snapshot.phase === "idle") {
      stopScheduledAnimation();
      drawAttemptRef.current.reset();
      drawLockedRef.current = false;
      if (!pendingSpinCommandRef.current) {
        skipRequestedRef.current = false;
        skippedDrawIdRef.current = null;
        skippedCommandIdRef.current = null;
      }
      pendingReceiptRef.current = null;
      receivedReceiptDrawIdRef.current = null;
      promotedSequenceReceiptDrawIdRef.current = null;
      revealedDrawIdRef.current = null;
      countdownAnnouncementDrawIdRef.current = null;
      spinStartedAnnouncementDrawIdRef.current = null;
      setCountdownStartedAt(null);
      setWheelMotionStartedDrawId(null);
      setDrawAnnouncement("");
      setPhase("idle");
      setWheelMotion(null);
      setWheelRotation(snapshot.finalRotation);
      setWinnerReceipt(null);
      setLiveWinner(null);
      setLiveWinnerIndex(null);
      setLiveWinnerParticipantCount(0);
      setStatus(snapshot.participants.length >= MIN_PARTICIPANTS
        ? `${snapshot.participants.length} names are live and ready for a fair draw.`
        : `Add ${Math.max(0, MIN_PARTICIPANTS - snapshot.participants.length)} more ${snapshot.participants.length === 1 ? "name" : "names"} to begin.`);
      return;
    }

    const liveDrawId = snapshot.drawId;
    if (!liveDrawId) {
      drawLockedRef.current = true;
      setLiveReady(false);
      setWheelMotion(null);
      setNotice("The live draw state is unavailable.");
      setStatus("The live draw state is unavailable.");
      return;
    }

    pendingRotationRef.current = snapshot.finalRotation;
    setLiveWinner(receipt?.winner ?? snapshot.winner);
    setLiveWinnerIndex(receipt?.selectedIndex ?? snapshot.selectedIndex);
    setLiveWinnerParticipantCount(snapshot.participants.length);
    const revealAtMs = snapshot.revealAt ? Date.parse(snapshot.revealAt) : 0;
    if (snapshot.phase === "revealed" || serverNowMs >= revealAtMs) {
      setWheelRotation(snapshot.finalRotation);
      revealPendingWinner("animation-complete");
      return;
    }

    stopScheduledAnimation();
    drawLockedRef.current = true;
    const skipState = spinnerSkipStateForDraw({
      skipRequested: skipRequestedRef.current,
      skippedDrawId: skippedDrawIdRef.current,
      skippedCommandId: skippedCommandIdRef.current,
      resultCommandId: commandId,
      drawId: liveDrawId,
    });
    skipRequestedRef.current = skipState.skipRequested;
    skippedDrawIdRef.current = skipState.skippedDrawId;
    skippedCommandIdRef.current = skipState.skippedCommandId;
    preparingDrawRef.current = false;
    revealedDrawIdRef.current = null;
    setWinnerReceipt(null);
    setPhase("spinning");
    const countdownPending = !spinnerLiveHasStarted(snapshot, serverNowMs);
    setCountdownStartedAt(countdownPending ? snapshot.startedAt : null);
    setWheelMotionStartedDrawId(null);
    setWheelMotion(null);
    setWheelRotation(snapshot.startRotation);
    const selectedMotion = effectiveMotionModeRef.current;
    const timeline = spinnerLiveTimeline(snapshot, serverNowMs, selectedMotion);
    const rotations = spinnerLiveMotionRotations(snapshot, selectedMotion);
    const drawStatus = countdownPending
      ? "The roster is locked. The moonwheel countdown is underway."
      : skipRequestedRef.current
        ? "Effects skipped. The stored result will appear at the shared reveal time."
        : "The shared draw is underway.";
    setStatus(drawStatus);
    const announcement = spinnerDrawAnnouncementTransition(liveDrawId, countdownPending, {
      countdownDrawId: countdownAnnouncementDrawIdRef.current,
      spinDrawId: spinStartedAnnouncementDrawIdRef.current,
    });
    countdownAnnouncementDrawIdRef.current = announcement.state.countdownDrawId;
    spinStartedAnnouncementDrawIdRef.current = announcement.state.spinDrawId;
    if (announcement.announcement) setDrawAnnouncement(announcement.announcement);

    if (!countdownPending && timeline.motionDurationMs > 0 && !skipRequestedRef.current) {
      setWheelMotion({
        drawId: liveDrawId,
        animationKey: liveDrawId,
        startRotation: rotations.startRotation,
        finalRotation: rotations.finalRotation,
        durationMs: timeline.motionDurationMs,
        delayMs: timeline.motionDelayMs,
      });
    }
    revealTimerRef.current = countdownPending
      ? setTimeout(() => {
          liveApplyKeyRef.current = "";
          void refreshLiveSnapshotRef.current?.();
        }, timeline.startDelayMs + 60)
      : setTimeout(
          () => revealPendingWinner(selectedMotion === "off" ? "off" : "animation-complete"),
          timeline.revealDelayMs + 80,
        );
  }, [clearPendingSpinCommand, revealPendingWinner, stopScheduledAnimation]);

  useEffect(() => {
    const snapshot = sequenceSnapshot;
    const presentation = sequencePresentation;
    if (!snapshot || !presentation) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const drawId = snapshot.drawId;
      const authoritativeNowMs = spinnerServerClockNow(serverClockAnchorRef.current, performance.now());
      setActiveDrawMode(snapshot.drawMode);
      setWheelMotion(null);
      setWheelMotionStartedDrawId(null);
      pendingRotationRef.current = presentation.settledRotation;

    if (presentation.stage === "countdown") {
      stopCelebration();
      drawLockedRef.current = true;
      setLiveWinner(null);
      setLiveWinnerIndex(null);
      setLiveWinnerParticipantCount(0);
      setPhase("spinning");
      setCountdownStartedAt(snapshot.startedAt);
      setWheelRotation(presentation.settledRotation);
      setStatus(snapshot.drawMode === "test"
        ? "Test draw: the roster is locked and the one-minute moonwheel countdown is underway."
        : "The roster is locked. The one-minute moonwheel countdown is underway.");
      const announcement = spinnerDrawAnnouncementTransition(drawId, true, {
        countdownDrawId: countdownAnnouncementDrawIdRef.current,
        spinDrawId: spinStartedAnnouncementDrawIdRef.current,
      });
      countdownAnnouncementDrawIdRef.current = announcement.state.countdownDrawId;
      spinStartedAnnouncementDrawIdRef.current = announcement.state.spinDrawId;
      if (announcement.announcement) setDrawAnnouncement(announcement.announcement);
        return;
    }

    setCountdownStartedAt(null);
    if (presentation.stage === "round-spinning" && presentation.round) {
      const roundNumber = presentation.round.roundIndex + 1;
      const animationKey = `${drawId}:${presentation.round.roundIndex}`;
      const selectedMotion = effectiveMotionMode;
      const timeline = spinnerSequenceRoundTimeline(
        presentation.round,
        authoritativeNowMs,
        selectedMotion,
      );
      const rotations = spinnerSequenceRoundMotionRotations(presentation.round, selectedMotion);
      drawLockedRef.current = true;
      setLiveWinner(null);
      setLiveWinnerIndex(null);
      setLiveWinnerParticipantCount(0);
      setPhase("spinning");
      setWheelRotation(presentation.round.startRotation);
      if (timeline.motionDurationMs > 0 && !skipRequestedRef.current) {
        setWheelMotion({
          drawId,
          animationKey,
          startRotation: rotations.startRotation,
          finalRotation: rotations.finalRotation,
          durationMs: timeline.motionDurationMs,
          delayMs: timeline.motionDelayMs,
        });
      }
      setStatus(skipRequestedRef.current
        ? `Effects skipped · elimination round ${roundNumber} of ${presentation.roundCount} continues on server time.`
        : `${snapshot.drawMode === "test" ? "Test draw · " : ""}Elimination round ${roundNumber} of ${presentation.roundCount}: ${presentation.participants.length} remain.`);
      setDrawAnnouncement(roundNumber === 1
        ? "The shared elimination draw is underway."
        : `Elimination round ${roundNumber} has begun. ${presentation.participants.length} entrants remain.`);
        return;
    }

    const finalWinner = presentation.winner;
    if (!finalWinner) return;
    const originalIndex = snapshot.participants.findIndex((participant) => participant.id === finalWinner.id);
    const mutationReady = spinnerSequenceMutationReady(snapshot, presentation);
    drawLockedRef.current = !mutationReady;
    setWheelRotation(presentation.settledRotation);
    setPhase("revealed");
    setLiveWinner(finalWinner);
    setLiveWinnerIndex(originalIndex);
    setLiveWinnerParticipantCount(snapshot.participants.length);
    const winnerStatus = `Winner: ${finalWinner.displayName}.`;
    setStatus(winnerStatus);
    setDrawAnnouncement(winnerStatus);
    if (revealedDrawIdRef.current !== drawId) {
      if (skipRequestedRef.current) {
        revealedDrawIdRef.current = drawId;
      } else if (!document.hidden) {
        revealedDrawIdRef.current = drawId;
        queueCelebration(drawId, snapshot.revealAt);
      }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    effectiveMotionMode,
    queueCelebration,
    sequencePresentation,
    sequenceSnapshot,
    stopCelebration,
  ]);

  useEffect(() => {
    if (!sequenceSnapshot || !sequencePresentation) return;
    const retainedReceipt = spinnerSequenceReceiptForPromotion(
      sequenceSnapshot,
      sequencePresentation,
      sequenceReceipt,
    );
    if (!retainedReceipt || promotedSequenceReceiptDrawIdRef.current === retainedReceipt.drawId) return;
    promotedSequenceReceiptDrawIdRef.current = retainedReceipt.drawId;
    pendingReceiptRef.current = null;
    setWinnerReceipt(retainedReceipt);
    setReceipts((current) => [
      retainedReceipt,
      ...current.filter((item) => receiptId(item) !== retainedReceipt.drawId),
    ].slice(0, RECEIPT_HISTORY_LIMIT));
  }, [sequencePresentation, sequenceReceipt, sequenceSnapshot]);

  const { connected: liveConnected, error: liveError, refresh: refreshLiveSnapshot } = useSpinnerLive({
    enabled: hydrated,
    onResult: applyLiveResult,
  });

  useEffect(() => {
    refreshLiveSnapshotRef.current = () => void refreshLiveSnapshot();
    return () => {
      refreshLiveSnapshotRef.current = null;
    };
  }, [refreshLiveSnapshot]);

  useEffect(() => {
    const snapshot = liveSnapshotRef.current;
    if (
      snapshot?.version !== 1 || phase !== "spinning" || countdown.remainingSeconds !== 0 || !snapshot.drawId ||
      spinStartedAnnouncementDrawIdRef.current === snapshot.drawId
    ) return;
    const announcement = spinnerDrawAnnouncementTransition(snapshot.drawId, false, {
      countdownDrawId: countdownAnnouncementDrawIdRef.current,
      spinDrawId: spinStartedAnnouncementDrawIdRef.current,
    });
    countdownAnnouncementDrawIdRef.current = announcement.state.countdownDrawId;
    spinStartedAnnouncementDrawIdRef.current = announcement.state.spinDrawId;
    setStatus("The shared draw is underway.");
    if (announcement.announcement) setDrawAnnouncement(announcement.announcement);
  }, [countdown.remainingSeconds, phase]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(query.matches);
    updatePreference();
    query.addEventListener("change", updatePreference);
    return () => query.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const rosterStorage = readStoredJson(ROSTER_STORAGE_KEY);
    const receiptStorage = readStoredJson(RECEIPTS_STORAGE_KEY);
    const settingsStorage = readStoredJson(SETTINGS_STORAGE_KEY);
    const storedRoster = parseStoredRoster(rosterStorage.value);
    const storedReceipts = parseStoredReceipts(receiptStorage.value);
    const rawSettings = settingsStorage.value;
    const storedPendingCommand = parsePendingSpinnerCommand(
      readStoredJson(PENDING_SPINNER_COMMAND_STORAGE_KEY).value,
    );
    const hasStoredMotion = rawSettings !== undefined;
    const systemPrefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const storedMotion = hasStoredMotion
      ? parseStoredMotion(rawSettings)
      : systemPrefersReducedMotion ? "reduced" : "full";
    const runtimeCrypto = Reflect.get(globalThis, "crypto") as
      | { getRandomValues?: unknown }
      | undefined;
    const cryptoAvailable = typeof runtimeCrypto?.getRandomValues === "function";
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setParticipants(storedRoster.participants);
      setReceipts(storedReceipts.slice(0, RECEIPT_HISTORY_LIMIT));
      setMotionMode(storedMotion);
      setPrefersReducedMotion(systemPrefersReducedMotion);
      effectiveMotionModeRef.current = resolveCelebrationMotionMode(
        storedMotion,
        systemPrefersReducedMotion,
      );
      pendingSpinCommandRef.current = storedPendingCommand;
      setSecureRandomAvailable(cryptoAvailable);
      setHydrated(true);
      if (!rosterStorage.available || !receiptStorage.available || !settingsStorage.available) {
        setNotice("Browser storage is unavailable. This session still works, but export anything you need to keep.");
      }
      if (!cryptoAvailable) {
        setStatus("Secure commands are unavailable in this browser. Drawing is disabled.");
      } else if (storedRoster.participants.length >= MIN_PARTICIPANTS) {
        setStatus("Loading the shared roster.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    effectiveMotionModeRef.current = effectiveMotionMode;
    const previousMode = previousEffectiveMotionModeRef.current;
    previousEffectiveMotionModeRef.current = effectiveMotionMode;
    if (previousMode === effectiveMotionMode) return;
    stopCelebration();
    if (liveSnapshotRef.current?.version === 1 && liveSnapshotRef.current.phase === "spinning") {
      liveApplyKeyRef.current = "";
      void refreshLiveSnapshot();
    }
  }, [effectiveMotionMode, refreshLiveSnapshot, stopCelebration]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const roster: RosterStateV1 = { version: 1, participants };
      window.localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(roster));
    } catch {
      queueMicrotask(() => setNotice("The roster could not be saved in this browser. Downloads still work."));
    }
  }, [hydrated, participants]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, motionMode }));
    } catch {
      queueMicrotask(() => setNotice("The motion preference could not be saved in this browser."));
    }
  }, [hydrated, motionMode]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify({
        version: 1,
        receipts: receipts.slice(0, RECEIPT_HISTORY_LIMIT),
      }));
    } catch {
      queueMicrotask(() => setNotice("Draw receipts could not be saved in this browser. Export the latest receipt now."));
    }
  }, [hydrated, receipts]);

  useEffect(() => {
    const canvas = wheelCanvasRef.current;
    const frame = wheelFrameRef.current;
    if (!canvas || !frame) return;
    const render = () => drawWheel(canvas, wheelParticipants);
    render();
    void document.fonts?.ready.then(() => {
      if (mountedRef.current) render();
    });
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [wheelParticipants, wheelMotion?.animationKey]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        stopCelebration();
        if (liveSnapshotRef.current?.phase === "spinning") {
          setStatus("The stored draw continues live. Its result will appear at the scheduled reveal time.");
        }
      } else if (!document.hidden && liveSnapshotRef.current?.phase === "spinning") {
        const snapshot = liveSnapshotRef.current;
        if (snapshot.version === 1) {
          liveApplyKeyRef.current = "";
        } else if (
          sequencePresentation?.stage === "complete" && !skipRequestedRef.current &&
          revealedDrawIdRef.current !== snapshot.drawId
        ) {
          revealedDrawIdRef.current = snapshot.drawId;
          queueCelebration(snapshot.drawId, snapshot.revealAt);
        }
      }
    };
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === document.getElementById(SPINNER_PAGE_ID));
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [queueCelebration, sequencePresentation, stopCelebration]);

  useEffect(() => {
    if (!liveError) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) stopCelebration();
    });
    return () => {
      cancelled = true;
    };
  }, [liveError, stopCelebration]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopScheduledAnimation();
      celebrationRef.current?.stop();
      celebrationRef.current = null;
    };
  }, [stopScheduledAnimation]);

  const setRoster = useCallback((next: ParticipantV1[]) => {
    if (drawLockedRef.current || commandBusyRef.current || liveBusy || !liveReady) return;
    commandBusyRef.current = true;
    clearPendingSpinCommand();
    drawAttemptRef.current.reset();
    stopCelebration();
    setParticipants(next);
    setWinnerReceipt(null);
    setLiveWinner(null);
    setLiveWinnerIndex(null);
    setPhase("idle");
    setLiveBusy(true);
    setStatus("Publishing the ordered roster to the shared stage.");

    void (async () => {
      try {
        const result = await sendSpinnerLiveCommand({
          action: "set_roster",
          commandId: createSpinnerCommandId(),
          expectedRevision: liveRevisionRef.current,
          participants: next.map((participant) => ({ ...participant })),
        });
        if (!mountedRef.current) return;
        applyLiveResult(result);
        setNotice(null);
      } catch (error) {
        if (!mountedRef.current) return;
        setNotice(error instanceof Error ? error.message : "The shared roster could not be updated.");
        await refreshLiveSnapshot();
      } finally {
        commandBusyRef.current = false;
        if (mountedRef.current) setLiveBusy(false);
      }
    })();
  }, [applyLiveResult, clearPendingSpinCommand, liveBusy, liveReady, refreshLiveSnapshot, stopCelebration]);

  const addParticipant = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (rosterLocked) return;
    const candidate = normalizeDisplayName(draftName);
    const validation = validateName(candidate, participants);
    if (!validation.valid) {
      setNotice(validation.error);
      return;
    }
    try {
      setRoster([...participants, createParticipant(validation.normalizedName)]);
      setDraftName("");
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The name could not be added.");
    }
  };

  const saveEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editId || rosterLocked) return;
    const validation = validateName(editName, participants, editId);
    if (!validation.valid) {
      setNotice(validation.error);
      return;
    }
    setRoster(participants.map((participant) => participant.id === editId
      ? { ...participant, displayName: validation.normalizedName }
      : participant));
    setEditId(null);
    setEditName("");
    setNotice(null);
  };

  const beginEdit = (participant: ParticipantV1) => {
    if (rosterLocked) return;
    setEditId(participant.id);
    setEditName(participant.displayName);
    setNotice(null);
  };

  const removeParticipant = (id: string) => {
    if (rosterLocked) return;
    setRoster(participants.filter((participant) => participant.id !== id));
  };

  const moveRosterParticipant = (fromIndex: number, toIndex: number) => {
    if (rosterLocked) return;
    setRoster(moveParticipant(participants, fromIndex, toIndex));
  };

  const addBulkNames = () => {
    if (rosterLocked) return;
    const parsed = parseBulkNames(bulkText.replaceAll("\t", "\n"), participants);
    const room = Math.max(0, MAX_PARTICIPANTS - participants.length);
    const names = parsed.names.slice(0, room);
    const errors = [...parsed.errors];
    if (parsed.names.length > room) {
      errors.push(`Only the first ${room} valid names fit; a roster can contain at most ${MAX_PARTICIPANTS}.`);
    }
    if (names.length === 0) {
      setBulkErrors(errors.length ? errors : ["No valid names were found."]);
      return;
    }
    try {
      const added = names.map((name) => createParticipant(name));
      setRoster([...participants, ...added]);
      setBulkText("");
      setBulkErrors(errors);
      if (errors.length === 0) setBulkOpen(false);
      setNotice(`${added.length} ${added.length === 1 ? "name" : "names"} added.`);
    } catch (error) {
      setBulkErrors([error instanceof Error ? error.message : "The names could not be added."]);
    }
  };

  const clearRoster = () => {
    if (rosterLocked || participants.length === 0) return;
    if (!window.confirm(`Clear all ${participants.length} names from the shared roster?`)) return;
    setRoster([]);
    setNotice("Roster cleared.");
  };

  const importRoster = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || rosterLocked) return;
    try {
      const text = await file.text();
      let imported: ParticipantV1[] = [];
      const parsedJson = parseJson(text);
      if (parsedJson !== undefined) {
        const record = parsedJson && typeof parsedJson === "object" ? parsedJson as Record<string, unknown> : null;
        const source = record?.roster ?? parsedJson;
        imported = parseStoredRoster(source).participants;
        if (imported.length === 0 && Array.isArray(source)) {
          const rawNames = source.map((item) => typeof item === "string"
            ? item
            : item && typeof item === "object" && typeof (item as Record<string, unknown>).displayName === "string"
              ? String((item as Record<string, unknown>).displayName)
              : "").filter(Boolean).join("\n");
          const parsed = parseBulkNames(rawNames.replaceAll("\t", "\n"), []);
          if (parsed.errors.length) throw new Error(parsed.errors.join(" "));
          imported = parsed.names.map((name) => createParticipant(name));
        }
      } else {
        const parsed = parseBulkNames(text.replaceAll("\t", "\n"), []);
        if (parsed.errors.length) throw new Error(parsed.errors.join(" "));
        imported = parsed.names.map((name) => createParticipant(name));
      }
      if (imported.length === 0) throw new Error("The file does not contain a valid roster.");
      if (imported.length > MAX_PARTICIPANTS) throw new Error(`A roster can contain at most ${MAX_PARTICIPANTS} names.`);
      setRoster(imported);
      setNotice(`${imported.length} names imported from ${file.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The roster could not be imported.");
    }
  };

  const exportRoster = () => {
    const roster: RosterStateV1 = { version: 1, participants };
    downloadJson(`Mōchirīī-roster-${filenameTimestamp()}.json`, roster);
    setNotice("Roster downloaded. The shared roster remains live until a moderator clears it.");
  };

  const exportReceipt = (receipt: DrawReceipt) => {
    downloadJson(`Mōchirīī-receipt-${receiptId(receipt)}.json`, receipt);
    setNotice("Receipt downloaded. It makes the selection arithmetic replayable, not tamper-proof.");
  };

  const startDraw = async () => {
    if (!canSpin || drawLockedRef.current || commandBusyRef.current) return;
    const drawMode: SpinnerDrawMode = testMode ? "test" : "official";
    const confirmed = window.confirm(drawMode === "test"
      ? "Start a TEST spin? It will appear on the private live stage, but it will not send a guild announcement or publish a monthly winner."
      : "Start the OFFICIAL monthly draw? This selection can publish the month’s winner after the authoritative reveal."
    );
    if (!confirmed) return;
    commandBusyRef.current = true;
    drawLockedRef.current = true;
    preparingDrawRef.current = true;
    setLiveBusy(true);
    skipRequestedRef.current = false;
    skippedDrawIdRef.current = null;
    skippedCommandIdRef.current = null;
    revealedDrawIdRef.current = null;
    setPhase("spinning");
    setNotice(null);
    setStatus("Freezing the live roster and creating one secure draw…");
    const attempt = new DrawAttempt<DrawReceipt>();
    drawAttemptRef.current = attempt;
    let command: PendingSpinnerCommandV1 | null = null;
    try {
      const pendingCommand = pendingSpinCommand(liveRevisionRef.current, drawMode);
      command = pendingCommand;
      const liveResult = await sendSpinnerLiveCommand({
        action: "spin",
        commandId: pendingCommand.commandId,
        expectedRevision: pendingCommand.expectedRevision,
        drawMode: pendingCommand.drawMode,
      });
      if (!mountedRef.current) return;
      if (liveResult.snapshot.version === 1) {
        if (!liveResult.receipt) throw new Error("The secure draw receipt was not returned to the moderator.");
        const receipt = await attempt.begin(async () => liveResult.receipt!);
        pendingReceiptRef.current = receipt;
      } else {
        drawAttemptRef.current.reset();
        pendingReceiptRef.current = null;
      }
      applyLiveResult(liveResult);
    } catch (error) {
      preparingDrawRef.current = false;
      const observedSnapshot = liveSnapshotRef.current;
      const recoveredDraw = command !== null &&
        liveCommandIdRef.current === command.commandId &&
        observedSnapshot?.drawId !== null &&
        (observedSnapshot?.phase === "spinning" || observedSnapshot?.phase === "revealed");
      if (!recoveredDraw) {
        drawAttemptRef.current.reset();
        drawLockedRef.current = false;
        pendingReceiptRef.current = null;
        setPhase("idle");
      }
      if (isTerminalSpinnerSpinFailure(error)) {
        clearPendingSpinCommand();
        skipRequestedRef.current = false;
        skippedDrawIdRef.current = null;
        skippedCommandIdRef.current = null;
      }
      const message = recoveredDraw
        ? "The live draw was recovered and continues to its stored reveal."
        : error instanceof Error ? error.message : "A secure draw could not be created.";
      setNotice(message);
      if (!recoveredDraw || observedSnapshot?.phase === "spinning") setStatus(message);
      if (/secure|command identifier/i.test(message)) setSecureRandomAvailable(false);
      await refreshLiveSnapshot();
    } finally {
      commandBusyRef.current = false;
      if (mountedRef.current) setLiveBusy(false);
    }
  };

  const spinAgain = () => {
    if (
      commandBusyRef.current || liveBusy || !liveReady ||
      (sequenceSnapshot && !spinnerSequenceMutationReady(sequenceSnapshot, sequencePresentation))
    ) return;
    commandBusyRef.current = true;
    clearPendingSpinCommand();
    stopCelebration();
    drawAttemptRef.current.reset();
    setWinnerReceipt(null);
    setLiveWinner(null);
    setLiveWinnerIndex(null);
    setLiveBusy(true);
    setStatus("Preparing the shared stage for another draw.");
    void (async () => {
      try {
        const result = await sendSpinnerLiveCommand({
          action: "reset",
          commandId: createSpinnerCommandId(),
          expectedRevision: liveRevisionRef.current,
        });
        if (mountedRef.current) applyLiveResult(result);
      } catch (error) {
        if (!mountedRef.current) return;
        setNotice(error instanceof Error ? error.message : "The shared stage could not be reset.");
        await refreshLiveSnapshot();
      } finally {
        commandBusyRef.current = false;
        if (mountedRef.current) setLiveBusy(false);
      }
    })();
  };

  const removeWinner = () => {
    const selectedWinner = winnerReceipt?.winner ?? liveWinner;
    if (!selectedWinner) return;
    stopCelebration();
    const next = participants.filter((participant) => participant.id !== selectedWinner.id);
    setRoster(next);
    setNotice(`${selectedWinner.displayName} was removed; numbering and wheel segments were recalculated.`);
  };

  const replayCelebration = () => {
    if (!(winnerReceipt?.winner ?? liveWinner)) return;
    if (effectiveMotionModeRef.current === "off") {
      setNotice("Celebration effects are off. Choose Full or Reduced to replay them.");
      return;
    }
    const snapshot = liveSnapshotRef.current;
    const drawId = winnerReceipt ? receiptId(winnerReceipt) : snapshot?.drawId;
    if (!drawId) return;
    queueCelebration(drawId, snapshot?.revealAt, true);
  };

  const skipEffects = () => {
    skipRequestedRef.current = true;
    skippedCommandIdRef.current = pendingSpinCommandRef.current?.commandId ?? null;
    if (drawLockedRef.current) {
      setWheelMotion(null);
      const snapshot = liveSnapshotRef.current;
      if (snapshot?.phase === "spinning") {
        skippedDrawIdRef.current = snapshot.drawId;
        setWheelRotation(snapshot.version === 2
          ? sequencePresentation?.settledRotation ?? snapshot.startRotation
          : snapshot.startRotation);
      }
      setStatus("Effects skipped. The stored result will appear at the shared reveal time.");
    }
    stopCelebration();
  };

  const toggleFullscreen = async () => {
    try {
      const spinnerPage = document.getElementById(SPINNER_PAGE_ID);
      if (!spinnerPage) throw new Error("Spinner stage unavailable.");
      if (document.fullscreenElement === spinnerPage) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await spinnerPage.requestFullscreen();
      }
    } catch {
      setNotice("Fullscreen could not be opened by this browser.");
    }
  };

  const onAddKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setDraftName("");
      setNotice(null);
    }
  };

  const visibleWinner = winnerReceipt?.winner ?? liveWinner;
  const visibleWinnerIndex = winnerReceipt?.selectedIndex ?? liveWinnerIndex;
  const visibleWinnerParticipantCount = winnerReceipt?.rosterSnapshot.participants.length
    ?? liveWinnerParticipantCount;
  const wheelMotionHasStarted = phase === "spinning"
    && wheelMotion?.animationKey != null
    && wheelMotionStartedDrawId === wheelMotion.animationKey;
  const skipControlVisible = spinnerSkipControlVisible({
    phase,
    wheelMotionDrawId: wheelMotion?.animationKey ?? null,
    motionStartedDrawId: wheelMotionStartedDrawId,
    effectsActive,
  });
  const showCountdownTimer = phase === "spinning"
    && countdownStartedAt !== null
    && countdown.remainingSeconds !== null;
  const activeSequenceRound = sequencePresentation?.stage === "round-spinning"
    ? sequencePresentation
    : null;
  const sequenceMutationReady = sequenceSnapshot
    ? spinnerSequenceMutationReady(sequenceSnapshot, sequencePresentation)
    : true;
  const wheelStyle: WheelMotionStyle = {
    transform: `rotate(${wheelRotation}deg)`,
    ...(wheelMotion ? {
      animationName: "spinner-live-wheel-turn",
      animationDuration: `${wheelMotion.durationMs}ms`,
      animationDelay: `${wheelMotion.delayMs}ms`,
      animationTimingFunction: "cubic-bezier(0.12, 0.72, 0.12, 1)",
      animationFillMode: "forwards",
      "--spinner-wheel-start": `${wheelMotion.startRotation}deg`,
      "--spinner-wheel-finish": `${wheelMotion.finalRotation}deg`,
    } : {}),
  };

  return (
    <main
      className={`raffle-app ${effectsActive ? "is-celebrating" : ""} ${effectiveMotionMode === "reduced" ? "is-motion-reduced" : ""}`}
      id="main"
      style={{ "--spinner-celebration-delay": `${celebrationAnimationDelayMs}ms` } as CelebrationStyle}
    >
      {hydrated && effectiveMotionMode !== "off" ? (
        <canvas ref={celebrationCanvasRef} className="celebration-canvas" aria-hidden="true" />
      ) : null}

      <header className="raffle-masthead">
        <div className="raffle-brand-lockup">
          <span className="eyebrow">Mōchirīī Guild · Raffle Wheel</span>
          <h1>Mōchirīī Moonwheel</h1>
          <p>All members welcome to watch the pretty wheel spin for pretty Mōchī gifts in the monthly guild raffle!</p>
        </div>
        <div className="stage-controls" role="group" aria-label="Display settings">
          <label className={`spinner-test-control ${testMode ? "is-active" : ""}`}>
            <input
              type="checkbox"
              checked={testMode}
              disabled={rosterLocked}
              onChange={(event) => setTestMode(event.target.checked)}
            />
            <span>Test spin</span>
            <small>{testMode ? "No guild announcement or public result" : "Official monthly draw"}</small>
          </label>
          <label className="motion-control">
            <span>Motion &amp; celebration</span>
            <select
              value={motionMode}
              disabled={rosterLocked}
              onChange={(event) => {
                const nextMode = event.target.value as MotionMode;
                const celebrationWasActive = celebrationRef.current?.active === true;
                const nextEffectiveMode = resolveCelebrationMotionMode(
                  nextMode,
                  prefersReducedMotion,
                );
                effectiveMotionModeRef.current = nextEffectiveMode;
                setMotionMode(nextMode);
                if (celebrationWasActive) stopCelebration();
              }}
            >
              <option value="full">Full</option>
              <option value="reduced">Reduced</option>
              <option value="off">Off</option>
            </select>
          </label>
          <button type="button" className="button button-quiet" onClick={toggleFullscreen}>
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
          <span className={`live-stage-badge ${liveConnected ? "is-connected" : ""}`} role="status">
            {liveConnected ? "Live stage connected" : "Reconnecting"}
          </span>
          {activeDrawMode === "test" ? (
            <span className="spinner-test-badge" role="status">Test draw · no public result</span>
          ) : null}
        </div>
      </header>

      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {drawAnnouncement}
      </p>

      <div className="raffle-layout">
        <section className="draw-stage" aria-labelledby="draw-stage-title" aria-busy={rosterLocked}>
          <div className="stage-heading">
            <div>
              <span className="eyebrow">Mōchi Selection</span>
              <h2 id="draw-stage-title">Draw Stage</h2>
            </div>
            <span className="chance-badge">{wheelParticipants.length || 0} equal {wheelParticipants.length === 1 ? "chance" : "chances"}</span>
          </div>

          <div
            ref={wheelFrameRef}
            className={`wheel-frame ${wheelMotionHasStarted && effectiveMotionMode === "full" ? "is-spinning" : ""}`}
          >
            <div className="wheel-pointer" aria-hidden="true"><span /></div>
            <div
              key={wheelMotion?.animationKey ?? "settled"}
              className={`wheel-rotor ${wheelMotion ? "has-live-motion" : ""}`}
              style={wheelStyle}
              onAnimationStart={(event) => {
                if (event.animationName === "spinner-live-wheel-turn" && wheelMotion?.animationKey) {
                  setWheelMotionStartedDrawId(wheelMotion.animationKey);
                }
              }}
            >
              <canvas ref={wheelCanvasRef} className="wheel-canvas" aria-hidden="true" />
              <span className="wheel-hub" aria-hidden="true">
                <Image src="/assets/img/brand/emblem.webp" alt="" fill sizes="(max-width: 720px) 84px, 118px" priority />
              </span>
            </div>
          </div>

          <div
            ref={winnerRevealRef}
            className={`winner-reveal ${phase === "revealed" && visibleWinner ? "is-visible" : ""}`}
          >
            {phase === "revealed" && visibleWinner && visibleWinnerIndex != null ? (
              <>
                <span className="eyebrow">The moonwheel has spoken</span>
                <h3>{visibleWinner.displayName}</h3>
                <p>Entry {visibleWinnerIndex + 1} of {visibleWinnerParticipantCount}</p>
              </>
            ) : (
              showCountdownTimer ? (
                <>
                  <span className="eyebrow">{countdown.isCountingDown ? "Moonwheel begins in" : "The shared draw is underway"}</span>
                  <strong
                    className="draw-countdown"
                    role="timer"
                    aria-live="off"
                    aria-atomic="true"
                    aria-label={countdown.isCountingDown
                      ? `${countdown.label} until the moonwheel begins`
                      : "The countdown is complete"}
                  >
                    {countdown.label}
                  </strong>
                  <p>{countdown.isCountingDown ? "Roster locked · shared server time" : "Fate is turning"}</p>
                </>
              ) : activeSequenceRound ? (
                <>
                  <span className="eyebrow">Elimination round {(activeSequenceRound.roundIndex ?? 0) + 1} of {activeSequenceRound.roundCount}</span>
                  <h3>{activeSequenceRound.participants.length} remain</h3>
                  <p>{activeSequenceRound.lastEliminated
                    ? `${activeSequenceRound.lastEliminated.displayName} was removed at the last boundary`
                    : "Each round spins for five seconds"}</p>
                </>
              ) : (
                <>
                  <span className="eyebrow">Awaiting the next draw</span>
                  <h3>{rosterLocked ? "Preparing the shared draw…" : "Fortune gathers"}</h3>
                </>
              )
            )}
          </div>

          <p className="draw-status">{status}</p>
          {notice ? <p className="inline-notice" role="status">{notice}</p> : null}
          {liveError ? <p className="inline-notice" role="status">{liveError}</p> : null}
          {!secureRandomAvailable ? (
            <p className="security-warning" role="alert">Secure commands are unavailable in this browser. No fallback is used, so drawing remains disabled.</p>
          ) : null}

          <div className="draw-actions">
            {phase === "idle" ? (
              <button
                type="button"
                className="button button-primary spin-button"
                disabled={!canSpin}
                onClick={startDraw}
                aria-label={testMode ? "Start a test Mōchirīī raffle spin" : "Start the official Mōchirīī monthly raffle draw"}
              >
                <span>{testMode ? "Run test spin" : "Spin official moonwheel"}</span>
                <small>{participants.length >= MIN_PARTICIPANTS ? `${participants.length - 1} five-second rounds · one survivor` : `Add ${MIN_PARTICIPANTS - participants.length} more`}</small>
              </button>
            ) : null}
            {skipControlVisible ? (
              <button type="button" className="button button-secondary" onClick={skipEffects}>Skip effects</button>
            ) : null}
            {phase === "revealed" && visibleWinner ? (
              <>
                <button type="button" className="button button-primary" disabled={!sequenceMutationReady} onClick={spinAgain}>Spin again</button>
                {sequenceSnapshot ? null : (
                  <button type="button" className="button button-secondary" onClick={removeWinner}>Remove winner</button>
                )}
                <button type="button" className="button button-secondary" onClick={replayCelebration}>Replay celebration</button>
                {winnerReceipt ? <button type="button" className="button button-quiet" onClick={() => exportReceipt(winnerReceipt)}>Export receipt</button> : null}
              </>
            ) : null}
          </div>
        </section>

        <aside className="roster-panel" aria-labelledby="roster-title">
          <div className="roster-heading">
            <div>
              <span className="eyebrow">Ordered entries</span>
              <h2 id="roster-title">Raffle Roster</h2>
            </div>
            <span className="roster-count" aria-label={`${participants.length} of ${MAX_PARTICIPANTS} names`}>
              {participants.length}<small>/{MAX_PARTICIPANTS}</small>
            </span>
          </div>

          <form className="add-name-form" onSubmit={addParticipant}>
            <label htmlFor="new-participant">Add a name</label>
            <div className="input-action-row">
              <input
                id="new-participant"
                value={draftName}
                disabled={rosterLocked || participants.length >= MAX_PARTICIPANTS}
                onKeyDown={onAddKeyDown}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Guild member name"
                autoComplete="off"
              />
              <button type="submit" className="button button-primary" disabled={rosterLocked || participants.length >= MAX_PARTICIPANTS || !draftName.trim()}>Add</button>
            </div>
            <small>Up to {MAX_NAME_GRAPHEMES} characters; duplicates are rejected.</small>
          </form>

          <div className="roster-tools" role="group" aria-label="Roster tools">
            <button type="button" className="button button-quiet" disabled={rosterLocked || participants.length >= MAX_PARTICIPANTS} onClick={() => setBulkOpen((open) => !open)}>Bulk paste</button>
            <button type="button" className="button button-quiet" disabled={rosterLocked} onClick={() => importInputRef.current?.click()}>Import</button>
            <button type="button" className="button button-quiet" disabled={participants.length === 0} onClick={exportRoster}>Export</button>
            <button type="button" className="button button-danger" disabled={rosterLocked || participants.length === 0} onClick={clearRoster}>Clear</button>
            <input
              ref={importInputRef}
              type="file"
              hidden
              accept=".json,.txt,application/json,text/plain"
              onChange={importRoster}
            />
          </div>

          {bulkOpen ? (
            <section className="bulk-panel" aria-labelledby="bulk-title">
              <div className="bulk-heading">
                <h3 id="bulk-title">Paste names</h3>
                <button type="button" className="icon-button" aria-label="Close bulk paste" onClick={() => setBulkOpen(false)}>×</button>
              </div>
              <label htmlFor="bulk-names">One per line, comma, tab, or semicolon</label>
              <textarea id="bulk-names" value={bulkText} disabled={rosterLocked} onChange={(event) => setBulkText(event.target.value)} rows={6} />
              {bulkErrors.length ? (
                <ul className="validation-list" aria-label="Names not added">
                  {bulkErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
                </ul>
              ) : null}
              <button type="button" className="button button-primary" disabled={!bulkText.trim() || rosterLocked} onClick={addBulkNames}>Add valid names</button>
            </section>
          ) : null}

          <div className="roster-scroll" tabIndex={0} role="region" aria-label="Numbered raffle participants">
            {participants.length ? (
              <ol className="participant-list">
                {numberedParticipants.map((participant, index) => (
                  <li key={participant.id} className="participant-row">
                    <span className="participant-number" aria-hidden="true">{participant.number}</span>
                    {editId === participant.id ? (
                      <form className="inline-edit" onSubmit={saveEdit}>
                        <label className="visually-hidden" htmlFor={`edit-${participant.id}`}>Edit {participant.displayName}</label>
                        <input
                          id={`edit-${participant.id}`}
                          value={editName}
                          disabled={rosterLocked}
                          autoFocus
                          onChange={(event) => setEditName(event.target.value)}
                        />
                        <button type="submit" className="icon-button" aria-label={`Save ${participant.displayName}`}>✓</button>
                        <button type="button" className="icon-button" aria-label="Cancel edit" onClick={() => setEditId(null)}>×</button>
                      </form>
                    ) : (
                      <>
                        <span className="participant-name"><span className="visually-hidden">Entry {participant.number}: </span>{participant.displayName}</span>
                        <span className="participant-actions">
                          <button type="button" className="icon-button" disabled={rosterLocked || index === 0} onClick={() => moveRosterParticipant(index, index - 1)} aria-label={`Move ${participant.displayName} up`}>↑</button>
                          <button type="button" className="icon-button" disabled={rosterLocked || index === participants.length - 1} onClick={() => moveRosterParticipant(index, index + 1)} aria-label={`Move ${participant.displayName} down`}>↓</button>
                          <button type="button" className="icon-button" disabled={rosterLocked} onClick={() => beginEdit(participant)} aria-label={`Edit ${participant.displayName}`}>✎</button>
                          <button type="button" className="icon-button danger" disabled={rosterLocked} onClick={() => removeParticipant(participant.id)} aria-label={`Delete ${participant.displayName}`}>×</button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="empty-roster">
                <span aria-hidden="true">蓮</span>
                <h3>No names yet</h3>
                <p>Add two or more guild members to begin.</p>
              </div>
            )}
          </div>

          <details className="receipt-history">
            <summary>Draw receipts <span>{receipts.length}</span></summary>
            <p>Receipts reproduce the selection arithmetic, but are not independently tamper-proof.</p>
            {receipts.length ? (
              <ol>
                {receipts.map((receipt) => (
                  <li key={receiptId(receipt)}>
                    <div>
                      <strong>{receipt.winner.displayName}</strong>
                      <small>{receiptTimestamp(receipt)}</small>
                    </div>
                    <button type="button" className="button button-quiet" onClick={() => exportReceipt(receipt)}>Download</button>
                  </li>
                ))}
              </ol>
            ) : <p>No draw receipts are saved in this browser.</p>}
          </details>

          <p className="privacy-note">Shared privately with active verified members · The active roster remains until cleared · Draw records may retain names for 30 days · App {APP_VERSION}</p>
        </aside>
      </div>
    </main>
  );
}

export default RaffleSpinner;
