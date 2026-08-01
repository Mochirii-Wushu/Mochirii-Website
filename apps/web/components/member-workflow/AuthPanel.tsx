"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ProviderLogo } from "@/components/member-workflow/ProviderLogo";
import { enabledAuthProviders, enabledOAuthProviders, placeholderOAuthProviders, type OAuthProviderId } from "@/lib/supabase/auth-providers";
import { getCurrentUser, onAuthStateChange, signInWithPhoneOtp, signInWithProvider, signOut, verifyPhoneOtp } from "@/lib/supabase/auth";
import { NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY } from "@/lib/supabase/config";
import {
  PHONE_OTP_REQUEST_PUBLIC_MESSAGE,
  PHONE_OTP_VERIFY_PUBLIC_ERROR_MESSAGE,
  createPhoneOtpResendDeadline,
  phoneOtpResendSecondsRemaining,
  readPhoneOtpResendDeadline,
  writePhoneOtpResendDeadline,
} from "@/lib/supabase/phone-auth-policy";
import { signedInName } from "@/lib/supabase/profile";
import { resolveAuthReturnPath } from "@/lib/supabase/auth-redirect";
import { PRIVATE_RAFFLE_AUTH_RETURN_PATHS } from "@/lib/supabase/raffle-auth-paths";
import type { User } from "@supabase/supabase-js";

const AuthCaptcha = dynamic(
  () => import("@/components/member-workflow/AuthCaptcha").then((module) => module.AuthCaptcha),
  {
    ssr: false,
    loading: () => <p className="auth-status muted" role="status">Loading verification challenge.</p>,
  },
);

