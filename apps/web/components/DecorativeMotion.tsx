"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DECORATIVE_MOTION_KEY, decorativeMotionPreference, type DecorativeMotionPreference } from "@/lib/decorative-motion";

type MotionState = { ready: boolean; available: boolean; reduced: boolean; preference: DecorativeMotionPreference };
const initialState: MotionState = { ready: false, available: false, reduced: true, preference: "off" };
const MotionContext = createContext({ ...initialState, enabled: false, toggle: () => {} });

export function DecorativeMotion({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());
  const pathname = usePathname();
  const enabled = state.ready && state.available && !state.reduced && state.preference === "on";

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let active = true;
    const read = () => {
      if (!active) return;
      try {
        setState({ ready: true, available: true, reduced: media.matches, preference: decorativeMotionPreference(localStorage.getItem(DECORATIVE_MOTION_KEY)) });
      } catch {
        setState({ ready: true, available: false, reduced: media.matches, preference: "off" });
      }
    };
    const storage = (event: StorageEvent) => { if (event.key === DECORATIVE_MOTION_KEY || event.key === null) read(); };
    queueMicrotask(read);
    media.addEventListener("change", read);
    window.addEventListener("storage", storage);
    return () => { active = false; media.removeEventListener("change", read); window.removeEventListener("storage", storage); };
  }, []);

  useEffect(() => {
    const shell = root.current;
    if (!shell) return;
    const nodes = Array.from(shell.querySelectorAll<HTMLElement>("[data-motion-key]"));
    if (!enabled || !("IntersectionObserver" in window)) return;
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    let active = true;
    let started = false;
    const finish = (node: HTMLElement) => {
      clearTimeout(timers.get(node));
      timers.delete(node);
      node.removeAttribute("data-motion-state");
      if (node.dataset.motionKey) seen.current.add(node.dataset.motionKey);
      observer.unobserve(node);
    };
    const observer = new IntersectionObserver(entries => {
      if (!active) return;
      for (const entry of entries) {
        const node = entry.target as HTMLElement;
        if (document.hidden || !entry.isIntersecting) { if (timers.has(node)) finish(node); continue; }
        const key = node.dataset.motionKey;
        if (!key || seen.current.has(key)) { finish(node); continue; }
        seen.current.add(key);
        node.dataset.motionState = "enter";
        timers.set(node, setTimeout(() => finish(node), node.hasAttribute("data-motion-featured") ? 1450 : 650));
      }
    }, { threshold: .12, rootMargin: "0px 0px -24px 0px" });
    const observe = () => { for (const node of nodes) if (!seen.current.has(node.dataset.motionKey || "")) observer.observe(node); };
    // First-paint content stays static. Decoration begins only after native scrolling.
    const start = () => { if (started || document.hidden) return; started = true; window.removeEventListener("scroll", start); observe(); };
    const finishTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const parent = target.closest<HTMLElement>("[data-motion-key]");
      if (parent) finish(parent);
      for (const node of target.querySelectorAll<HTMLElement>("[data-motion-key]")) finish(node);
    };
    const focus = (event: FocusEvent) => finishTarget(event.target);
    const hash = () => {
      try { finishTarget(document.getElementById(decodeURIComponent(location.hash.slice(1)))); } catch { /* Malformed fragments do not affect content. */ }
    };
    const visibility = () => {
      shell.toggleAttribute("data-motion-hidden", document.hidden);
      if (document.hidden) { for (const node of [...timers.keys()]) finish(node); observer.disconnect(); }
      else if (started) observe();
    };
    shell.addEventListener("focusin", focus);
    window.addEventListener("hashchange", hash);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("scroll", start, { passive: true });
    hash();
    visibility();
    if (window.scrollY > 0) start();
    return () => {
      active = false;
      observer.disconnect();
      for (const [node, timer] of timers) { clearTimeout(timer); node.removeAttribute("data-motion-state"); }
      shell.removeEventListener("focusin", focus);
      window.removeEventListener("hashchange", hash);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("scroll", start);
      shell.removeAttribute("data-motion-hidden");
    };
  }, [enabled, pathname]);

  const toggle = () => {
    if (!state.ready || !state.available || state.reduced) return;
    const preference = enabled ? "off" : "on";
    try {
      localStorage.setItem(DECORATIVE_MOTION_KEY, preference);
      setState(previous => ({ ...previous, preference }));
    } catch {
      setState(previous => ({ ...previous, available: false, preference: "off" }));
    }
  };

  return (
    <MotionContext.Provider value={{ ...state, enabled, toggle }}>
      <div className="site-shell" ref={root} data-decorative-motion={enabled ? "on" : "off"}>
        {children}
      </div>
    </MotionContext.Provider>
  );
}

export function MotionToggle() {
  const { ready, available, reduced, enabled, toggle } = useContext(MotionContext);
  const help = !ready ? "Decorative motion is off."
    : !available ? "Your browser cannot save this preference. Motion stays off."
      : reduced ? "Your device requests reduced motion. Motion stays off."
        : "Turn decorative motion on or off. Saved on this device.";
  return (
    <div className="motion-preference">
      <button type="button" className="motion-toggle" aria-label="Decorative motion" aria-pressed={enabled} aria-disabled={!ready || !available || reduced} aria-describedby="motion-preference-help" onClick={toggle}>
        Motion {enabled ? "on" : "off"}
      </button>
      <span className="sr-only" id="motion-preference-help">{help}</span>
    </div>
  );
}
