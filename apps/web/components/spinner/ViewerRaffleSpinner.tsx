"use client";

import Image from "next/image";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startCelebration, type CelebrationHandle } from "./celebration";
import { resolveCelebrationMotionMode } from "./celebration-scene";
import {
  parseStoredMotion,
  SETTINGS_STORAGE_KEY,
  type MotionMode,
  type ParticipantV1,
  type SpinnerPersistedDrawMode,
} from "./raffle";
import {
  spinnerDrawAnnouncementTransition,
  spinnerLiveHasStarted,
  spinnerLiveMotionRotations,
  spinnerLiveTimeline,
  spinnerSequenceRoundMotionRotations,
  spinnerSequenceRoundTimeline,
  spinnerServerClockAnchorForSnapshot,
  spinnerServerClockNow,
  resolveInitialViewerMotion,
  type SpinnerLivePhase,
  type SpinnerLiveResultV1,
  type SpinnerLiveSnapshot,
  type SpinnerLiveSnapshotV1,
  type SpinnerLiveSnapshotV2,
  type SpinnerServerClockAnchor,
} from "./live";
import { useSpinnerCountdown, useSpinnerSequencePresentation } from "./use-spinner-countdown";
import { useSpinnerLive } from "./use-spinner-live";
import { drawWheel } from "./wheel";

type VisibleWinner = {
  drawId: string;
  participant: ParticipantV1;
  selectedIndex: number;
  participantCount: number;
};
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

function snapshotKey(snapshot: SpinnerLiveSnapshot) {
  const planKey = snapshot.version === 2 ? snapshot.planHashSha256 : "v1";
  return `${snapshot.version}:${snapshot.revision}:${snapshot.phase}:${snapshot.drawMode}:${snapshot.drawId || "idle"}:${planKey}`;
}

