"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { DecorativeMotion } from "@/components/DecorativeMotion";
import { useHeaderAuthState } from "@/components/site-header/use-header-auth-state";
import { getHomeRecruitment } from "@/lib/home-recruitment";

function isIsolatedSpinnerPath(pathname: string) {
  return pathname === "/spinner" || pathname.startsWith("/spinner/");
}

export function SiteRouteShell({ children, recruitmentStatus }: { children: ReactNode; recruitmentStatus: string }) {
  const pathname = usePathname();
  if (isIsolatedSpinnerPath(pathname)) return children;

  return <OrdinarySiteShell home={pathname === "/"} recruitmentStatus={recruitmentStatus}>{children}</OrdinarySiteShell>;
}

function OrdinarySiteShell({ children, home, recruitmentStatus }: { children: ReactNode; home: boolean; recruitmentStatus: string }) {
  const auth = useHeaderAuthState();
  const homeRecruitment = home ? getHomeRecruitment(recruitmentStatus) : undefined;

  return (
    <DecorativeMotion>
      <SiteHeader {...auth} homeRecruitment={homeRecruitment} />
      {!home ? <div className="bg-photo" aria-hidden="true">
        <Image
          src="/assets/bg/wuxia-bg.webp"
          alt=""
          className="bg-photo__image"
          fill
          sizes="100vw"
          loading="eager"
        />
      </div> : null}
      {children}
      <SiteFooter authState={auth.authState} launchSpinnerViewer={auth.launchSpinnerViewer} homeRecruitment={homeRecruitment} />
      <Analytics />
      <SpeedInsights />
    </DecorativeMotion>
  );
}
