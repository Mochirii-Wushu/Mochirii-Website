"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export type GalleryFocalPoint = {
  x: number;
  y: number;
};

type ResponsiveGalleryMediaProps = {
  src: string;
  alt: string;
  loading?: "eager" | "lazy";
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  fullSource?: string;
  caption?: string;
  focalPoint?: GalleryFocalPoint;
  refreshSource?: (signal: AbortSignal) => Promise<string>;
  onSourceRefresh?: (src: string) => void;
};

function boundedPercent(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, value));
}

export function ResponsiveGalleryMedia({
  src,
  alt,
  loading = "lazy",
  intrinsicWidth = 16,
  intrinsicHeight = 10,
  fullSource,
  caption,
  focalPoint,
  refreshSource,
  onSourceRefresh,
}: ResponsiveGalleryMediaProps) {
  const imageWidth = Number.isSafeInteger(intrinsicWidth) && intrinsicWidth > 0
    ? intrinsicWidth
    : 16;
  const imageHeight = Number.isSafeInteger(intrinsicHeight) && intrinsicHeight > 0
    ? intrinsicHeight
    : 10;
  const [imageState, setImageState] = useState<{
    attempt: number;
    propSrc: string;
    currentSrc: string;
    status: "loading" | "ready" | "error";
  }>({ attempt: 0, propSrc: src, currentSrc: src, status: "loading" });
  const refreshAttemptRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const refreshGenerationRef = useRef(0);
  const current = imageState.propSrc === src
    ? imageState
    : { attempt: 0, propSrc: src, currentSrc: src, status: "loading" as const };

  useEffect(() => {
    refreshAttemptRef.current = 0;
    refreshGenerationRef.current += 1;
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = null;
    return () => {
      refreshGenerationRef.current += 1;
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
    };
  }, [src]);

  const reconcileCompleteImage = useCallback((image: HTMLImageElement | null) => {
    if (!image?.complete) return;
    const nextStatus = image.naturalWidth > 0 ? "ready" : "error";
    setImageState((state) =>
      state.propSrc === src && state.currentSrc === image.currentSrc && state.status === nextStatus
        ? state
        : {
          attempt: state.propSrc === src ? state.attempt : 0,
          propSrc: src,
          currentSrc: image.getAttribute("src") || src,
          status: nextStatus,
        },
    );
  }, [src]);

  const markReady = (image: HTMLImageElement) => {
    setImageState((state) => ({
      attempt: state.propSrc === src ? state.attempt : 0,
      propSrc: src,
      currentSrc: image.getAttribute("src") || src,
      status: "ready",
    }));
  };

  const markError = async (image: HTMLImageElement) => {
    const failedSrc = image.getAttribute("src") || src;
    if (!refreshSource || refreshAttemptRef.current >= 1) {
      setImageState((state) => ({
        attempt: state.propSrc === src ? state.attempt : 0,
        propSrc: src,
        currentSrc: failedSrc,
        status: "error",
      }));
      return;
    }

    refreshAttemptRef.current += 1;
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    const generation = refreshGenerationRef.current + 1;
    refreshControllerRef.current = controller;
    refreshGenerationRef.current = generation;
    setImageState((state) => ({ ...state, propSrc: src, status: "loading" }));

    try {
      const refreshedSrc = await refreshSource(controller.signal);
      if (controller.signal.aborted || generation !== refreshGenerationRef.current) return;
      onSourceRefresh?.(refreshedSrc);
      setImageState((state) => ({
        attempt: (state.propSrc === src ? state.attempt : 0) + 1,
        propSrc: src,
        currentSrc: refreshedSrc,
        status: "loading",
      }));
    } catch (error) {
      if (controller.signal.aborted || generation !== refreshGenerationRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setImageState((state) => ({ ...state, propSrc: src, status: "error" }));
    }
  };

  const focalPosition = focalPoint
    ? `${boundedPercent(focalPoint.x)}% ${boundedPercent(focalPoint.y)}%`
    : undefined;
  const style: CSSProperties | undefined = focalPosition
    ? { objectPosition: focalPosition }
    : undefined;

  return (
    <span className="responsive-gallery-media" data-image-state={current.status} aria-busy={current.status === "loading"}>
      <img
        key={`${current.currentSrc}:${current.attempt}`}
        ref={reconcileCompleteImage}
        className="responsive-gallery-media__image"
        src={current.currentSrc}
        alt={alt}
        width={imageWidth}
        height={imageHeight}
        loading={loading}
        decoding="async"
        data-full={fullSource}
        data-caption={caption}
        style={style}
        onLoad={(event) => markReady(event.currentTarget)}
        onError={(event) => void markError(event.currentTarget)}
      />
      <span className="responsive-gallery-media__fallback" aria-hidden="true">
        Image unavailable
      </span>
    </span>
  );
}
