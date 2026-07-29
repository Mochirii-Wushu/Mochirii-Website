"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { useHeaderAuthState } from "@/components/site-header/use-header-auth-state";

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

  return <OrdinarySiteShell>{children}</OrdinarySiteShell>;
}

function OrdinarySiteShell({ children }: { children: ReactNode }) {
  const auth = useHeaderAuthState();

  return (
    <>
      <SiteHeader {...auth} />
      <div className="bg-photo" aria-hidden="true">
        <Image
          src="/assets/bg/wuxia-bg.webp"
          alt=""
          className="bg-photo__image"
          fill
          sizes="100vw"
          loading="eager"
        />
      </div>
      {children}
      <SiteFooter authState={auth.authState} launchSpinnerViewer={auth.launchSpinnerViewer} />
      <Analytics />
      <SpeedInsights />
    </>
  );
}
