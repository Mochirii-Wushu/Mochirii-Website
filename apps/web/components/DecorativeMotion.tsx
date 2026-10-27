"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DECORATIVE_MOTION_KEY, decorativeMotionPreference, type DecorativeMotionPreference } from "@/lib/decorative-motion";

type MotionState = { ready: boolean; available: boolean; reduced: boolean; preference: DecorativeMotionPreference };
type MotionController = { setVisible: (visible: boolean) => void; dispose: () => void };
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
    if (!enabled) return;
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    let active = true;
    let started = false;
    const scene = shell.querySelector<HTMLElement>("[data-home-scene]");
    const swords = shell.querySelector<HTMLElement>(".home-sword-duel");
    const poster = scene?.querySelector<HTMLImageElement>("#heroImage");
    const abort = new AbortController();
    let sceneVisible = false;
    let scenePending = false;
    let scenePaintFrame = 0;
    let posterPainted = false;
    let paintObserver: PerformanceObserver | null = null;
    let paintFallback: ReturnType<typeof setTimeout> | undefined;
    const painted = () => {
      posterPainted = true;
      paintObserver?.disconnect();
      clearTimeout(paintFallback);
      window.removeEventListener("load", fallbackAfterLoad);
      enhance();
    };
    const fallbackAfterLoad = () => { paintFallback = setTimeout(painted, 1200); };
    let sceneController: MotionController | null = null;
    let swordsController: MotionController | null = null;
    const enhance = () => {
      if (!active || !scene || !poster || scenePending || !sceneVisible || document.hidden) return;
      if (!poster.complete || !poster.naturalWidth) return;
      if (!posterPainted) {
        if (paintObserver || paintFallback) return;
        if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("largest-contentful-paint")) {
          paintObserver = new PerformanceObserver(list => {
            if (list.getEntries().some(entry => (entry as PerformanceEntry & { element?: Element }).element === poster)) painted();
          });
          paintObserver.observe({ type: "largest-contentful-paint", buffered: true });
        }
        // Engines without LCP entries (or an early interaction ending them)
        // keep the poster visible and use a conservative post-load fallback.
        if (document.readyState === "complete") fallbackAfterLoad();
        else window.addEventListener("load", fallbackAfterLoad, { once: true });
        return;
      }
      scenePending = true;
      scene.dataset.sceneBootstrap = "home-scene-bootstrap-v1";
      // Give the decoded poster a paint before fetching or initializing decoration.
      scenePaintFrame = requestAnimationFrame(() => {
        scenePaintFrame = requestAnimationFrame(() => {
          if (!active || document.hidden || !sceneVisible) { scenePending = false; return; }
          void import("./home-scene").then(module => module.mountHomeScene(scene, abort.signal)).then(controller => {
            if (!active) controller?.dispose();
            else { sceneController = controller; controller?.setVisible(sceneVisible && !document.hidden); }
          }).catch(() => { /* The complete static poster remains available. */ });
        });
      });
    };
    poster?.addEventListener("load", enhance);
    const finish = (node: HTMLElement) => {
      clearTimeout(timers.get(node));
      timers.delete(node);
      node.removeAttribute("data-motion-state");
      if (node.dataset.motionKey) seen.current.add(node.dataset.motionKey);
      if (!node.hasAttribute("data-motion-persistent") && node !== scene) observer?.unobserve(node);
    };
    const observer = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
      if (!active) return;
      for (const entry of entries) {
        const node = entry.target as HTMLElement;
        if (node === scene || node.hasAttribute("data-motion-persistent")) {
          node.dataset.sceneVisible = String(entry.isIntersecting && !document.hidden);
          shell.dispatchEvent(new Event("motionvisibility"));
          if (node === scene) {
            sceneVisible = entry.isIntersecting && !document.hidden;
            sceneController?.setVisible(sceneVisible);
            enhance();
            continue;
          }
        }
        if (!started) continue;
        if (document.hidden || !entry.isIntersecting) { if (timers.has(node)) finish(node); continue; }
        const key = node.dataset.motionKey;
        if (!key || seen.current.has(key)) { finish(node); continue; }
        seen.current.add(key);
        node.dataset.motionState = "enter";
        timers.set(node, setTimeout(() => finish(node), node.hasAttribute("data-motion-featured") ? 1450 : 650));
      }
    }, { threshold: .12, rootMargin: "0px 0px -24px 0px" }) : null;
    const observe = () => { for (const node of nodes) if (node === scene || node.hasAttribute("data-motion-persistent") || started && !seen.current.has(node.dataset.motionKey || "")) { observer?.unobserve(node); observer?.observe(node); } };
    // First-paint content stays static. Decoration begins only after native scrolling.
    const start = () => {
      if (started || document.hidden) return;
      started = true;
      window.removeEventListener("scroll", start);
      if (swords) void import("./home-scene").then(module => {
        if (!active) return;
        swordsController = module.mountHomeSwords(swords, abort.signal);
        swordsController?.setVisible(!document.hidden);
      }).catch(() => { /* Static sword poses remain available. */ });
      observe();
    };
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
      swordsController?.setVisible(!document.hidden);
      if (document.hidden) {
        sceneVisible = false;
        sceneController?.setVisible(false);
        for (const node of nodes) if (node.hasAttribute("data-scene-visible")) node.dataset.sceneVisible = "false";
        for (const node of [...timers.keys()]) finish(node);
        observer?.disconnect();
      } else observe();
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
      abort.abort();
      cancelAnimationFrame(scenePaintFrame);
      paintObserver?.disconnect();
      clearTimeout(paintFallback);
      window.removeEventListener("load", fallbackAfterLoad);
      sceneController?.dispose();
      swordsController?.dispose();
      poster?.removeEventListener("load", enhance);
      observer?.disconnect();
      for (const [node, timer] of timers) { clearTimeout(timer); node.removeAttribute("data-motion-state"); }
      shell.removeEventListener("focusin", focus);
      window.removeEventListener("hashchange", hash);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("scroll", start);
      shell.removeAttribute("data-motion-hidden");
      for (const node of nodes) { node.removeAttribute("data-scene-visible"); node.removeAttribute("data-scene-bootstrap"); }
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
  const helpId = useId();
  const help = !ready ? "Decorative motion is off."
    : !available ? "Your browser cannot save this preference. Motion stays off."
      : reduced ? "Your device requests reduced motion. Motion stays off."
        : "Turn decorative motion on or off. Saved on this device.";
  return (
    <div className="motion-preference">
      <button type="button" className="motion-toggle" aria-label="Decorative motion" aria-pressed={enabled} aria-disabled={!ready || !available || reduced} aria-describedby={helpId} onClick={toggle}>
        Motion {enabled ? "on" : "off"}
      </button>
      <span className="sr-only" id={helpId}>{help}</span>
    </div>
  );
}