export function ViewerRaffleSpinner() {
  const [participants, setParticipants] = useState<ParticipantV1[]>([]);
  const [phase, setPhase] = useState<SpinnerLivePhase>("idle");
  const [winner, setWinner] = useState<VisibleWinner | null>(null);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [wheelMotion, setWheelMotion] = useState<WheelMotion | null>(null);
  const [effectsActive, setEffectsActive] = useState(false);
  const [celebrationRequestId, setCelebrationRequestId] = useState(0);
  const [celebrationAnimationDelayMs, setCelebrationAnimationDelayMs] = useState(0);
  const [status, setStatus] = useState("Connecting to the shared draw stage.");
  const [drawAnnouncement, setDrawAnnouncement] = useState("");
  const [motionMode, setMotionMode] = useState<MotionMode>("full");
  const [drawMode, setDrawMode] = useState<SpinnerPersistedDrawMode>("unclassified");
  const [motionPreferenceReady, setMotionPreferenceReady] = useState(false);
  const [countdownStartedAt, setCountdownStartedAt] = useState<string | null>(null);
  const [serverClockAnchor, setServerClockAnchor] = useState<SpinnerServerClockAnchor | null>(null);
  const [wheelMotionStartedDrawId, setWheelMotionStartedDrawId] = useState<string | null>(null);
  const [sequenceSnapshot, setSequenceSnapshot] = useState<SpinnerLiveSnapshotV2 | null>(null);

  const wheelCanvasRef = useRef<HTMLCanvasElement>(null);
  const wheelFrameRef = useRef<HTMLDivElement>(null);
  const celebrationCanvasRef = useRef<HTMLCanvasElement>(null);
  const winnerRevealRef = useRef<HTMLDivElement>(null);
  const pendingCelebrationRef = useRef<{
    drawId: string;
    revealAt: string | null;
  } | null>(null);
  const celebrationRef = useRef<CelebrationHandle | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedKeyRef = useRef("");
  const celebratedDrawIdRef = useRef<string | null>(null);
  const liveSnapshotRef = useRef<SpinnerLiveSnapshot | null>(null);
  const preferredMotionRef = useRef<MotionMode>("full");
  const effectiveMotionRef = useRef<MotionMode>("full");
  const refreshLiveRef = useRef<(() => void) | null>(null);
  const serverClockAnchorRef = useRef<SpinnerServerClockAnchor | null>(null);
  const countdownAnnouncementDrawIdRef = useRef<string | null>(null);
  const spinStartedAnnouncementDrawIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const countdown = useSpinnerCountdown(countdownStartedAt, serverClockAnchor);
  const sequencePresentation = useSpinnerSequencePresentation(sequenceSnapshot, serverClockAnchor);

  const numberedParticipants = useMemo(
    () => participants.map((participant, index) => ({ ...participant, number: index + 1 })),
    [participants],
  );

  const stopTimeline = useCallback(() => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
  }, []);

  const stopCelebration = useCallback(() => {
    pendingCelebrationRef.current = null;
    celebrationRef.current?.stop();
    celebrationRef.current = null;
    setEffectsActive(false);
  }, []);

  const playWinnerCelebration = useCallback((drawId: string, revealAt: string | null) => {
    const selectedMode = effectiveMotionRef.current;
    if (celebratedDrawIdRef.current === drawId || document.hidden || selectedMode === "off") return;
    stopCelebration();
    const canvas = celebrationCanvasRef.current;
    if (!canvas) return;
    celebratedDrawIdRef.current = drawId;
    const authoritativeNowMs = spinnerServerClockNow(serverClockAnchorRef.current, performance.now());
    if (!Number.isFinite(authoritativeNowMs)) return;
    const parsedRevealAtMs = revealAt ? Date.parse(revealAt) : Number.NaN;
    const handleRevealAtMs = Number.isFinite(parsedRevealAtMs)
      ? parsedRevealAtMs
      : authoritativeNowMs;
    const handle = startCelebration(canvas, {
      mode: selectedMode,
      drawId,
      revealAtMs: handleRevealAtMs,
      authoritativeNowMs,
      protectedRegion: winnerRevealRef.current?.getBoundingClientRect() ?? null,
    });
    if (!handle.active) return;
    setCelebrationAnimationDelayMs(-Math.min(4_800, Math.max(0, authoritativeNowMs - handleRevealAtMs)));
    celebrationRef.current = handle;
    setEffectsActive(true);
    void handle.finished.then(() => {
      if (!mountedRef.current || celebrationRef.current !== handle) return;
      celebrationRef.current = null;
      setEffectsActive(false);
    });
  }, [stopCelebration]);

  const queueWinnerCelebration = useCallback((drawId: string, revealAt: string | null) => {
    pendingCelebrationRef.current = { drawId, revealAt };
    setCelebrationRequestId((current) => current + 1);
  }, []);

  useEffect(() => {
    const pending = pendingCelebrationRef.current;
    if (!pending || phase !== "revealed") return;
    const animationFrame = requestAnimationFrame(() => {
      if (pendingCelebrationRef.current !== pending) return;
      pendingCelebrationRef.current = null;
      playWinnerCelebration(pending.drawId, pending.revealAt);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [celebrationRequestId, phase, playWinnerCelebration]);

  const revealSnapshot = useCallback((snapshot: SpinnerLiveSnapshotV1) => {
    if (!snapshot.winner || snapshot.selectedIndex == null || !snapshot.drawId) return;
    stopTimeline();
    setWheelMotion(null);
    setWheelRotation(snapshot.finalRotation);
    setCountdownStartedAt(null);
    setWheelMotionStartedDrawId(null);
    setPhase("revealed");
    setWinner({
      drawId: snapshot.drawId,
      participant: snapshot.winner,
      selectedIndex: snapshot.selectedIndex,
      participantCount: snapshot.participants.length,
    });
    const winnerStatus = `Winner: ${snapshot.winner.displayName}.`;
    setStatus(winnerStatus);
    setDrawAnnouncement(winnerStatus);
    queueWinnerCelebration(snapshot.drawId, snapshot.revealAt);
  }, [queueWinnerCelebration, stopTimeline]);

  const applyLiveResult = useCallback((result: SpinnerLiveResultV1) => {
    const { snapshot, serverNow } = result;
    const key = snapshotKey(snapshot);
    const snapshotChanged = appliedKeyRef.current !== key;
    const monotonicNowMs = performance.now();
    const nextClockAnchor = spinnerServerClockAnchorForSnapshot(
      serverClockAnchorRef.current,
      serverNow,
      monotonicNowMs,
      snapshotChanged,
    );
    const serverNowMs = spinnerServerClockNow(nextClockAnchor, monotonicNowMs);
    if (nextClockAnchor && nextClockAnchor !== serverClockAnchorRef.current) {
      serverClockAnchorRef.current = nextClockAnchor;
      setServerClockAnchor(nextClockAnchor);
    }
    if (!snapshotChanged) return;
    appliedKeyRef.current = key;
    liveSnapshotRef.current = snapshot;
    setParticipants(snapshot.participants);
    setDrawMode(snapshot.drawMode);

    if (snapshot.version === 2) {
      stopTimeline();
      setSequenceSnapshot(snapshot);
      return;
    }
    setSequenceSnapshot(null);

    if (snapshot.phase === "idle") {
      stopTimeline();
      stopCelebration();
      countdownAnnouncementDrawIdRef.current = null;
      spinStartedAnnouncementDrawIdRef.current = null;
      setCountdownStartedAt(null);
      setWheelMotionStartedDrawId(null);
      setDrawAnnouncement("");
      setWinner(null);
      setPhase("idle");
      setWheelMotion(null);
      setWheelRotation(snapshot.finalRotation);
      setStatus(snapshot.participants.length >= 2
        ? `${snapshot.participants.length} equal chances are ready. Waiting for a moderator to spin.`
        : "Waiting for a moderator to prepare the next roster.");
      return;
    }

    const liveDrawId = snapshot.drawId;
    if (!liveDrawId) {
      stopTimeline();
      stopCelebration();
      setWheelMotion(null);
      setStatus("The live draw state is unavailable.");
      return;
    }

    const revealAtMs = snapshot.revealAt ? Date.parse(snapshot.revealAt) : 0;
    if (snapshot.phase === "revealed" || serverNowMs >= revealAtMs) {
      revealSnapshot(snapshot);
      return;
    }

    stopTimeline();
    setWinner(null);
    setPhase("spinning");
    const countdownPending = !spinnerLiveHasStarted(snapshot, serverNowMs);
    setCountdownStartedAt(countdownPending ? snapshot.startedAt : null);
    setWheelMotionStartedDrawId(null);
    const timeline = spinnerLiveTimeline(snapshot, serverNowMs, motionMode);
    const rotations = spinnerLiveMotionRotations(snapshot, motionMode);
    setWheelMotion(null);
    setWheelRotation(snapshot.startRotation);
    const drawStatus = snapshot.drawMode === "test"
      ? countdownPending
        ? "Test draw: the roster is locked and the moonwheel countdown is underway."
        : "Test draw underway."
      : countdownPending
        ? "The roster is locked. The moonwheel countdown is underway."
        : "The shared draw is underway.";
    setStatus(drawStatus);
    const announcement = spinnerDrawAnnouncementTransition(liveDrawId, countdownPending, {
      countdownDrawId: countdownAnnouncementDrawIdRef.current,
      spinDrawId: spinStartedAnnouncementDrawIdRef.current,
    });
    countdownAnnouncementDrawIdRef.current = announcement.state.countdownDrawId;
    spinStartedAnnouncementDrawIdRef.current = announcement.state.spinDrawId;
    if (announcement.announcement) setDrawAnnouncement(announcement.announcement);

    if (!countdownPending && timeline.motionDurationMs > 0) {
      setWheelMotion({
        drawId: liveDrawId,
        animationKey: liveDrawId,
        startRotation: rotations.startRotation,
        finalRotation: rotations.finalRotation,
        durationMs: timeline.motionDurationMs,
        delayMs: timeline.motionDelayMs,
      });
    }
    const nextRefreshDelayMs = countdownPending ? timeline.startDelayMs : timeline.revealDelayMs;
    revealTimerRef.current = setTimeout(() => {
      appliedKeyRef.current = "";
      refreshLiveRef.current?.();
    }, nextRefreshDelayMs + 60);
  }, [motionMode, revealSnapshot, stopCelebration, stopTimeline]);

  useEffect(() => {
    const snapshot = sequenceSnapshot;
    const presentation = sequencePresentation;
    if (!snapshot || !presentation) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const drawId = snapshot.drawId;
      const authoritativeNowMs = spinnerServerClockNow(serverClockAnchorRef.current, performance.now());
      setParticipants(presentation.participants);
      setDrawMode(snapshot.drawMode);
      setWheelMotion(null);
      setWheelMotionStartedDrawId(null);

    if (presentation.stage === "countdown") {
      stopCelebration();
      setWinner(null);
      setPhase("spinning");
      setCountdownStartedAt(snapshot.startedAt);
      setWheelRotation(presentation.settledRotation);
      const countdownStatus = snapshot.drawMode === "test"
        ? "Test draw: the roster is locked and the one-minute moonwheel countdown is underway."
        : "The roster is locked. The one-minute moonwheel countdown is underway.";
      setStatus(countdownStatus);
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
      const timeline = spinnerSequenceRoundTimeline(
        presentation.round,
        authoritativeNowMs,
        motionMode,
      );
      const rotations = spinnerSequenceRoundMotionRotations(presentation.round, motionMode);
      setWinner(null);
      setPhase("spinning");
      setWheelRotation(presentation.round.startRotation);
      if (timeline.motionDurationMs > 0) {
        setWheelMotion({
          drawId,
          animationKey,
          startRotation: rotations.startRotation,
          finalRotation: rotations.finalRotation,
          durationMs: timeline.motionDurationMs,
          delayMs: timeline.motionDelayMs,
        });
      }
      const roundStatus = `${snapshot.drawMode === "test" ? "Test draw · " : ""}Elimination round ${roundNumber} of ${presentation.roundCount}: ${presentation.participants.length} remain.`;
      setStatus(roundStatus);
      setDrawAnnouncement(roundNumber === 1
        ? "The shared elimination draw is underway."
        : `Elimination round ${roundNumber} has begun. ${presentation.participants.length} entrants remain.`);
        return;
    }

    const finalWinner = presentation.winner;
    if (!finalWinner) return;
    const originalIndex = snapshot.participants.findIndex((participant) => participant.id === finalWinner.id);
    setWheelRotation(presentation.settledRotation);
    setPhase("revealed");
    setWinner({
      drawId,
      participant: finalWinner,
      selectedIndex: originalIndex,
      participantCount: snapshot.participants.length,
    });
    const winnerStatus = `Winner: ${finalWinner.displayName}.`;
    setStatus(winnerStatus);
    setDrawAnnouncement(winnerStatus);
      queueWinnerCelebration(drawId, snapshot.revealAt);
    });
    return () => {
      cancelled = true;
    };
  }, [
    motionMode,
    queueWinnerCelebration,
    sequencePresentation,
    sequenceSnapshot,
    stopCelebration,
  ]);

  const { connected, error, refresh } = useSpinnerLive({
    enabled: motionPreferenceReady,
    onResult: applyLiveResult,
  });

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
    refreshLiveRef.current = () => void refresh();
    return () => {
      refreshLiveRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const readPreference = (storedValue: string | null) => storedValue == null
      ? "full"
      : parseStoredMotion(storedValue);
    let initialStoredValue: string | null = null;
    try {
      initialStoredValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      preferredMotionRef.current = readPreference(initialStoredValue);
    } catch {
      preferredMotionRef.current = "full";
    }
    const updateMotion = () => {
      const nextMotionMode = resolveCelebrationMotionMode(
        preferredMotionRef.current,
        media.matches,
      );
      if (nextMotionMode !== effectiveMotionRef.current) stopCelebration();
      effectiveMotionRef.current = nextMotionMode;
      setMotionMode(nextMotionMode);
      setMotionPreferenceReady(true);
      if (liveSnapshotRef.current?.version === 1) {
        appliedKeyRef.current = "";
        void refreshLiveRef.current?.();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SETTINGS_STORAGE_KEY) return;
      preferredMotionRef.current = readPreference(event.newValue);
      updateMotion();
    };
    effectiveMotionRef.current = resolveInitialViewerMotion(initialStoredValue, media.matches);
    setMotionMode(effectiveMotionRef.current);
    setMotionPreferenceReady(true);
    updateMotion();
    media.addEventListener("change", updateMotion);
    window.addEventListener("storage", onStorage);
    return () => {
      mountedRef.current = false;
      media.removeEventListener("change", updateMotion);
      window.removeEventListener("storage", onStorage);
    };
  }, [stopCelebration]);

  useEffect(() => {
    const canvas = wheelCanvasRef.current;
    const frame = wheelFrameRef.current;
    if (!canvas || !frame) return;
    const render = () => drawWheel(canvas, participants);
    render();
    void document.fonts?.ready.then(() => {
      if (mountedRef.current) render();
    });
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [participants, wheelMotion?.animationKey]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) stopCelebration();
      const snapshot = liveSnapshotRef.current;
      if (snapshot?.phase !== "spinning") return;
      if (document.hidden) return;
      if (snapshot.version === 1) {
        appliedKeyRef.current = "";
      } else if (sequencePresentation?.stage === "complete") {
        queueWinnerCelebration(snapshot.drawId, snapshot.revealAt);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [queueWinnerCelebration, sequencePresentation, stopCelebration]);

  useEffect(() => {
    if (!error) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) stopCelebration();
    });
    return () => {
      cancelled = true;
    };
  }, [error, stopCelebration]);

  useEffect(() => () => {
    stopTimeline();
    celebrationRef.current?.stop();
    celebrationRef.current = null;
  }, [stopTimeline]);

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
  const wheelMotionHasStarted = phase === "spinning"
    && wheelMotion?.animationKey != null
    && wheelMotionStartedDrawId === wheelMotion.animationKey;
  const showCountdownTimer = phase === "spinning"
    && countdownStartedAt !== null
    && countdown.remainingSeconds !== null;
  const activeSequenceRound = sequencePresentation?.stage === "round-spinning"
    ? sequencePresentation
    : null;

  return (
    <main
      className={`raffle-app raffle-app--viewer ${effectsActive ? "is-celebrating" : ""} ${motionMode === "reduced" ? "is-motion-reduced" : ""}`}
      id="main"
      style={{ "--spinner-celebration-delay": `${celebrationAnimationDelayMs}ms` } as CelebrationStyle}
    >
      {motionPreferenceReady && motionMode !== "off" ? (
        <canvas ref={celebrationCanvasRef} className="celebration-canvas" aria-hidden="true" />
      ) : null}

      <header className="raffle-masthead">
        <div className="raffle-brand-lockup">
          <span className="eyebrow">Mōchirīī Guild · Raffle Wheel</span>
          <h1>Mōchirīī Moonwheel</h1>
          <p>All members welcome to watch the pretty wheel spin for pretty Mōchī gifts in the monthly guild raffle!</p>
        </div>
        <p className={`live-stage-badge ${connected ? "is-connected" : ""}`} role="status">
          {connected ? "Live stage connected" : "Reconnecting to live stage"}
        </p>
        {drawMode === "test" ? (
          <p className="spinner-test-badge" role="status">Test draw · no public result</p>
        ) : null}
      </header>

      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {drawAnnouncement}
      </p>

      <div className="raffle-layout">
        <section className="draw-stage" aria-labelledby="draw-stage-title" aria-busy={phase === "spinning"}>
          <div className="stage-heading">
            <div>
              <span className="eyebrow">Mōchi Selection</span>
              <h2 id="draw-stage-title">Draw Stage</h2>
            </div>
            <span className="chance-badge">{participants.length} equal {participants.length === 1 ? "chance" : "chances"}</span>
          </div>

          <div
            ref={wheelFrameRef}
            className={`wheel-frame ${wheelMotionHasStarted && motionMode === "full" ? "is-spinning" : ""}`}
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
            className={`winner-reveal ${phase === "revealed" && winner ? "is-visible" : ""}`}
          >
            {phase === "revealed" && winner ? (
              <>
                <span className="eyebrow">The moonwheel has spoken</span>
                <h3>{winner.participant.displayName}</h3>
                <p>Entry {winner.selectedIndex + 1} of {winner.participantCount}</p>
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
                  <h3>Fortune gathers</h3>
                </>
              )
            )}
          </div>

          <p className="draw-status">{status}</p>
          {error ? <p className="inline-notice" role="status">{error}</p> : null}
          {effectsActive ? <p className="visually-hidden" role="status">Winner celebration in progress.</p> : null}
        </section>

        <aside className="roster-panel roster-panel--viewer" aria-labelledby="roster-title">
          <div className="roster-heading">
            <div>
              <span className="eyebrow">Ordered entries</span>
              <h2 id="roster-title">Raffle Roster</h2>
            </div>
            <span className="roster-count" aria-label={`${participants.length} names`}>{participants.length}</span>
          </div>

          <div className="roster-scroll" tabIndex={0} role="region" aria-label="Numbered raffle participants">
            {numberedParticipants.length ? (
              <ol className="participant-list">
                {numberedParticipants.map((participant) => (
                  <li key={participant.id} className="participant-row participant-row--viewer">
                    <span className="participant-number" aria-hidden="true">{participant.number}</span>
                    <span className="participant-name"><span className="visually-hidden">Entry {participant.number}: </span>{participant.displayName}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="empty-roster">
                <span aria-hidden="true">蓮</span>
                <h3>Awaiting roster</h3>
                <p>A moderator will prepare the next shared draw.</p>
              </div>
            )}
          </div>

          <p className="privacy-note">View-only live stage · The active roster remains until replaced or cleared · Draw records may retain names for 30 days</p>
        </aside>
      </div>
    </main>
  );
}
