"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearSpinnerLiveSnapshotCache,
  createSpinnerLiveSnapshotCache,
  fetchSpinnerLiveSnapshot,
  spinnerLiveErrorRetryDelay,
  spinnerLivePollInterval,
  type SpinnerLiveSnapshotCache,
  type SpinnerLiveResultV1,
} from "./live";

function retryJitterUnit() {
  const provider = globalThis.crypto;
  if (!provider || typeof provider.getRandomValues !== "function") return 0.5;
  const value = provider.getRandomValues(new Uint32Array(1))[0];
  return value / 0xffff_ffff;
}

export function useSpinnerLive({
  enabled = true,
  onResult,
}: {
  enabled?: boolean;
  onResult(result: SpinnerLiveResultV1): void;
}) {
  const callbackRef = useRef(onResult);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const failureCountRef = useRef(0);
  const mountedRef = useRef(false);
  const snapshotCacheRef = useRef<SpinnerLiveSnapshotCache>(createSpinnerLiveSnapshotCache());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callbackRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const snapshotCache = snapshotCacheRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearSpinnerLiveSnapshotCache(snapshotCache);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearSpinnerLiveSnapshotCache(snapshotCacheRef.current);
    }
  }, [enabled]);

  const refresh = useCallback(async () => {
    if (!enabled || runningRef.current) return null;
    if (document.visibilityState === "hidden") return null;
    if (navigator.onLine === false) {
      setConnected(false);
      setError("Connection paused while this device is offline.");
      return null;
    }
    runningRef.current = true;
    try {
      const result = await fetchSpinnerLiveSnapshot(snapshotCacheRef.current);
      if (!mountedRef.current) return null;
      callbackRef.current(result);
      setConnected(true);
      setError(null);
      return result;
    } catch (reason) {
      if (!mountedRef.current) return null;
      setConnected(false);
      setError(reason instanceof Error ? reason.message : "The live draw could not be synchronized.");
      return null;
    } finally {
      runningRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const canPoll = () =>
      document.visibilityState === "visible" && navigator.onLine !== false;

    const schedule = (delay: number) => {
      clearTimer();
      if (cancelled || !canPoll()) return;
      timerRef.current = setTimeout(poll, delay);
    };

    const poll = async () => {
      if (cancelled || !canPoll()) return;
      const result = await refresh();
      if (cancelled) return;
      if (result) {
        failureCountRef.current = 0;
        schedule(spinnerLivePollInterval(result.snapshot, result.serverNow));
        return;
      }
      failureCountRef.current += 1;
      schedule(spinnerLiveErrorRetryDelay(failureCountRef.current, retryJitterUnit()));
    };

    const restart = () => {
      clearTimer();
      if (!canPoll() || runningRef.current) return;
      void poll();
    };

    void poll();
    const onFocus = () => restart();
    const onVisibility = () => {
      if (document.visibilityState === "visible") restart();
      else clearTimer();
    };
    const onPageShow = () => restart();
    const onOnline = () => restart();
    const onOffline = () => {
      clearTimer();
      setConnected(false);
      setError("Connection paused while this device is offline.");
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearTimer();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, refresh]);

  return { connected, error, refresh };
}
