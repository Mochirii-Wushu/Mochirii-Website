"use client";

import {
  type KeyboardEvent,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { LightboxImage } from "@/components/LightboxImage";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(root: HTMLElement | null) {
  if (!root) return [];

  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    if (element.hidden || element.closest("[hidden]")) return false;
    return element.getClientRects().length > 0;
  });
}

export type UniversalImageLightboxItem = {
  key: string;
  previewSrc: string;
  fullSrc?: string;
  alt: string;
  caption: string;
  resolveFullSrc?: (signal: AbortSignal) => Promise<string>;
};

export type UniversalImageLightboxIds = {
  root: string;
  backdrop: string;
  close: string;
  image: string;
  caption: string;
};

export function UniversalImageLightbox({
  item,
  ids,
  dialogLabel,
  appearance,
  portalRoot,
  onClose,
}: {
  item: UniversalImageLightboxItem;
  ids: UniversalImageLightboxIds;
  dialogLabel: string;
  appearance?: "gallery";
  portalRoot: HTMLElement;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const backgroundStates = Array.from(portalRoot.children)
      .filter((element): element is HTMLElement =>
        element instanceof HTMLElement && element !== dialog
      )
      .map((element) => ({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
      }));

    for (const state of backgroundStates) {
      state.element.inert = true;
      state.element.setAttribute("aria-hidden", "true");
    }

    const focusTimer = window.setTimeout(
      () => closeRef.current?.focus({ preventScroll: true }),
      0,
    );
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
      for (const state of backgroundStates) {
        state.element.inert = state.inert;
        if (state.ariaHidden === null) {
          state.element.removeAttribute("aria-hidden");
        } else {
          state.element.setAttribute("aria-hidden", state.ariaHidden);
        }
      }
    };
  }, [onClose, portalRoot]);

  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;

    const focusable = getFocusable(dialogRef.current);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  return createPortal(
    <div
      id={ids.root}
      ref={dialogRef}
      className={appearance ? `lightbox lightbox--${appearance}` : "lightbox"}
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
      aria-describedby={ids.caption}
      tabIndex={-1}
      onKeyDown={trapTab}
    >
      <div
        id={ids.backdrop}
        className="lightbox-backdrop"
        data-close
        aria-hidden="true"
        onClick={onClose}
      />

      <div className="lightbox-shell" role="document">
        <button
          id={ids.close}
          ref={closeRef}
          className="lightbox-close"
          type="button"
          data-close
          aria-label="Close viewer"
          onClick={onClose}
        >
          {"\u2715"}
        </button>

        <figure className="lightbox-card" tabIndex={0}>
          <LightboxImage
            key={item.key}
            id={ids.image}
            src={item.fullSrc}
            previewSrc={item.previewSrc}
            alt={item.alt}
            resolveSrc={item.resolveFullSrc}
          />
          <figcaption id={ids.caption} className="lightbox-caption">
            {item.caption || item.alt}
          </figcaption>
        </figure>
      </div>
    </div>,
    portalRoot,
  );
}