export function AuthPanel() {
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState("Checking your current session.");
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [resendDeadline, setResendDeadline] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const providers = useMemo(() => enabledAuthProviders(), []);
  const oauthProviders = useMemo(() => enabledOAuthProviders(), []);
  const placeholderProviders = useMemo(() => placeholderOAuthProviders(), []);
  const phoneProvider = providers.find((provider) => provider.id === "phone");
  const requiresFreshSignIn = searchParams.get("reauth") === "1";
  const callbackError = searchParams.get("error");
  const callbackFailed = callbackError === "session" || callbackError === "sign_in_failed";
  const redirectTo = useMemo(() => {
    return resolveAuthReturnPath(searchParams.get("redirect"), PRIVATE_RAFFLE_AUTH_RETURN_PATHS);
  }, [searchParams]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(callbackFailed ? "Sign-in could not be completed. Try again." : "");
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
  }, [callbackFailed, requiresFreshSignIn]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
    const subscription = onAuthStateChange(() => {
      void load();
    });
    return () => {
      subscription.data?.subscription?.unsubscribe();
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const restoredDeadline = readPhoneOtpResendDeadline(window.sessionStorage, Date.now());
        setResendDeadline(restoredDeadline);
        setResendSeconds(phoneOtpResendSecondsRemaining(restoredDeadline, Date.now()));
      } catch {
        setResendDeadline(0);
        setResendSeconds(0);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!resendDeadline) return;

    const update = () => {
      const remaining = phoneOtpResendSecondsRemaining(resendDeadline, Date.now());
      setResendSeconds(remaining);
      if (!remaining) setResendDeadline(0);
    };
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [resendDeadline]);

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
    if (resendSeconds > 0) {
      setError(`Wait ${resendSeconds} seconds before requesting another code.`);
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Sending phone verification code.");
    const result = await signInWithPhoneOtp({ phone, captchaToken });
    setCaptchaToken("");
    setCaptchaResetKey((current) => current + 1);
    if (!result.ok) {
      setError(result.message || "Phone sign-in is unavailable.");
      setStatus("");
      setBusy(false);
      return;
    }
    const deadline = createPhoneOtpResendDeadline(Date.now());
    try {
      writePhoneOtpResendDeadline(window.sessionStorage, deadline);
    } catch {
      // Supabase enforces the authoritative send window if browser storage is unavailable.
    }
    setResendDeadline(deadline);
    setResendSeconds(phoneOtpResendSecondsRemaining(deadline, Date.now()));
    setPhoneCodeSent(true);
    setStatus(result.message || PHONE_OTP_REQUEST_PUBLIC_MESSAGE);
    setBusy(false);
  }

  async function verifyPhoneCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("Checking phone code.");
    const result = await verifyPhoneOtp({ phone, token: phoneCode });
    if (!result.ok) {
      setError(PHONE_OTP_VERIFY_PUBLIC_ERROR_MESSAGE);
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
  const canRequestPhoneCode = !busy && Boolean(captchaToken) && resendSeconds === 0;
  const resendLabel = resendSeconds > 0 ? `Send another code in ${resendSeconds}s` : "Send another code";

  function useAnotherPhone() {
    setPhoneCode("");
    setPhoneCodeSent(false);
    setCaptchaToken("");
    setCaptchaResetKey((current) => current + 1);
    setError("");
    setStatus("Enter a phone number with its country code.");
  }

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
            {oauthProviders.map((provider) => {
              const noteId = `provider-note-${provider.id}`;
              return (
                <div className="provider-option" role="listitem" key={provider.id}>
                  <button
                    className={`provider-button provider-button--${provider.id}`}
                    type="button"
                    onClick={() => login(provider.id)}
                    disabled={busy}
                    aria-describedby={noteId}
                  >
                    <ProviderLogo provider={provider.id} />
                    <span className="provider-button__label">{provider.signInLabel}</span>
                  </button>
                  <small className="provider-option__note" id={noteId}>
                    {provider.automaticVerification ? "Automatic Discord role check" : "Moderator review required"}
                  </small>
                </div>
              );
            })}
            {placeholderProviders.map((provider) => {
              const noteId = `provider-note-${provider.id}`;
              return (
                <div className="provider-option" role="listitem" key={`placeholder-${provider.id}`}>
                  <button
                    className={`provider-button provider-button--${provider.id} provider-button--placeholder`}
                    type="button"
                    disabled
                    aria-describedby={noteId}
                  >
                    <ProviderLogo provider={provider.id} />
                    <span className="provider-button__label">{provider.signInLabel}</span>
                  </button>
                  <small className="provider-option__note" id={noteId}>
                    Setup pending.
                  </small>
                </div>
              );
            })}
          </div>
        ) : null}
        {signedIn ? (
          <>
            <Link className="hero-cta" href={redirectTo}>
              {redirectTo === "/account" ? "Open Account" : "Continue"}
            </Link>
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
                  enterKeyHint="next"
                  value={phone}
                  disabled={busy}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+1 555 010 0000"
                  aria-describedby="phoneNumberHelp"
                  required
                />
              </label>
              <p className="auth-status muted" id="phoneNumberHelp">Include the country code, beginning with +.</p>
              <AuthCaptcha
                key={captchaResetKey}
                siteKey={NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY}
                onTokenChange={setCaptchaToken}
              />
              <div className="auth-actions">
                <button className="hero-cta" type="submit" disabled={!canRequestPhoneCode}>
                  {resendSeconds > 0 ? `Send code in ${resendSeconds}s` : "Send code"}
                </button>
              </div>
            </form>
          ) : (
            <div className="phone-auth-panel__code-flow">
              <form className="auth-form" onSubmit={verifyPhoneCode}>
                <label className="form-field">
                  <span>Verification code</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    enterKeyHint="done"
                    pattern="[0-9]*"
                    minLength={6}
                    maxLength={10}
                    value={phoneCode}
                    disabled={busy}
                    onChange={(event) => setPhoneCode(event.target.value)}
                    required
                  />
                </label>
                <div className="auth-actions">
                  <button className="hero-cta hero-cta--primary" type="submit" disabled={busy}>Verify code</button>
                  <button className="hero-cta" type="button" onClick={useAnotherPhone} disabled={busy}>Use another phone</button>
                </div>
              </form>
              <form className="auth-form phone-auth-panel__resend" onSubmit={requestPhoneCode}>
                <AuthCaptcha
                  key={captchaResetKey}
                  siteKey={NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY}
                  onTokenChange={setCaptchaToken}
                />
                <button className="hero-cta" type="submit" disabled={!canRequestPhoneCode} aria-live="off">
                  {resendLabel}
                </button>
              </form>
            </div>
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
