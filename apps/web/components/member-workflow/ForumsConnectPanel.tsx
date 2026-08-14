"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { approvedForumsDiscourseConnectRedirect, FORUMS_ORIGIN } from "@/lib/forums/discourse-connect-callback";
import {
  FORUMS_CONNECT_LOGIN_HREF,
  FORUMS_CONNECT_REQUEST_STORAGE_KEY,
  resolveOpaqueForumsConnectBrowserRequest,
  type OpaqueForumsConnectRequest,
} from "@/lib/forums/discourse-connect-browser-request";
import { getCurrentSession, onAuthStateChange } from "@/lib/supabase/auth";
import { WorkflowNotice } from "./WorkflowState";

type ConnectState = "checking" | "sign-in" | "denied" | "invalid" | "unavailable";

const STATE_COPY: Record<ConnectState, string> = {
  checking: "Checking your Mōchirīī Forums access.",
  "sign-in": "Sign in with your Mōchirīī account to continue.",
  denied: "Currently verified Mōchirīī membership is required to enter the forums.",
  invalid: "This sign-in request is invalid. Return to the forums and try again.",
  unavailable: "Mōchirīī Forums sign-in is temporarily unavailable.",
};

const STATE_STATUS: Record<ConnectState, { label: string; tone: "active" | "danger" | "pending" | "warning" }> = {
  checking: { label: "Checking", tone: "pending" },
  "sign-in": { label: "Sign in", tone: "warning" },
  denied: { label: "Denied", tone: "warning" },
  invalid: { label: "Invalid", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "danger" },
};

function requestErrorState(status: number, code: unknown): ConnectState {
  if (status === 401 || code === "sign_in_required") return "sign-in";
  if (status === 403 || code === "member_access_required") return "denied";
  if (status === 400 || code === "invalid_request") return "invalid";
  return "unavailable";
}

export function ForumsConnectPanel() {
  const searchParams = useSearchParams();
  const attemptedRequestRef = useRef("");
  const [opaqueRequest, setOpaqueRequest] = useState<OpaqueForumsConnectRequest | null>();
  const [resumeStorageAvailable, setResumeStorageAvailable] = useState(true);
  const [state, setState] = useState<ConnectState>("checking");

  useEffect(() => {
    const resolution = resolveOpaqueForumsConnectBrowserRequest({
      searchParams,
      storage: {
        getItem: (key) => window.sessionStorage.getItem(key),
        setItem: (key, value) => window.sessionStorage.setItem(key, value),
        removeItem: (key) => window.sessionStorage.removeItem(key),
      },
      scrubQuery: () => window.history.replaceState(window.history.state, "", "/forums/connect"),
    });
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      setResumeStorageAvailable(resolution.storageAvailable);
      setOpaqueRequest(resolution.request);
      setState(resolution.storageAvailable ? "checking" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const continueToForums = useCallback(async () => {
    if (opaqueRequest === undefined) return;
    if (!resumeStorageAvailable) {
      setState("unavailable");
      return;
    }
    if (!opaqueRequest) {
      setState("invalid");
      return;
    }
    const { sso, sig } = opaqueRequest;
    const requestKey = `${sso}\n${sig}`;
    if (attemptedRequestRef.current === requestKey) return;

    attemptedRequestRef.current = requestKey;
    setState("checking");
    const sessionResult = await getCurrentSession();
    const accessToken = sessionResult.ok ? sessionResult.data?.session?.access_token || "" : "";
    if (!accessToken) {
      attemptedRequestRef.current = "";
      setState("sign-in");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/forums/discourse-connect", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sso, sig }),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as {
        code?: unknown;
        redirectUrl?: unknown;
      };
      const redirectUrl = approvedForumsDiscourseConnectRedirect(payload.redirectUrl);
      if (!response.ok || !redirectUrl) {
        const nextState = requestErrorState(response.status, payload.code);
        if (nextState === "invalid" || nextState === "denied") {
          window.sessionStorage.removeItem(FORUMS_CONNECT_REQUEST_STORAGE_KEY);
        }
        setState(nextState);
        return;
      }

      window.sessionStorage.removeItem(FORUMS_CONNECT_REQUEST_STORAGE_KEY);
      window.location.assign(redirectUrl);
    } catch {
      setState("unavailable");
    } finally {
      window.clearTimeout(timeout);
    }
  }, [opaqueRequest, resumeStorageAvailable]);

  useEffect(() => {
    void Promise.resolve().then(continueToForums);
    const subscription = onAuthStateChange(() => {
      void continueToForums();
    });
    return () => subscription.data?.subscription?.unsubscribe();
  }, [continueToForums]);

  const busy = state === "checking";
  const canRetry = state === "unavailable" && resumeStorageAvailable;
  const shouldReturn = state === "invalid" || state === "denied";
  const status = STATE_STATUS[state];

  return (
    <section className="glass-card glass-card--primary glass-pad auth-panel" aria-busy={busy} aria-labelledby="forumsConnectTitle" aria-live="polite">
      <div className="auth-panel__head">
        <div>
          <p className="kicker">Member Forums</p>
          <h2 className="section-title" id="forumsConnectTitle">Continue to Mōchirīī Forums</h2>
        </div>
        <p className={`status-pill status-pill--${status.tone}`}>
          {status.label}
        </p>
      </div>

      <WorkflowNotice tone={state === "denied" || state === "invalid" ? "warning" : state === "unavailable" ? "danger" : "info"}>
        {STATE_COPY[state]}
      </WorkflowNotice>

      <div className="auth-actions">
        {state === "sign-in" ? (
          <Link className="hero-cta hero-cta--primary" href={FORUMS_CONNECT_LOGIN_HREF} prefetch={false}>Sign in</Link>
        ) : null}
        {canRetry ? (
          <button
            className="hero-cta hero-cta--primary"
            type="button"
            onClick={() => {
              attemptedRequestRef.current = "";
              void continueToForums();
            }}
          >
            Try again
          </button>
        ) : null}
        {shouldReturn ? (
          <a className="hero-cta" href={FORUMS_ORIGIN}>Return to Mōchirīī Forums</a>
        ) : null}
      </div>
    </section>
  );
}
