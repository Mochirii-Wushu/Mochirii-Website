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
      <div className="bg-photo" aria-hidden="true">
        {home ? (
          // Native candidates preserve the reviewed optimizer bytes without a request-time transform.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            srcSet="/assets/home/background/wuxia-bg-640.webp 640w, /assets/home/background/wuxia-bg-828.webp 828w, /assets/home/background/wuxia-bg-1080.webp 1080w, /assets/home/background/wuxia-bg-1200.webp 1200w, /assets/home/background/wuxia-bg-1536.webp 1536w"
            sizes="100vw"
            alt=""
            className="bg-photo__image"
            width={1536}
            height={1024}
            style={{ position: "absolute", height: "100%", width: "100%", left: 0, top: 0, right: 0, bottom: 0 }}
            loading="eager"
            decoding="async"
            fetchPriority="low"
            src="/assets/bg/wuxia-bg.webp"
          />
        ) : <Image
          src="/assets/bg/wuxia-bg.webp"
          alt=""
          className="bg-photo__image"
          fill
          sizes="100vw"
          loading="eager"
        />}
      </div>
      {children}
      <SiteFooter authState={auth.authState} launchSpinnerViewer={auth.launchSpinnerViewer} homeRecruitment={homeRecruitment} />
      <Analytics />
      <SpeedInsights />
    </DecorativeMotion>
  );
}
