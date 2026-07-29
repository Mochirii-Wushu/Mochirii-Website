"use client";

import { useEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT_ID = "mochirii-turnstile-api";
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_LOAD_TIMEOUT_MS = 8_000;

type TurnstileWidgetId = string | number;

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: "dark";
      size: "compact";
      action: string;
      "response-field": false;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "timeout-callback": () => void;
      "error-callback": () => void;
    },
  ) => TurnstileWidgetId;
  remove: (widgetId: TurnstileWidgetId) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileLoader: Promise<TurnstileApi> | null = null;

function waitForTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);

  return new Promise<TurnstileApi>((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (window.turnstile) {
        window.clearInterval(timer);
        resolve(window.turnstile);
        return;
      }
      if (Date.now() - startedAt >= TURNSTILE_LOAD_TIMEOUT_MS) {
        window.clearInterval(timer);
        reject(new Error("Verification challenge timed out."));
      }
    }, 50);
  });
}

function loadTurnstile() {
  if (turnstileLoader) return turnstileLoader;

  turnstileLoader = new Promise<TurnstileApi>((resolve, reject) => {
    const finish = () => {
      void waitForTurnstile().then(resolve, reject);
    };
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      finish();
      return;
    }

    const script = document.createElement("script");
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("Verification challenge could not load."));
    }, { once: true });
    document.head.append(script);
  }).catch((error) => {
    document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
    turnstileLoader = null;
    throw error;
  });

  return turnstileLoader;
}

export function AuthCaptcha({
  siteKey,
  onTokenChange,
}: {
  siteKey: string;
  onTokenChange: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading verification challenge.");

  useEffect(() => {
    let active = true;
    let widgetId: TurnstileWidgetId | null = null;
    onTokenChange("");

    void loadTurnstile()
      .then((turnstile) => {
        if (!active || !containerRef.current) return;
        setStatus("Complete the verification challenge before requesting a code.");
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: "dark",
          size: "compact",
          action: "phone_otp",
          "response-field": false,
          callback: (token) => {
            if (!active) return;
            onTokenChange(token);
            setStatus("Verification complete.");
          },
          "expired-callback": () => {
            if (!active) return;
            onTokenChange("");
            setStatus("Verification expired. Complete the challenge again.");
          },
          "timeout-callback": () => {
            if (!active) return;
            onTokenChange("");
            setStatus("Verification timed out. Complete the challenge again.");
          },
          "error-callback": () => {
            if (!active) return;
            onTokenChange("");
            setStatus("Verification is unavailable. Try again in a moment.");
          },
        });
      })
      .catch(() => {
        if (!active) return;
        onTokenChange("");
        setStatus("Verification is unavailable. Try again in a moment.");
      });

    return () => {
      active = false;
      onTokenChange("");
      if (widgetId !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // The provider may already have discarded an expired widget.
        }
      }
    };
  }, [onTokenChange, siteKey]);

  return (
    <div className="phone-captcha" aria-describedby="phoneCaptchaStatus">
      <div className="phone-captcha__widget" ref={containerRef} />
      <p className="auth-status muted" id="phoneCaptchaStatus" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
