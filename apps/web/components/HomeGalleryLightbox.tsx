"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ResponsiveGalleryMedia } from "@/components/ResponsiveGalleryMedia";
import {
  useBodyPortalRoot,
  useBodyScrollLock,
} from "@/components/useLightboxOverlay";

const LazyHomeGalleryLightboxModal = lazy(() =>
  import("@/components/HomeGalleryLightboxModal").then(
    ({ HomeGalleryLightboxModal }) => ({ default: HomeGalleryLightboxModal }),
  ),
);

export type GallerySpotlightItem = {
  key: string;
  image: string;
  full: string;
  alt: string;
  caption: string;
};

function HomeGalleryLightboxFallback({
  item,
  portalRoot,
  onClose,
}: {
  item: GallerySpotlightItem;
  portalRoot: HTMLElement;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const focusTimer = window.setTimeout(
      () => closeRef.current?.focus({ preventScroll: true }),
      0,
    );
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      id="modalRoot"
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Gallery image viewer"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        event.preventDefault();
        closeRef.current?.focus({ preventScroll: true });
      }}
    >
      <div
        id="modalBackdrop"
        className="lightbox-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <div className="lightbox-shell" role="document">
        <button
          id="modalClose"
          ref={closeRef}
          className="lightbox-close"
          type="button"
          aria-label="Close viewer"
          onClick={onClose}
        >
          {"\u2715"}
        </button>
        <figure className="lightbox-card">
          <div className="lightbox-media" data-image-state="loading" aria-busy="true">
            <img
              src={item.image}
              alt={item.alt}
              className="lightbox-img lightbox-img--preview"
              decoding="async"
            />
            <span className="lightbox-image-status" role="status" aria-live="polite">
              Loading full image…
            </span>
          </div>
          <figcaption className="lightbox-caption">
            {item.caption || item.alt}
          </figcaption>
        </figure>
      </div>
    </div>,
    portalRoot,
  );
}

export function HomeGalleryLightbox({
  items,
}: {
  items: GallerySpotlightItem[];
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const portalRoot = useBodyPortalRoot();
  const openItem = openIndex === null ? null : items[openIndex] || null;

  useBodyScrollLock(openItem !== null && portalRoot !== null);

  const closeModal = useCallback(() => {
    setOpenIndex(null);
    window.setTimeout(() => {
      lastFocusRef.current?.focus({ preventScroll: true });
      lastFocusRef.current = null;
    }, 0);
  }, []);

  const openModal = (index: number, trigger: HTMLElement) => {
    lastFocusRef.current = trigger;
    setOpenIndex(index);
  };

  return (
    <>
      <div id="galleryGrid" className="home-gallery" aria-label="Gallery thumbnails">
        {items.map((item, index) => (
          <button
            className="home-thumb responsive-gallery-frame"
            type="button"
            aria-label={`Open image: ${item.caption || item.alt || "Guild screenshot"}`}
            key={item.key}
            onClick={(event) => openModal(index, event.currentTarget)}
          >
            <ResponsiveGalleryMedia
              src={item.image}
              alt={item.alt}
              fullSource={item.full}
              caption={item.caption}
            />
            <span className="home-thumb__scrim" aria-hidden="true" />
          </button>
        ))}
      </div>

      {openItem && portalRoot ? (
        <Suspense
          fallback={(
            <HomeGalleryLightboxFallback
              item={openItem}
              portalRoot={portalRoot}
              onClose={closeModal}
            />
          )}
        >
          <LazyHomeGalleryLightboxModal
            key={openItem.key}
            item={openItem}
            portalRoot={portalRoot}
            onClose={closeModal}
          />
        </Suspense>
      ) : null}
    </>
  );
}
