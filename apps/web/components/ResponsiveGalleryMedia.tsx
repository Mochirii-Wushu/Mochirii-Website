"use client";

import type { CSSProperties } from "react";
import { useCallback, useState } from "react";

export type GalleryFocalPoint = {
  x: number;
  y: number;
};

type ResponsiveGalleryMediaProps = {
  src: string;
  alt: string;
  loading?: "eager" | "lazy";
  fullSource?: string;
  caption?: string;
  focalPoint?: GalleryFocalPoint;
};

function boundedPercent(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, value));
}

export function ResponsiveGalleryMedia({
  src,
  alt,
  loading = "lazy",
  fullSource,
  caption,
  focalPoint,
}: ResponsiveGalleryMediaProps) {
  const [imageState, setImageState] = useState<{ src: string; status: "loading" | "ready" | "error" }>({
    src,
    status: "loading",
  });
  const status = imageState.src === src ? imageState.status : "loading";
  const reconcileCompleteImage = useCallback((image: HTMLImageElement | null) => {
    if (!image?.complete) return;
    const nextStatus = image.naturalWidth > 0 ? "ready" : "error";
    setImageState((current) =>
      current.src === src && current.status === nextStatus
        ? current
        : { src, status: nextStatus },
    );
  }, [src]);
  const focalPosition = focalPoint
    ? `${boundedPercent(focalPoint.x)}% ${boundedPercent(focalPoint.y)}%`
    : undefined;
  const style: CSSProperties | undefined = focalPosition
    ? { objectPosition: focalPosition }
    : undefined;

  return (
    <span className="responsive-gallery-media" data-image-state={status} aria-busy={status === "loading"}>
      <img
        ref={reconcileCompleteImage}
        className="responsive-gallery-media__image"
        src={src}
        alt={alt}
        width={16}
        height={10}
        loading={loading}
        decoding="async"
        data-full={fullSource}
        data-caption={caption}
        style={style}
        onLoad={() => setImageState({ src, status: "ready" })}
        onError={() => setImageState({ src, status: "error" })}
      />
      <span className="responsive-gallery-media__fallback" aria-hidden="true">
        Image unavailable
      </span>
    </span>
  );
}
