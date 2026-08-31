"use client";

import { useEffect, useState } from "react";
import {
  formatSpinnerCountdown,
  stabilizeSpinnerSequencePresentation,
  spinnerCountdownSeconds,
  spinnerSequencePresentation,
  spinnerServerClockNow,
  type SpinnerSequencePresentation,
  type SpinnerLiveSnapshotV2,
  type SpinnerServerClockAnchor,
} from "./live";

interface SpinnerCountdownState {
  startedAt: string | null;
  remainingSeconds: number;
}

export function useSpinnerCountdown(
  startedAt: string | null,
  serverClockAnchor: SpinnerServerClockAnchor | null,
) {
  const [state, setState] = useState<SpinnerCountdownState>({
    startedAt: null,
    remainingSeconds: 0,
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;

    const update = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const authoritativeNowMs = spinnerServerClockNow(serverClockAnchor, performance.now());
      const remainingSeconds = spinnerCountdownSeconds(startedAt, authoritativeNowMs);
      setState((current) => current.startedAt === startedAt && current.remainingSeconds === remainingSeconds
        ? current
        : { startedAt, remainingSeconds });

      if (remainingSeconds <= 0 || !Number.isFinite(startedAtMs)) return;
      const remainingMs = startedAtMs - authoritativeNowMs;
      const nextBoundaryMs = remainingMs - ((remainingSeconds - 1) * 1_000);
      timer = setTimeout(update, Math.max(16, Math.min(1_000, nextBoundaryMs + 8)));
    };

    const refreshVisibleClock = () => {
      if (document.visibilityState === "visible") update();
    };

    update();
    window.addEventListener("focus", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", refreshVisibleClock);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", refreshVisibleClock);
    };
  }, [serverClockAnchor, startedAt]);

  const ready = state.startedAt === startedAt;
  const remainingSeconds = ready ? state.remainingSeconds : null;
  return {
    isCountingDown: remainingSeconds != null && remainingSeconds > 0,
    label: formatSpinnerCountdown(remainingSeconds ?? 0),
    remainingSeconds,
  };
}

interface SpinnerSequenceClockState {
  snapshotIdentity: string;
  presentation: SpinnerSequencePresentation;
}

export function useSpinnerSequencePresentation(
  snapshot: SpinnerLiveSnapshotV2 | null,
  serverClockAnchor: SpinnerServerClockAnchor | null,
) {
  const snapshotIdentity = snapshot
    ? `${snapshot.sessionId}:${snapshot.revision}:${snapshot.phase}:${snapshot.drawMode}:${snapshot.drawId}:${snapshot.planHashSha256}`
    : "";
  const [clock, setClock] = useState<SpinnerSequenceClockState | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const update = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!snapshot) {
        setClock(null);
        return;
      }
      const authoritativeNowMs = spinnerServerClockNow(serverClockAnchor, performance.now());
      const nextPresentation = spinnerSequencePresentation(snapshot, authoritativeNowMs);
      setClock((current) => {
        const presentation = stabilizeSpinnerSequencePresentation(
          snapshot,
          current?.snapshotIdentity === snapshotIdentity ? current.presentation : null,
          nextPresentation,
        );
        return current?.snapshotIdentity === snapshotIdentity && current.presentation === presentation
          ? current
          : { snapshotIdentity, presentation };
      });
      const presentation = nextPresentation;
      const boundaryAtMs = presentation.nextBoundaryAt
        ? Date.parse(presentation.nextBoundaryAt)
        : Number.NaN;
      if (!Number.isFinite(boundaryAtMs) || !Number.isFinite(authoritativeNowMs)) return;
      timer = setTimeout(update, Math.max(16, boundaryAtMs - authoritativeNowMs + 12));
    };

    const refreshVisibleClock = () => {
      if (document.visibilityState === "visible") update();
    };

    update();
    window.addEventListener("focus", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", refreshVisibleClock);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", refreshVisibleClock);
    };
  }, [serverClockAnchor, snapshot, snapshotIdentity]);

  return snapshot && clock?.snapshotIdentity === snapshotIdentity
    ? clock.presentation
    : null;
}
