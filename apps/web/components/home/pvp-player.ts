const controllers = new WeakMap<HTMLElement, AbortController>();

export function playPvpClip(root: HTMLElement, link: HTMLAnchorElement) {
  let controller = controllers.get(root);
  if (!controller) {
    controller = new AbortController();
    controllers.set(root, controller);
    const pause = () => root.querySelectorAll("video").forEach(video => video.pause());
    const hidden = () => { if (document.hidden) pause(); };
    const dispose = () => {
      pause();
      controller?.abort(); controllers.delete(root);
      root.querySelectorAll("video").forEach(video => { video.removeAttribute("src"); video.querySelectorAll("track").forEach(track => track.removeAttribute("src")); video.load(); });
    };
    root.addEventListener("pvpdispose", dispose, { once: true, signal: controller.signal });
    window.addEventListener("pagehide", pause, { signal: controller.signal });
    document.addEventListener("visibilitychange", hidden, { signal: controller.signal });
  }
  const card = link.closest("figure"), video = card?.querySelector("video"), status = card?.querySelector<HTMLElement>("[data-pvp-status]");
  if (!video || !status) return;
  root.querySelectorAll("video").forEach(other => { if (other !== video) other.pause(); });
  if (!video.hasAttribute("src")) {
    video.poster = link.querySelector("img")?.src || "";
    video.src = link.href;
    video.querySelectorAll<HTMLTrackElement>("track[data-pvp-caption]").forEach(track => { track.src = track.dataset.pvpCaption || ""; track.default = true; });
    video.addEventListener("play", () => root.querySelectorAll("video").forEach(other => { if (other !== video) other.pause(); }), { signal: controller.signal });
    video.addEventListener("error", () => {
      status.textContent = "This clip could not be loaded. You can try opening it directly.";
      video.hidden = true; link.hidden = false; link.removeAttribute("data-pvp-play");
      link.focus({ preventScroll: true });
    }, { signal: controller.signal });
  }
  video.hidden = false; link.hidden = true;
  video.focus({ preventScroll: true });
  status.textContent = "";
  void video.play().catch(() => { if (!video.error) status.textContent = "Use the player controls to start this clip."; });
}
