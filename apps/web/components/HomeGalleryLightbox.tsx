"use client";

import {
  useCallback,
  useRef,
  useState,
} from "react";
import { ResponsiveGalleryMedia } from "@/components/ResponsiveGalleryMedia";
import { UniversalImageLightbox } from "@/components/UniversalImageLightbox";
import {
  useBodyPortalRoot,
  useBodyScrollLock,
} from "@/components/useLightboxOverlay";

export type GallerySpotlightItem = {
  key: string;
  image: string;
  full: string;
  alt: string;
  caption: string;
};

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
        <UniversalImageLightbox
          item={{
            key: openItem.key,
            previewSrc: openItem.image,
            fullSrc: openItem.full,
            alt: openItem.alt,
            caption: openItem.caption,
          }}
          ids={{
            root: "modalRoot",
            backdrop: "modalBackdrop",
            close: "modalClose",
            image: "modalImage",
            caption: "modalCaption",
          }}
          dialogLabel="Gallery image viewer"
          portalRoot={portalRoot}
          onClose={closeModal}
        />
      ) : null}
    </>
  );
}
