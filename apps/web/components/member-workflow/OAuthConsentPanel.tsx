"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { measureAuthenticatedRouteTask } from "@/lib/observability/authenticated-route-timing";
import {
  classifyAuthorizationDetailsFailure,
  type AuthorizationDetailsFailureKind,
} from "@/lib/oauth/authorization-details-error";
import {
  approvedSocialOAuthRedirect,
  isApprovedSocialOAuthReturnDestination,
} from "@/lib/oauth/approved-social-redirect";
import {
  createAuthorizationLoadQueue,
  type AuthorizationLoadQueue,
} from "@/lib/oauth/authorization-load-queue";
import { oauthConsentLoginHref } from "@/lib/oauth/consent-login-url";
import { priorConsentRedirect } from "@/lib/oauth/prior-consent-redirect";
import { SOCIAL_HOST } from "@/lib/public-urls";
import { getCurrentSession, onAuthStateChange } from "@/lib/supabase/auth";
import { requireReadyBrowserSupabaseClient } from "@/lib/supabase/client";
import { profileIsActive, verifyMemberAccess } from "@/lib/supabase/profile";
import { text, type MemberAccessResponse } from "@/lib/supabase/types";
import { WorkflowNotice } from "./WorkflowState";

type AuthorizationDetails = {
  authorization_id?: string;
  redirect_url?: string;
  redirect_uri?: string;
  scope?: string;
};

const SOCIAL_CLIENT_DISPLAY_NAME = "Mōchirīī Social";
const SOCIAL_SCOPE_LABELS: Readonly<Record<string, string>> = {
  openid: "Confirm your identity",
  profile: "Read your guild profile",
  email: "Read your email address",
};

