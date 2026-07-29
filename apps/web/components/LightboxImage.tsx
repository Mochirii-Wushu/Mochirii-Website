"use client";

import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type ImageState = "loading" | "ready" | "error";
type ResolveImageSource = (signal: AbortSignal) => Promise<string | Blob>;

export function LightboxImage({
  id,
  src,
  previewSrc,
  alt,
  resolveSrc,
}: {
  id: string;
  src?: string;
  previewSrc: string;
  alt: string;
  resolveSrc?: ResolveImageSource;
}) {
  const [imageState, setImageState] = useState<ImageState>("loading");
  const [resolvedSrc, setResolvedSrc] = useState(src || "");
  const [requestAttempt, setRequestAttempt] = useState(0);
  const requestGenerationRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const activeImageRef = useRef<HTMLImageElement | null>(null);
  const refreshCountRef = useRef(0);

  const revokeObjectUrl = useCallback(() => {
    if (!objectUrlRef.current) return;
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }, []);

  const resolveImage = useCallback(async () => {
    if (!resolveSrc) {
      revokeObjectUrl();
      setResolvedSrc(src || "");
      setRequestAttempt(0);
      setImageState(src ? "loading" : "error");
      return;
    }

    requestControllerRef.current?.abort();
    activeImageRef.current = null;
    revokeObjectUrl();
    const controller = new AbortController();
    const generation = requestGenerationRef.current + 1;
    requestControllerRef.current = controller;
    requestGenerationRef.current = generation;
    setImageState("loading");

    try {
      const resolved = await resolveSrc(controller.signal);
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      const nextSrc = resolved instanceof Blob ? URL.createObjectURL(resolved) : resolved;
      if (controller.signal.aborted || generation !== requestGenerationRef.current) {
        if (resolved instanceof Blob) URL.revokeObjectURL(nextSrc);
        return;
      }
      objectUrlRef.current = resolved instanceof Blob ? nextSrc : null;
      setResolvedSrc(nextSrc);
      setRequestAttempt((attempt) => attempt + 1);
    } catch (error) {
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setResolvedSrc("");
      setImageState("error");
    }
  }, [resolveSrc, revokeObjectUrl, src]);

  useEffect(() => {
    refreshCountRef.current = 0;
    const requestTimer = resolveSrc
      ? window.setTimeout(() => void resolveImage(), 0)
      : null;

    return () => {
      if (requestTimer !== null) window.clearTimeout(requestTimer);
      requestGenerationRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      activeImageRef.current = null;
      revokeObjectUrl();
    };
  }, [resolveImage, resolveSrc, revokeObjectUrl, src]);

  const finishDecode = async (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const generation = requestGenerationRef.current;
    activeImageRef.current = image;

    if (typeof image.decode === "function") {
      try {
        await image.decode();
      } catch {
        if (
          requestGenerationRef.current === generation &&
          activeImageRef.current === image && image.isConnected
        ) setImageState("error");
        return;
      }
    }

    if (requestGenerationRef.current !== generation || activeImageRef.current !== image) return;
    setImageState(image.complete && image.naturalWidth > 0 ? "ready" : "error");
  };

  const markError = (event: SyntheticEvent<HTMLImageElement>) => {
    if (activeImageRef.current !== event.currentTarget) return;
    requestGenerationRef.current += 1;
    if (resolveSrc && refreshCountRef.current < 1) {
      refreshCountRef.current += 1;
      void resolveImage();
      return;
    }
    setImageState("error");
  };

  const statusMessage = imageState === "loading"
    ? "Loading full image…"
    : imageState === "error"
      ? "The full image could not be loaded."
      : "";

  return (
    <div
      className="lightbox-media"
      data-image-state={imageState}
      aria-busy={imageState === "loading"}
    >
      <img
        src={previewSrc}
        alt=""
        className="lightbox-img lightbox-img--preview"
        aria-hidden="true"
        loading="eager"
        decoding="async"
      />
      {resolvedSrc ? (
        <img
          key={`${resolvedSrc}:${requestAttempt}`}
          ref={(image) => {
            activeImageRef.current = image;
          }}
          id={id}
          src={resolvedSrc}
          alt={alt}
          className="lightbox-img lightbox-img--full"
          decoding="async"
          fetchPriority="high"
          onLoad={finishDecode}
          onError={markError}
        />
      ) : null}
      <span className="lightbox-image-status" role="status" aria-live="polite">
        {statusMessage}
      </span>
    </div>
  );
}
