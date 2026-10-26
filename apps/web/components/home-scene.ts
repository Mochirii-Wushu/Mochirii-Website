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
  const main = node.closest<HTMLElement>("main");
  const shell = node.closest<HTMLElement>(".site-shell");
  const event = main?.querySelector<HTMLElement>(".home-sword-duel");
  const nativeTimeline = CSS.supports("animation-timeline: view()");
  let focused = !!section?.contains(document.activeElement) && !document.activeElement?.closest(".motion-toggle");
  let visible = false, ready = false, disposed = false, scrollFrame = 0;
  let resolveMount: (controller: HomeSceneController | null) => void;
  const mounted = new Promise<HomeSceneController | null>(resolve => { resolveMount = resolve; });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(scrollFrame);
    window.removeEventListener("resize", resize);
    window.removeEventListener("scroll", requestScroll);
    shell?.removeEventListener("motionvisibility", requestScroll);
    section?.removeEventListener("focusin", focusIn);
    section?.removeEventListener("focusout", focusOut);
    worker.removeEventListener("message", message);
    worker.removeEventListener("error", failed);
    worker.removeEventListener("messageerror", failed);
    signal.removeEventListener("abort", dispose);
    node.removeAttribute("data-scene-ready");
    node.removeAttribute("data-scene-active");
    for (const property of ["--home-scene-progress", "--home-scene-emphasis", "--home-sword-approach", "--home-sword-contact"]) main?.style.removeProperty(property);
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
    resolveMount({ setVisible(value) { visible = value; run(); requestScroll(); }, dispose });
  }
  function scroll() {
    scrollFrame = 0;
    if (disposed || nativeTimeline || !main || !event || event.dataset.sceneVisible !== "true") return;
    const box = event.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (innerHeight - box.top) / (innerHeight + box.height)));
    main.style.setProperty("--home-scene-progress", progress.toFixed(4));
    main.style.setProperty("--home-scene-emphasis", Math.sin(progress * Math.PI).toFixed(4));
    main.style.setProperty("--home-sword-approach", (progress < .5 ? progress * 2 : 1 - (progress - .5) * 1.74).toFixed(4));
    main.style.setProperty("--home-sword-contact", (Math.max(0, 1 - Math.abs(progress - .5) / .04) * .65).toFixed(4));
  }
  function requestScroll() { if (!disposed && !nativeTimeline && !scrollFrame) scrollFrame = requestAnimationFrame(scroll); }
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
    requestScroll();
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
  if (!nativeTimeline) {
    window.addEventListener("scroll", requestScroll, { passive: true });
    shell?.addEventListener("motionvisibility", requestScroll);
  }
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