function scopeList(scope: unknown) {
  return text(scope)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function scopeLabels(scope: unknown) {
  return [...new Set(scopeList(scope).map((item) => SOCIAL_SCOPE_LABELS[item] || "Additional account access"))];
}

export function OAuthConsentPanel() {
  const searchParams = useSearchParams();
  const authorizationId = text(searchParams.get("authorization_id"));
  const loginHref = useMemo(() => oauthConsentLoginHref(authorizationId), [authorizationId]);
  const [busy, setBusy] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [memberAccess, setMemberAccess] = useState<MemberAccessResponse | null>(null);
  const [status, setStatus] = useState("Checking guild social access.");
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState<AuthorizationDetailsFailureKind | "missing" | "">("");
  const loadQueueRef = useRef<AuthorizationLoadQueue | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    setErrorKind("");
    setDetails(null);
    setMemberAccess(null);

    try {
      if (!authorizationId) {
        setSignedIn(false);
        setStatus("");
        setError("This sign-in request is missing. Return to Mōchirīī Social and start again.");
        setErrorKind("missing");
        return;
      }

      const sessionResult = await getCurrentSession();
      if (!sessionResult.ok) {
        setSignedIn(false);
        setStatus("");
        setError("We couldn't check your Mōchirīī sign-in. Sign in again, then retry.");
        setErrorKind("session");
        return;
      }

      const session = sessionResult.data?.session || null;
      setSignedIn(Boolean(session));
      if (!session) {
        setStatus("Sign in before authorizing guild social access.");
        return;
      }

      const client = await requireReadyBrowserSupabaseClient();
      const { data, error: detailsError } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
      if (detailsError || !data) {
        const failure = classifyAuthorizationDetailsFailure(detailsError);
        setStatus("");
        setError(failure.message);
        setErrorKind(failure.kind);
        return;
      }

      const nextDetails = data as AuthorizationDetails;
      if (!isApprovedSocialOAuthReturnDestination(nextDetails.redirect_uri)) {
        setStatus("");
        setError("This guild social request could not be verified. Return to Mōchirīī Social and start again.");
        setErrorKind("expired");
        return;
      }

      const access = await verifyMemberAccess();
      if (!access.ok || !access.data) {
        setStatus("");
        setError("We couldn't verify guild membership. Try again.");
        setErrorKind("temporary");
        return;
      }

      const nextAccess = access.data;
      const nextActiveMember = profileIsActive(nextAccess.profile, nextAccess);
      const redirectUrl = priorConsentRedirect(nextDetails, nextActiveMember);
      if (redirectUrl) {
        window.location.assign(redirectUrl);
        return;
      }

      setMemberAccess(nextAccess);
      setDetails(nextDetails);
      setStatus(
        nextActiveMember
          ? "Guild social access is ready for review."
          : "Active guild membership is required before authorizing guild social access.",
      );
    } catch {
      setDetails(null);
      setMemberAccess(null);
      setStatus("");
      setError("We couldn't load this guild social request. Try again.");
      setErrorKind("temporary");
    } finally {
      setBusy(false);
    }
  }, [authorizationId]);

  useEffect(() => {
    const measuredLoad = () => measureAuthenticatedRouteTask("oauth-consent", load);
    const queue = createAuthorizationLoadQueue(measuredLoad);
    loadQueueRef.current = queue;
    void queue.request();
    const subscription = onAuthStateChange(() => {
      void queue.request();
    });
    return () => {
      queue.stop();
      if (loadQueueRef.current === queue) loadQueueRef.current = null;
      subscription.data?.subscription?.unsubscribe();
    };
  }, [load]);

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setError("");
    setStatus(decision === "approve" ? "Allowing guild social access." : "Cancelling guild social access.");

    try {
      const sessionResult = await getCurrentSession();
      const token = sessionResult.ok ? sessionResult.data?.session?.access_token || "" : "";
      if (!token) {
        setMemberAccess(null);
        setError("Sign in again before continuing.");
        setErrorKind("session");
        setStatus("");
        return;
      }

      const response = await fetch("/api/oauth/decision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ authorization_id: authorizationId, decision }),
      });
      const payload = await response.json().catch(() => ({})) as { redirectUrl?: string };
      const redirectUrl = approvedSocialOAuthRedirect(payload.redirectUrl);
      if (!response.ok || !redirectUrl) {
        setError("Your guild social choice could not be completed. Try again.");
        setErrorKind("temporary");
        setStatus("");
        return;
      }

      window.location.assign(redirectUrl);
    } catch {
      setError("Your guild social choice could not be completed. Try again.");
      setErrorKind("temporary");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const requestedAccess = scopeLabels(details?.scope);
  const activeMember = profileIsActive(memberAccess?.profile, memberAccess);

  return (
    <section className="glass-card glass-card--primary glass-pad auth-panel" aria-busy={busy} aria-live="polite">
      <div className="auth-panel__head">
        <div>
          <p className="kicker">Guild Social Access</p>
          <h2 className="section-title">Connect {SOCIAL_CLIENT_DISPLAY_NAME}</h2>
        </div>
        <p className={`status-pill status-pill--${activeMember ? "active" : signedIn ? "pending" : "warning"}`}>
          {activeMember ? "Active" : signedIn ? "Review" : "Sign in"}
        </p>
      </div>

      {!signedIn ? (
        <div className="auth-actions">
          <Link className="hero-cta hero-cta--primary" href={loginHref}>Login</Link>
        </div>
      ) : null}

      {details ? (
        <dl className="status-grid" aria-label="Guild social access request">
          <div>
            <dt>Destination</dt>
            <dd>{SOCIAL_CLIENT_DISPLAY_NAME}</dd>
          </div>
          <div>
            <dt>Return destination</dt>
            <dd>{SOCIAL_CLIENT_DISPLAY_NAME}</dd>
          </div>
          <div>
            <dt>Requested access</dt>
            <dd>{requestedAccess.length ? requestedAccess.join(", ") : "No additional access requested"}</dd>
          </div>
          <div>
            <dt>Member access</dt>
            <dd>{activeMember ? "Active" : "Required"}</dd>
          </div>
        </dl>
      ) : null}

      <WorkflowNotice tone={activeMember ? "success" : "warning"}>{status || "Guild social access status unavailable."}</WorkflowNotice>
      <WorkflowNotice tone="danger" role="alert" hidden={!error}>{error}</WorkflowNotice>

      {errorKind === "temporary" ? (
        <div className="auth-actions">
          <button className="hero-cta" type="button" disabled={busy} onClick={() => void loadQueueRef.current?.request()}>
            Try again
          </button>
        </div>
      ) : null}

      {errorKind === "session" ? (
        <div className="auth-actions">
          <Link className="hero-cta hero-cta--primary" href={loginHref}>Login again</Link>
        </div>
      ) : null}

      {errorKind === "expired" || errorKind === "missing" ? (
        <div className="auth-actions">
          <a className="hero-cta" href={SOCIAL_HOST}>Return to Mōchirīī Social</a>
        </div>
      ) : null}

      {details ? (
        <div className="auth-actions">
          <button className="hero-cta hero-cta--primary" type="button" disabled={busy || !signedIn || !activeMember} onClick={() => void decide("approve")}>
            Allow access
          </button>
          <button className="hero-cta" type="button" disabled={busy || !signedIn} onClick={() => void decide("deny")}>
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  );
}
