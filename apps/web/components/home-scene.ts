// Home-only optional enhancement. Content and the matching poster are server-rendered.
export type HomeSceneController = { setVisible: (visible: boolean) => void; dispose: () => void };
const SCENE_VERSION = "HOME_SCENE_RENDERER_V1";

export async function mountHomeScene(node: HTMLElement, signal: AbortSignal): Promise<HomeSceneController | null> {
  if (signal.aborted || typeof Worker !== "function" || typeof OffscreenCanvas !== "function") return null;
  if (typeof CSS === "undefined" || !CSS.supports("mask-image", "linear-gradient(#000,#000)")) return null;
  const canvas = document.createElement("canvas");
  if (typeof canvas.transferControlToOffscreen !== "function") return null;
  canvas.className = "home-scene-canvas";
  canvas.dataset.sceneVersion = SCENE_VERSION;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.pointerEvents = "none";
  let worker: Worker;
  // This import-free module needs no bundler runtime. Next still owns its asset URL/hash.
  const workerUrl = new URL("./home-scene-worker.js", import.meta.url);
  try { worker = new Worker(workerUrl.href, { type: "module" }); }
  catch { return null; }

  const section = node.closest<HTMLElement>(".home-hero");
  let focused = !!section?.contains(document.activeElement) && !document.activeElement?.closest(".motion-toggle");
  let visible = false, ready = false, disposed = false;
  let resolveMount: (controller: HomeSceneController | null) => void;
  const mounted = new Promise<HomeSceneController | null>(resolve => { resolveMount = resolve; });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("resize", resize);
    section?.removeEventListener("focusin", focusIn);
    section?.removeEventListener("focusout", focusOut);
    worker.removeEventListener("message", message);
    worker.removeEventListener("error", failed);
    worker.removeEventListener("messageerror", failed);
    signal.removeEventListener("abort", dispose);
    node.removeAttribute("data-scene-ready");
    node.removeAttribute("data-scene-active");
    canvas.remove();
    // Terminating the dedicated worker releases its context, pending loads and RAF.
    worker.terminate();
    resolveMount(null);
  };
  function failed(e: Event) { e.preventDefault(); dispose(); }
  function message(e: MessageEvent) {
    if (disposed) return;
    if (e.data?.type === "failed") { dispose(); return; }
    if (e.data?.type !== "ready" || ready) return;
    ready = true;
    node.append(canvas);
    node.dataset.sceneReady = "true";
    run();
    resolveMount({ setVisible(value) { visible = value; run(); }, dispose });
  }
  function geometry() {
    const box = node.getBoundingClientRect();
    const scale = Math.min(devicePixelRatio || 1, 2);
    let crop: number[];
    if (matchMedia("(max-width: 680px)").matches) crop = [640 / 1536, 215 / 1024, 896 / 1536, 560 / 1024];
    else {
      const fit = Math.max(box.width / 1536, box.height / 560);
      const w = box.width / fit, h = box.height / fit;
      crop = [(1536 - w) * .5 / 1536, (215 + (560 - h) * .45) / 1024, w / 1536, h / 1024];
    }
    return { width: Math.max(1, Math.round(box.width * scale)), height: Math.max(1, Math.round(box.height * scale)), crop };
  }
  function resize() {
    if (disposed) return;
    worker.postMessage({ type: "resize", ...geometry() });
  }
  function run() {
    if (disposed) return;
    const active = ready && visible && !focused && !document.hidden;
    node.dataset.sceneActive = String(active);
    worker.postMessage({ type: "visible", visible: active });
  }
  function focusIn(e: FocusEvent) {
    focused = !(e.target instanceof Element && e.target.closest(".motion-toggle"));
    run();
  }
  function focusOut(e: FocusEvent) { if (!section?.contains(e.relatedTarget as Node | null)) { focused = false; run(); } }

  worker.addEventListener("message", message);
  worker.addEventListener("error", failed);
  worker.addEventListener("messageerror", failed);
  signal.addEventListener("abort", dispose, { once: true });
  window.addEventListener("resize", resize, { passive: true });
  section?.addEventListener("focusin", focusIn);
  section?.addEventListener("focusout", focusOut);
  try {
    const frame = geometry();
    canvas.width = frame.width;
    canvas.height = frame.height;
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: "init", canvas: offscreen, ...frame, small: matchMedia("(max-width: 680px)").matches }, [offscreen]);
  } catch { dispose(); }
  return mounted;
}

// This stage follows the document, independently of hero paint or GPU support.
export function mountHomeSwords(node: HTMLElement, signal: AbortSignal): HomeSceneController | null {
  if (signal.aborted) return null;
  const nativeTimeline = typeof CSS !== "undefined" && CSS.supports("animation-timeline: scroll(root block)");
  let disposed = false, visible = true, frame = 0;
  function update() {
    frame = 0;
    if (disposed) return;
    const focus = document.activeElement;
    const keyboardFocus = focus instanceof Element && focus.matches(":focus-visible") && !focus.closest(".motion-toggle");
    const active = visible && !document.hidden && document.body.style.position !== "fixed"
      && document.body.style.overflow !== "hidden"
      && !keyboardFocus
      && !document.querySelector('[aria-modal="true"]:not([hidden]),[data-dropdown][data-open="true"]');
    node.dataset.swordsActive = String(active);
    if (active && !nativeTimeline) {
      const distance = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      const progress = Math.max(0, Math.min(1, window.scrollY / distance));
      node.style.setProperty("--home-sword-progress", progress.toFixed(5));
    }
  }
  function sync() {
    cancelAnimationFrame(frame);
    update();
  }
  function request() {
    if (disposed) return;
    if (!visible || document.hidden) { sync(); return; }
    if (!frame) frame = requestAnimationFrame(update);
  }
  function scroll() { if (node.dataset.swordsActive === "true") request(); }
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", request);
    window.removeEventListener("scroll", scroll);
    document.removeEventListener("focusin", sync);
    document.removeEventListener("focusout", request);
    document.removeEventListener("click", request);
    document.removeEventListener("keydown", request);
    signal.removeEventListener("abort", dispose);
    node.removeAttribute("data-swords-ready");
    node.removeAttribute("data-swords-active");
    node.style.removeProperty("--home-sword-progress");
  };
  window.addEventListener("resize", request, { passive: true });
  if (!nativeTimeline) window.addEventListener("scroll", scroll, { passive: true });
  document.addEventListener("focusin", sync);
  document.addEventListener("focusout", request);
  document.addEventListener("click", request);
  document.addEventListener("keydown", request);
  signal.addEventListener("abort", dispose, { once: true });
  sync();
  node.dataset.swordsReady = "true";
  return { setVisible(value) { visible = value; sync(); }, dispose };
}
