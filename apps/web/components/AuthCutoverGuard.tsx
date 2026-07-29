"use client";

import { useEffect } from "react";
import { reauthLoginPathForLocation } from "@/lib/supabase/auth-redirect";
import { getBrowserAuthCutoverResult } from "@/lib/supabase/client";

export function AuthCutoverGuard() {
  useEffect(() => {
    let active = true;
    void getBrowserAuthCutoverResult().then((result) => {
      if (!active) return;
      const reauthPath = result.status === "legacy-oauth"
        ? result.reauthPath
        : result.status === "invalid" || result.status === "reauth-required"
          ? reauthLoginPathForLocation(window.location.href)
          : null;
      if (!reauthPath) return;
      const destination = new URL(reauthPath, window.location.origin).href;
      if (window.location.href !== destination) window.location.replace(destination);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return null;
}
