"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { paidRecruitmentJoinHref } from "@/lib/paid-recruitment-tracking";

function subscribeToLocation(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function currentJoinHref() {
  return paidRecruitmentJoinHref(window.location.search);
}

function serverJoinHref() {
  return "/join";
}

export function HomeRecruitmentCtas({ discordUrl }: { discordUrl: string }) {
  const joinHref = useSyncExternalStore(subscribeToLocation, currentJoinHref, serverJoinHref);

  return (
    <div className="hero-cta-row" aria-label="Primary recruitment actions">
      <a
        className="hero-cta hero-cta--primary"
        href={discordUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Join Discord
      </a>
      <Link className="hero-cta" href={joinHref}>
        How to Join
      </Link>
    </div>
  );
}
