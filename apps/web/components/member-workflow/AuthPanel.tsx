"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ProviderLogo } from "@/components/member-workflow/ProviderLogo";
import { enabledAuthProviders, enabledOAuthProviders, placeholderOAuthProviders, type OAuthProviderId } from "@/lib/supabase/auth-providers";
import { getCurrentUser, onAuthStateChange, signInWithPhoneOtp, signInWithProvider, signOut, verifyPhoneOtp } from "@/lib/supabase/auth";
import { signedInName } from "@/lib/supabase/profile";
import { resolveAuthReturnPath } from "@/lib/supabase/auth-redirect";
import { PRIVATE_RAFFLE_AUTH_RETURN_PATHS } from "@/lib/supabase/raffle-auth-paths";
import type { User } from "@supabase/supabase-js";

export function AuthPanel() {
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState("Checking your current session.");
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const providers = useMemo(() => enabledAuthProviders(), []);
  const oauthProviders = useMemo(() => enabledOAuthProviders(), []);
  const placeholderProviders = useMemo(() => placeholderOAuthProviders(), []);
  const phoneProvider = providers.find((provider) => provider.id === "phone");
  const requiresFreshSignIn = searchParams.get("reauth") === "1";
  const redirectTo = useMemo(() => {
    return resolveAuthReturnPath(searchParams.get("redirect"), PRIVATE_RAFFLE_AUTH_RETURN_PATHS);
  }, [searchParams]);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const result = await getCurrentUser();
    const currentUser = result.ok ? result.data?.user || null : null;
    setUser(currentUser);
    setStatus(
      currentUser
        ? `Signed in as ${signedInName(currentUser)}. Open Account to check member verification.`
        : requiresFreshSignIn
          ? "Sign in again to finish the secure session update."
          : "Choose a sign-in method. Gallery upload access is verified separately.",
    );
    setBusy(false);
  }, [requiresFreshSignIn]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
    const subscription = onAuthStateChange(() => {
      void load();
    });
    return () => {
      subscription.data?.subscription?.unsubscribe();
    };
  }, [load]);

  async function login(providerId: OAuthProviderId) {
    setBusy(true);
    setError("");
    const provider = providers.find((item) => item.id === providerId);
    setStatus(`Opening ${provider?.label || "provider"} sign-in.`);
    const result = await signInWithProvider(providerId, { redirectTo });
    if (!result.ok) {
      setError(result.message || "Sign-in could not start.");
      setStatus("");
      setBusy(false);
    }
  }

  async function requestPhoneCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("Sending phone verification code.");
    const result = await signInWithPhoneOtp({ phone });
    if (!result.ok) {
      setError(result.message || "Phone code could not be sent.");
      setStatus("");
      setBusy(false);
      return;
    }
    setPhoneCodeSent(true);
    setStatus(result.message || "Code sent. Check your phone.");
    setBusy(false);
  }

  async function verifyPhoneCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("Checking phone code.");
    const result = await verifyPhoneOtp({ phone, token: phoneCode });
    if (!result.ok) {
      setError(result.message || "Phone code could not be verified.");
      setStatus("");
      setBusy(false);
      return;
    }
    setPhoneCode("");
    setPhoneCodeSent(false);
    setStatus(result.message || "Phone sign-in complete.");
    await load();
  }

  async function endSession() {
    setBusy(true);
    setError("");
    const result = await signOut();
    if (!result.ok) setError(result.message || "Sign out failed.");
    await load();
  }

  const signedIn = Boolean(user);

  return (
    <section className="glass-card glass-card--primary glass-pad auth-panel" aria-labelledby="authTitle">
      <div className="auth-panel__head">
        <div>
          <p className="kicker">Member Auth</p>
          <h2 className="section-title" id="authTitle">Website Sign-In</h2>
        </div>
        <p className="status-pill" id="authState">{busy ? "Checking" : signedIn ? "Signed in" : "Signed out"}</p>
      </div>

      <div className="prose-stack auth-copy">
        <p>
          Sign in to create or open your website account. Sign-in proves account control only; gallery upload access
          still requires Discord role verification or a moderator-approved member verification.
        </p>
      </div>

      <div className="auth-actions" aria-label="Authentication actions">
        {!signedIn ? (
          <div className="provider-grid" role="list" aria-label="Available sign-in providers">
            {oauthProviders.map((provider) => (
              <button
                className={`provider-button${provider.id === "discord" ? " provider-button--primary" : ""}`}
                type="button"
                onClick={() => login(provider.id)}
                disabled={busy}
                key={provider.id}
              >
                <ProviderLogo provider={provider.id} />
                <span className="provider-button__copy">
                  <span>{provider.label}</span>
                  <small>{provider.automaticVerification ? "Automatic Discord role check" : "Moderator review required"}</small>
                </span>
              </button>
            ))}
            {placeholderProviders.map((provider) => (
              <button
                className="provider-button provider-button--placeholder"
                type="button"
                disabled
                aria-label={`${provider.label} sign-in setup pending`}
                title={provider.setupNote}
                key={`placeholder-${provider.id}`}
              >
                <ProviderLogo provider={provider.id} />
                <span className="provider-button__copy">
                  <span>{provider.label}</span>
                  <small>Setup pending</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {signedIn ? (
          <>
            <Link className="hero-cta" href="/account">Open Account</Link>
            <button className="hero-cta" type="button" onClick={endSession} disabled={busy}>Sign out</button>
          </>
        ) : null}
      </div>

      {!signedIn && phoneProvider ? (
        <div className="phone-auth-panel">
          {!phoneCodeSent ? (
            <form className="auth-form" onSubmit={requestPhoneCode}>
              <label className="form-field">
                <span>Phone number</span>
                <input
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={phone}
                  disabled={busy}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+1 555 010 0000"
                />
              </label>
              <div className="auth-actions">
                <button className="hero-cta" type="submit" disabled={busy}>Send code</button>
              </div>
            </form>
          ) : (
            <form className="auth-form" onSubmit={verifyPhoneCode}>
              <label className="form-field">
                <span>Verification code</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={phoneCode}
                  disabled={busy}
                  onChange={(event) => setPhoneCode(event.target.value)}
                />
              </label>
              <div className="auth-actions">
                <button className="hero-cta hero-cta--primary" type="submit" disabled={busy}>Verify code</button>
                <button className="hero-cta" type="button" onClick={() => setPhoneCodeSent(false)} disabled={busy}>Use another phone</button>
              </div>
            </form>
          )}
          <p className="auth-status muted">{phoneProvider.setupNote}</p>
        </div>
      ) : null}

      <p className="auth-status muted" id="authStatus" role="status" aria-live="polite">
        {status}
      </p>
      <p className="auth-error" id="authError" role="alert" hidden={!error}>
        {error}
      </p>
    </section>
  );
}
