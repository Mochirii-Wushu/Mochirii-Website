"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseRaffleLeaderboardApi,
  type RaffleLeaderboard,
} from "@/lib/raffle/leaderboard-core";
import { RaffleLeaderboardPanel } from "./RaffleLeaderboardPanel";

type AuthRuntime = typeof import("./raffle-winner-runtime");

export function RaffleMemberLeaderboard() {
  const [leaderboard, setLeaderboard] = useState<RaffleLeaderboard | null>(null);
  const runtimeRef = useRef<AuthRuntime | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async (knownAccessToken?: string | null) => {
    const generation = ++requestGenerationRef.current;
    requestControllerRef.current?.abort();
    if (knownAccessToken === null) {
      setLeaderboard(null);
      return;
    }

    const controller = new AbortController();
    requestControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const runtime = runtimeRef.current ??
        await import("./raffle-winner-runtime");
      runtimeRef.current = runtime;
      const accessToken = knownAccessToken === undefined
        ? await runtime.readRaffleWinnerAccessToken()
        : knownAccessToken;
      if (!accessToken) {
        if (mountedRef.current && generation === requestGenerationRef.current) {
          setLeaderboard(null);
        }
        return;
      }
      const response = await fetch("/api/raffle/leaderboard", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: controller.signal,
      });
      if (!response.ok) {
        if (mountedRef.current && generation === requestGenerationRef.current) {
          setLeaderboard(null);
        }
        return;
      }
      const payload = await response.json();
      const nextLeaderboard = parseRaffleLeaderboardApi(payload);
      if (!mountedRef.current || generation !== requestGenerationRef.current) {
        return;
      }
      setLeaderboard(nextLeaderboard);
    } catch {
      if (mountedRef.current && generation === requestGenerationRef.current) {
        setLeaderboard(null);
      }
    } finally {
      window.clearTimeout(timeout);
      if (generation === requestGenerationRef.current) {
        requestControllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    let unsubscribe: () => void = () => {};
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    void import("./raffle-winner-runtime").then((runtime) => {
      if (cancelled) return;
      runtimeRef.current = runtime;
      unsubscribe = runtime.subscribeToRaffleWinnerAuth((event, accessToken) => {
        if (event === "SIGNED_OUT" || !accessToken) {
          requestGenerationRef.current += 1;
          requestControllerRef.current?.abort();
          requestControllerRef.current = null;
          setLeaderboard(null);
          return;
        }
        void refresh(accessToken);
      });
    });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      window.clearInterval(interval);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  if (!leaderboard) return null;
  return <RaffleLeaderboardPanel leaderboard={leaderboard} />;
}
