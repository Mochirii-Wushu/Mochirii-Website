"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { LightboxImage } from "@/components/LightboxImage";
import { ResponsiveGalleryMedia } from "@/components/ResponsiveGalleryMedia";
import { useBodyPortalRoot, useBodyScrollLock } from "@/components/useLightboxOverlay";
import {
  listApprovedGallerySubmissions,
  type ApprovedGallerySubmission,
} from "@/lib/gallery/approved-feed";

type Category = {
  slug?: string;
  label?: string;
};

type GalleryItem = {
  id?: string;
  src?: string;
  full?: string;
  thumb?: string;
  alt?: string;
  caption?: string;
  category?: string;
  categories?: string[];
  galleryAddedAt?: string;
};

type SortMode = "random" | "newest" | "oldest";
type ApprovedFeedState = "loading" | "ready" | "error";
type NormalizedGalleryItem = Omit<GalleryItem, "alt" | "caption" | "categories" | "full" | "thumb"> & {
  alt: string;
  caption: string;
  categories: string[];
  full: string;
  originalIndex: number;
  sortTimestamp: number;
  stableKey: string;
  stableSequence: number;
  thumb: string;
};

const allCategory = "all";
const defaultSort: SortMode = "random";
const memberSubmissionsCategory = "member-submissions";
const galleryRenderBatchSize = 24;
const sortModes = new Set<SortMode>([defaultSort, "newest", "oldest"]);
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function text(value: unknown, fallback = "") {
  const clean = String(value ?? "").trim();
  return clean || fallback;
}

function publicPath(value: unknown, fallback = "") {
  const raw = text(value, fallback);
  if (!raw) return "";
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(raw)) return raw;
  if (raw.startsWith("./")) return `/${raw.slice(2)}`;
  return `/${raw}`;
}

