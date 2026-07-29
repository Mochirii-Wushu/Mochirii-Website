"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const OrdinarySiteShell = dynamic(() => import("@/components/OrdinarySiteShell").then(
  (module) => module.OrdinarySiteShell,
));
const AuthCutoverGuard = dynamic(() => import("@/components/AuthCutoverGuard").then(
  (module) => module.AuthCutoverGuard,
));

const AUTH_CUTOVER_PATHS = new Set([
  "/account",
  "/auth",
  "/gallery-submit",
  "/leader-dashboard",
  "/oauth/consent",
  "/social",
]);

function isIsolatedSpinnerPath(pathname: string) {
  return pathname === "/spinner" || pathname.startsWith("/spinner/");
}

function isIsolatedPrivateRafflePath(pathname: string) {
  return pathname === "/raffle/claim" || pathname === "/raffle/claim/"
    || pathname === "/leader-dashboard/raffle" || pathname === "/leader-dashboard/raffle/";
}

export function SiteRouteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isIsolatedSpinnerPath(pathname) || isIsolatedPrivateRafflePath(pathname)) return children;

  return (
    <OrdinarySiteShell>
      {AUTH_CUTOVER_PATHS.has(pathname) ? <AuthCutoverGuard /> : null}
      {children}
    </OrdinarySiteShell>
  );
}
