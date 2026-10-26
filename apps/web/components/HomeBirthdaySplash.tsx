"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type CelebrationSplashConfig = {
  enabled?: boolean;
  startsAt?: string;
  endsAt?: string;
};

const DISPLAY_MS = 5200;

function parseDateBound(value: string | undefined, fallback: number) {
  const raw = value?.trim();
  return raw ? Date.parse(raw) : fallback;
}

export function HomeBirthdaySplash({ config, children }: { config?: CelebrationSplashConfig | null; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!config?.enabled) return;
    const now = Date.now();
    const startsAt = parseDateBound(config.startsAt, -Infinity), endsAt = parseDateBound(config.endsAt, Infinity);
    // Comparisons also fail closed for Date.parse's NaN result.
    if (!(startsAt <= now && now <= endsAt)) return;

    const showTimer = setTimeout(() => setVisible(true), 0);

    return () => clearTimeout(showTimer);
  }, [config]);

  useEffect(() => {
    if (!visible) return undefined;
    const dismiss = () => setVisible(false);

    const focusTimer = setTimeout(() => rootRef.current?.querySelector<HTMLButtonElement>("[data-dismiss]")?.focus(), 80);
    const autoTimer = setTimeout(dismiss, DISPLAY_MS);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(focusTimer);
      clearTimeout(autoTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div ref={rootRef} onClick={event => {
      if ((event.target as Element).closest("[data-dismiss]")) setVisible(false);
    }}>{children}</div>
  );
}
