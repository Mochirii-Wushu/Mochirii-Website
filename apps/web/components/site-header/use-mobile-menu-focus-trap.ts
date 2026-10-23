"use client";

import { useCallback, useEffect, useRef, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";

type ElementRef<T extends HTMLElement> = {
  current: T | null;
};

type CloseMobileOptions = {
  returnFocus?: boolean;
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(root: HTMLElement | null) {
  if (!root) return [];

  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter((el) => {
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    if (el.closest("[hidden]")) return false;
    return el.getClientRects().length > 0;
  });
}

export function useMobileMenuFocusTrap({
  mobileOpen,
  setMobileOpen,
  menuButtonRef,
  mobileShellRef,
  closeButtonRef,
}: {
  mobileOpen: boolean;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
  menuButtonRef: ElementRef<HTMLButtonElement>;
  mobileShellRef: ElementRef<HTMLDivElement>;
  closeButtonRef: ElementRef<HTMLButtonElement>;
}) {
  const lastFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mobileOpen) return undefined;

    lastFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeButtonRef.current?.focus({ preventScroll: true }), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [closeButtonRef, mobileOpen]);

  const closeMobile = useCallback(({ returnFocus = false }: CloseMobileOptions = {}) => {
    setMobileOpen(false);
    if (returnFocus) {
      window.setTimeout(() => {
        const focusTarget = menuButtonRef.current || lastFocusRef.current;
        focusTarget?.focus({ preventScroll: true });
        lastFocusRef.current = null;
      }, 0);
    }
  }, [menuButtonRef, setMobileOpen]);

  const trapMobileTab = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      closeMobile({ returnFocus: true });
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = getFocusable(mobileShellRef.current);
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
  }, [closeMobile, mobileShellRef]);

  return { closeMobile, trapMobileTab };
}
