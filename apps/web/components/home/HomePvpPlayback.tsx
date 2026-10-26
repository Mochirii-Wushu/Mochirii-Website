"use client";

import type { ReactNode } from "react";

function playbackRoot(node: HTMLDivElement | null) {
  return () => { node?.dispatchEvent(new Event("pvpdispose")); };
}

// Only this small intent boundary enters Home. Player logic loads on activation.
export function HomePvpPlayback(props: { children: ReactNode; className: string }) {
  return <div {...props} ref={playbackRoot} onClick={event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-pvp-play]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const root = event.currentTarget;
    void import("./pvp-player").then(module => { if (root.isConnected) module.playPvpClip(root, link); })
      .catch(() => { link.removeAttribute("data-pvp-play"); });
  }} />;
}