function normalizeSlug(value: unknown) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toTitle(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function itemCategories(item: GalleryItem) {
  const values = Array.isArray(item.categories) && item.categories.length ? item.categories : [item.category];
  return [...new Set(values.map(normalizeSlug).filter(Boolean))];
}

function normalizeSort(value: unknown): SortMode {
  const sort = text(value).toLowerCase();
  return sortModes.has(sort as SortMode) ? (sort as SortMode) : defaultSort;
}

function getSortTimestamp(item: GalleryItem) {
  const time = Date.parse(text(item.galleryAddedAt));
  return Number.isFinite(time) ? time : 0;
}

function extractNumericSequence(value: unknown) {
  const clean = text(value);
  if (!clean) return null;

  const named = clean.match(/(?:^|[\\/_-])(?:shot|image|img)[-_]?(\d+)(?=$|[.\\/_-])/i);
  if (named) return Number.parseInt(named[1], 10);

  const matches = [...clean.matchAll(/(\d+)/g)];
  const fallback = matches.at(-1)?.[1];
  return fallback ? Number.parseInt(fallback, 10) : null;
}

function getStableSequence(item: GalleryItem, originalIndex: number) {
  const candidates = [item.id, item.full, item.src, item.thumb];

  for (const candidate of candidates) {
    const sequence = extractNumericSequence(candidate);
    if (sequence !== null && Number.isFinite(sequence)) return sequence;
  }

  return originalIndex + 1;
}

function compareGalleryItems(a: NormalizedGalleryItem, b: NormalizedGalleryItem, sort: Exclude<SortMode, "random">) {
  const direction = sort === "newest" ? -1 : 1;
  const timeDelta = a.sortTimestamp - b.sortTimestamp;
  if (timeDelta !== 0) return direction * timeDelta;

  const sequenceDelta = a.stableSequence - b.stableSequence;
  if (sequenceDelta !== 0) return direction * sequenceDelta;

  const indexDelta = a.originalIndex - b.originalIndex;
  if (indexDelta !== 0) return direction * indexDelta;

  return a.stableKey.localeCompare(b.stableKey);
}

function stableMixSeed(items: Array<{ stableKey: string }>) {
  let hash = 0x811c9dc5;
  for (const item of items) {
    for (const character of item.stableKey) {
      hash ^= character.codePointAt(0) || 0;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0 || 1;
}

function stableMixRank(stableKey: string, seed: number) {
  let hash = seed >>> 0;
  for (const character of stableKey) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stableMixOrder(items: NormalizedGalleryItem[], seed: number) {
  return [...items].sort((a, b) => {
    const rankDelta = stableMixRank(a.stableKey, seed) - stableMixRank(b.stableKey, seed);
    return rankDelta || a.stableKey.localeCompare(b.stableKey);
  });
}

function getFocusable(root: HTMLElement | null) {
  if (!root) return [];

  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter((el) => {
    if (el.hidden || el.closest("[hidden]")) return false;
    return el.getClientRects().length > 0;
  });
}

function fallbackCopyText(value: string) {
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.top = "-999px";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();

  try {
    return document.execCommand("copy");
  } finally {
    field.remove();
  }
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  return fallbackCopyText(value);
}

function approvedSubmissionCaption(submission: ApprovedGallerySubmission) {
  const title = text(submission.title);
  const caption = text(submission.caption);
  const uploader = text(submission.uploader_display_name || submission.uploader_discord_name);

  return [title, caption, uploader ? `Shared by ${uploader}` : ""].filter(Boolean).join(" - ");
}

function approvedSubmissionToGalleryItem(submission: ApprovedGallerySubmission): GalleryItem | null {
  const fullSignedUrl = text(submission.full_signed_url);
  const thumbnailSignedUrl = text(submission.thumbnail_signed_url);
  const thumbnailSizeBytes = Number(submission.thumbnail_size_bytes || 0);
  if (
    !fullSignedUrl ||
    !thumbnailSignedUrl ||
    fullSignedUrl === thumbnailSignedUrl ||
    thumbnailSizeBytes < 1 ||
    thumbnailSizeBytes > 80 * 1024 ||
    submission.preview_error
  ) return null;

  const title = text(submission.title, "Member gallery submission");

  return {
    id: `approved-${text(submission.id, fullSignedUrl)}`,
    src: thumbnailSignedUrl,
    full: fullSignedUrl,
    thumb: thumbnailSignedUrl,
    alt: title,
    caption: approvedSubmissionCaption(submission) || title,
    category: memberSubmissionsCategory,
    categories: [memberSubmissionsCategory],
    galleryAddedAt: text(submission.created_at || submission.reviewed_at),
  };
}

export function GalleryBrowser({
  categories,
  items,
}: {
  categories: Category[];
  items: GalleryItem[];
}) {
  const [activeCategory, setActiveCategory] = useState(allCategory);
  const [activeSort, setActiveSort] = useState<SortMode>(defaultSort);
  const [approvedItems, setApprovedItems] = useState<GalleryItem[]>([]);
  const [approvedFeedState, setApprovedFeedState] = useState<ApprovedFeedState>("loading");
  const [approvedFeedAttempt, setApprovedFeedAttempt] = useState(0);
  const [renderWindow, setRenderWindow] = useState({ key: "", limit: galleryRenderBatchSize });
  const [shareStatus, setShareStatus] = useState("");
  const [openItemKey, setOpenItemKey] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const portalRoot = useBodyPortalRoot();
  const galleryItems = useMemo(() => [...items, ...approvedItems], [approvedItems, items]);

  const usableItems = useMemo(
    () =>
      galleryItems
        .map((item, originalIndex): NormalizedGalleryItem => {
          const full = publicPath(item.full || item.src);
          const thumb = publicPath(item.thumb || item.src || item.full);

          return {
            ...item,
            full,
            thumb,
            alt: text(item.alt || item.caption, "Gallery image"),
            caption: text(item.caption),
            categories: itemCategories(item),
            originalIndex,
            sortTimestamp: getSortTimestamp(item),
            stableKey: text(item.id || full || thumb, `gallery-${originalIndex}`),
            stableSequence: getStableSequence({ ...item, full, thumb }, originalIndex),
          };
        })
        .filter((item) => item.full && item.thumb),
    [galleryItems],
  );

  useEffect(() => {
    let canceled = false;
    const controller = new AbortController();

    listApprovedGallerySubmissions(controller.signal)
      .then((result) => {
        if (canceled) return;
        if (!result.ok || !Array.isArray(result.data?.submissions)) {
          setApprovedItems([]);
          setApprovedFeedState("error");
          return;
        }

        const submissions = result.data.submissions;
        setApprovedItems(submissions.map(approvedSubmissionToGalleryItem).filter((item): item is GalleryItem => Boolean(item)));
        setApprovedFeedState("ready");
      })
      .catch(() => {
        if (canceled) return;
        setApprovedItems([]);
        setApprovedFeedState("error");
      });

    return () => {
      canceled = true;
      controller.abort();
    };
  }, [approvedFeedAttempt]);

  const retryApprovedFeed = useCallback(() => {
    setApprovedFeedState("loading");
    setApprovedFeedAttempt((attempt) => attempt + 1);
  }, []);

  const filterCategories = useMemo(() => {
    const counts = new Map([[allCategory, usableItems.length]]);
    usableItems.forEach((item) => {
      itemCategories(item).forEach((slug) => counts.set(slug, (counts.get(slug) || 0) + 1));
    });

    const declared = categories
      .map((category) => {
        const slug = normalizeSlug(category.slug);
        if (!slug || !counts.has(slug)) return null;
        return { slug, label: text(category.label, toTitle(slug)), count: counts.get(slug) || 0 };
      })
      .filter((item): item is { slug: string; label: string; count: number } => Boolean(item));

    const seen = new Set(declared.map((category) => category.slug));
    const inferred = [...counts.keys()]
      .filter((slug) => slug !== allCategory && !seen.has(slug))
      .sort()
      .map((slug) => ({ slug, label: toTitle(slug), count: counts.get(slug) || 0 }));

    return [{ slug: allCategory, label: "All", count: counts.get(allCategory) || 0 }, ...declared, ...inferred];
  }, [categories, usableItems]);

  const randomSeed = useMemo(
    () =>
      stableMixSeed(
        items.map((item, index) => ({
          stableKey: text(item.id || item.full || item.src || item.thumb, `gallery-${index}`),
        })),
      ),
    [items],
  );

  const visibleItems = useMemo(() => {
    if (activeSort === defaultSort) {
      const randomized = [
        ...stableMixOrder(
          usableItems.filter((item) => item.originalIndex < items.length),
          randomSeed,
        ),
        ...stableMixOrder(
          usableItems.filter((item) => item.originalIndex >= items.length),
          randomSeed,
        ),
      ];
      return activeCategory === allCategory
        ? randomized
        : randomized.filter((item) => item.categories.includes(activeCategory));
    }

    const filtered =
      activeCategory === allCategory
        ? usableItems
        : usableItems.filter((item) => item.categories.includes(activeCategory));

    const sortMode = activeSort === "oldest" ? "oldest" : "newest";
    return [...filtered].sort((a, b) => compareGalleryItems(a, b, sortMode));
  }, [activeCategory, activeSort, items.length, randomSeed, usableItems]);

  const renderWindowKey = `${activeCategory}:${activeSort}:${randomSeed}:${usableItems.length}`;
  const effectiveRenderLimit = renderWindow.key === renderWindowKey ? renderWindow.limit : galleryRenderBatchSize;
  const renderedItems = useMemo(() => visibleItems.slice(0, effectiveRenderLimit), [effectiveRenderLimit, visibleItems]);
  const hasMoreItems = renderedItems.length < visibleItems.length;
  const openItem = openItemKey === null ? null : visibleItems.find((item) => item.stableKey === openItemKey) || null;
  const activeLabel = filterCategories.find((category) => category.slug === activeCategory)?.label || "All";
  const countText =
    activeLabel === "All"
      ? `Showing ${renderedItems.length} of ${usableItems.length} ${usableItems.length === 1 ? "image" : "images"}${approvedFeedState === "ready" ? "" : " currently available"}.`
      : `Showing ${renderedItems.length} of ${visibleItems.length} ${visibleItems.length === 1 ? "image" : "images"}${approvedFeedState === "ready" ? "" : " currently available"} in ${activeLabel}.`;

  const closeModal = useCallback(() => {
    setOpenItemKey(null);
    window.setTimeout(() => {
      lastFocusRef.current?.focus({ preventScroll: true });
      lastFocusRef.current = null;
    }, 0);
  }, []);

  useBodyScrollLock(Boolean(openItem));

  useEffect(() => {
    const readState = () => {
      const params = new URLSearchParams(window.location.search);
      const category = normalizeSlug(params.get("category"));
      const sort = normalizeSort(params.get("sort"));
      const validCategory = filterCategories.some((item) => item.slug === category);

      setActiveCategory(category && validCategory ? category : allCategory);
      setActiveSort(sort);
    };

    readState();
    window.addEventListener("popstate", readState);
    return () => window.removeEventListener("popstate", readState);
  }, [filterCategories]);

  useEffect(() => {
    if (!openItem) return undefined;

    window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeModal, openItem]);

  const updateUrl = (category: string, sort: string) => {
    const url = new URL(window.location.href);
    if (category === allCategory) url.searchParams.delete("category");
    else url.searchParams.set("category", category);

    if (sort === defaultSort) url.searchParams.delete("sort");
    else url.searchParams.set("sort", sort);

    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.pushState({ galleryCategory: category }, "", next);
  };

  const chooseCategory = (category: string) => {
    setActiveCategory(category);
    setShareStatus("");
    updateUrl(category, activeSort);
  };

  const chooseSort = (sort: string) => {
    const nextSort = normalizeSort(sort);
    setActiveSort(nextSort);
    setShareStatus("");
    updateUrl(activeCategory, nextSort);
  };

  const showMoreImages = () => {
    setRenderWindow({
      key: renderWindowKey,
      limit: Math.min(effectiveRenderLimit + galleryRenderBatchSize, visibleItems.length),
    });
  };

  const openModal = (item: NormalizedGalleryItem, trigger: HTMLElement) => {
    lastFocusRef.current = trigger;
    setOpenItemKey(item.stableKey);
  };

  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;

    const focusable = getFocusable(modalRef.current);
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

  const copyCurrentLink = async () => {
    try {
      const copied = await copyText(window.location.href);
      setShareStatus(copied ? "Link copied" : "Copy failed");
    } catch {
      setShareStatus("Copy failed");
    }
  };

  const lightbox = (
    <div
      id="lightbox"
      ref={modalRef}
      className={openItem ? "lightbox" : "lightbox hidden"}
      aria-hidden={!openItem}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onKeyDown={trapTab}
    >
      <div id="lightboxBackdrop" className="lightbox-backdrop" data-close aria-hidden="true" onClick={closeModal} />
      <div className="lightbox-shell" role="document">
        <button
          id="lightboxClose"
          ref={closeRef}
          className="lightbox-close"
          type="button"
          data-close
          aria-label="Close viewer"
          onClick={closeModal}
        >
          {"\u2715"}
        </button>
        <figure className="lightbox-card" tabIndex={0}>
          {openItem ? (
            <LightboxImage
              key={openItem.stableKey}
              id="lightboxImg"
              src={openItem.full}
              previewSrc={openItem.thumb}
              alt={openItem.alt}
            />
          ) : null}
          <figcaption id="lightboxCaption" className="lightbox-caption">
            {openItem?.caption || openItem?.alt || ""}
          </figcaption>
        </figure>
      </div>
    </div>
  );

  return (
    <>
      <div className="gallery-toolbar" aria-label="Gallery browsing">
        <div className="gallery-controls">
          <div id="galleryFilters" className="gallery-filters" aria-label="Gallery categories">
            {filterCategories.map((category) => (
              <button
                className="gallery-filter"
                type="button"
                data-category={category.slug}
                aria-pressed={category.slug === activeCategory}
                key={category.slug}
                onClick={() => chooseCategory(category.slug)}
              >
                {category.label} · {category.count}
                <span className="sr-only"> {category.count === 1 ? "image" : "images"}</span>
              </button>
            ))}
          </div>
          <label className="gallery-order" htmlFor="gallerySort">
            <span className="gallery-order__label">Gallery order</span>
            <select
              id="gallerySort"
              className="gallery-order__select"
              aria-label="Gallery order"
              value={activeSort}
              onChange={(event) => chooseSort(event.target.value)}
            >
              <option value="random">Random mix</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
          <button id="galleryCopyLink" className="gallery-copy-link" type="button" onClick={copyCurrentLink}>
            Copy link
          </button>
        </div>
        <p id="galleryShareStatus" className="gallery-share-status muted" role="status" aria-live="polite" aria-atomic="true">
          {shareStatus}
        </p>
        <p id="galleryCount" className="gallery-count muted" role="status" aria-live="polite">
          {countText}
        </p>
      </div>

      <div className="gallery-feed-state" data-state={approvedFeedState}>
        <p
          id="galleryMemberFeedStatus"
          className="gallery-feed-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-busy={approvedFeedState === "loading"}
        >
          {approvedFeedState === "loading"
            ? "Loading member-submitted images…"
            : approvedFeedState === "error"
              ? "Member-submitted images are temporarily unavailable. The rest of the gallery is still available."
              : approvedItems.length > 0
                ? "Member-submitted images loaded."
                : "No member-submitted images are available yet."}
        </p>
        {approvedFeedState === "error" ? (
          <button
            className="gallery-feed-retry"
            type="button"
            aria-describedby="galleryMemberFeedStatus"
            onClick={retryApprovedFeed}
          >
            Try again
          </button>
        ) : null}
      </div>

      <p id="galleryEmpty" className="gallery-empty" role="status" hidden={visibleItems.length > 0}>
        No images in this category yet.
      </p>

      <div id="galleryGrid" className="gallery-grid" aria-live="polite" hidden={visibleItems.length === 0}>
        {renderedItems.map((item) => (
          <button
            className="gallery-thumb responsive-gallery-frame"
            type="button"
            data-full={item.full}
            data-caption={item.caption}
            data-category={itemCategories(item)[0] || undefined}
            key={item.stableKey}
            onClick={(event) => openModal(item, event.currentTarget)}
          >
            <ResponsiveGalleryMedia src={item.thumb} alt={item.alt} />
          </button>
        ))}
      </div>

      {hasMoreItems ? (
        <div className="gallery-load-more-row">
          <button id="galleryLoadMore" className="gallery-load-more" type="button" onClick={showMoreImages}>
            Show more images
          </button>
        </div>
      ) : null}

      {portalRoot ? createPortal(lightbox, portalRoot) : null}
    </>
  );
}
