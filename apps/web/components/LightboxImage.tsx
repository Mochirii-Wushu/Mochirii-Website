"use client";

import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type ImageState = "loading" | "ready" | "error";
type ResolveImageSource = (signal: AbortSignal) => Promise<string>;

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
  const refreshCountRef = useRef(0);

  const resolveImage = useCallback(async () => {
    if (!resolveSrc) {
      setResolvedSrc(src || "");
      setRequestAttempt(0);
      setImageState(src ? "loading" : "error");
      return;
    }

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    const generation = requestGenerationRef.current + 1;
    requestControllerRef.current = controller;
    requestGenerationRef.current = generation;
    setImageState("loading");

    try {
      const nextSrc = await resolveSrc(controller.signal);
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      setResolvedSrc(nextSrc);
      setRequestAttempt((attempt) => attempt + 1);
    } catch (error) {
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setResolvedSrc("");
      setImageState("error");
    }
  }, [resolveSrc, src]);

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
    };
  }, [resolveImage, resolveSrc, src]);

  const finishDecode = async (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;

    if (typeof image.decode === "function") {
      try {
        await image.decode();
      } catch {
        // A loaded image can reject decode() after it leaves the document.
      }
    }

    if (requestGenerationRef.current !== generation) return;
    setImageState(image.complete && image.naturalWidth > 0 ? "ready" : "error");
  };

  const markError = () => {
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
