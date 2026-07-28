"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ResponsiveGalleryMedia } from "@/components/ResponsiveGalleryMedia";
import { UniversalImageLightbox } from "@/components/UniversalImageLightbox";
import { useBodyPortalRoot, useBodyScrollLock } from "@/components/useLightboxOverlay";
import {
  APPROVED_GALLERY_PAGE_SIZE,
  listApprovedGallerySubmissions,
  refreshApprovedGalleryThumbnail,
  resolveApprovedGalleryOriginal,
  type ApprovedGalleryFacets,
  type ApprovedGallerySubmission,
} from "@/lib/gallery/approved-feed";
import {
  GALLERY_ALL_CATEGORY,
  GALLERY_CATEGORY_SLUGS,
  GALLERY_MEMBER_SUBMISSIONS_CATEGORY,
  GALLERY_QUERY_MAX_LENGTH,
  galleryFilterLabel,
  galleryItemCategories,
  isGalleryCategory,
  normalizeGalleryQuery,
  normalizedGallerySlug,
  type GalleryFilterSlug,
} from "@/lib/gallery/categories";
import {
  GALLERY_DEFAULT_SORT,
  normalizeGalleryRouteState,
  normalizeGallerySort,
  orderGalleryPresentation,
  replaceGalleryThumbnail,
  stableGalleryMixSeed,
  type GalleryRouteState,
  type GallerySortMode,
} from "@/lib/gallery/browser-state";

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
  approvedSubmissionId?: string;
};

type ApprovedFeedState = "loading" | "ready" | "empty" | "error";
type NormalizedGalleryItem = Omit<GalleryItem, "alt" | "approvedSubmissionId" | "caption" | "categories" | "full" | "thumb"> & {
  alt: string;
  approvedSubmissionId: string | null;
  caption: string;
  categories: GalleryFilterSlug[];
  full: string;
  originalIndex: number;
  runtimeOrder: number | null;
  sortTimestamp: number;
  stableKey: string;
  stableSequence: number;
  thumb: string;
};

const galleryRenderBatchSize = APPROVED_GALLERY_PAGE_SIZE;
const emptyFacets: ApprovedGalleryFacets = {
  "member-submissions": 0,
  portraits: 0,
  gatherings: 0,
  action: 0,
  scenery: 0,
  companions: 0,
};

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
  for (const candidate of [item.id, item.full, item.src, item.thumb]) {
    const sequence = extractNumericSequence(candidate);
    if (sequence !== null && Number.isFinite(sequence)) return sequence;
  }
  return originalIndex + 1;
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

function normalizeItemCategories(item: GalleryItem) {
  const raw = Array.isArray(item.categories) && item.categories.length ? item.categories : [item.category];
  const values = galleryItemCategories(raw);
  return values.filter((category) => category !== GALLERY_ALL_CATEGORY);
}

function approvedSubmissionCaption(submission: ApprovedGallerySubmission) {
  const title = text(submission.title);
  const caption = text(submission.caption);
  return [title, caption].filter(Boolean).join(" - ");
}

function approvedSubmissionToGalleryItem(submission: ApprovedGallerySubmission): GalleryItem {
  const title = text(submission.title);
  const caption = text(submission.caption);
  const alt = title || caption || "Gallery image";
  return {
    id: `approved-${submission.id}`,
    approvedSubmissionId: submission.id,
    src: submission.thumbnail_url,
    thumb: submission.thumbnail_url,
    alt,
    caption: approvedSubmissionCaption(submission) || alt,
    category: submission.category || GALLERY_MEMBER_SUBMISSIONS_CATEGORY,
    categories: submission.categories,
    galleryAddedAt: submission.reviewed_at || submission.created_at || "",
  };
}

function matchesQuery(item: NormalizedGalleryItem, query: string) {
  if (!query) return true;
  const haystack = [item.alt, item.caption, item.categories.join(" ")].join(" ").normalize("NFKC").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function normalizeGalleryItem(
  item: GalleryItem,
  originalIndex: number,
  runtimeOrder: number | null = null,
): NormalizedGalleryItem | null {
  const approvedSubmissionId = text(item.approvedSubmissionId) || null;
  const full = approvedSubmissionId ? "" : publicPath(item.full || item.src);
  const thumb = publicPath(item.thumb || item.src || item.full);
  if (!thumb || (!full && !approvedSubmissionId)) return null;
  const categories = normalizeItemCategories(item);
  return {
    ...item,
    approvedSubmissionId,
    full,
    thumb,
    alt: text(item.alt || item.caption, "Gallery image"),
    caption: text(item.caption),
    categories,
    originalIndex,
    runtimeOrder,
    sortTimestamp: getSortTimestamp(item),
    stableKey: text(item.id || approvedSubmissionId || full || thumb, `gallery-${originalIndex}`),
    stableSequence: getStableSequence({ ...item, full, thumb }, originalIndex),
  };
}

export function GalleryBrowser({
  categories,
  initialState,
  items,
}: {
  categories: Category[];
  initialState: GalleryRouteState;
  items: GalleryItem[];
}) {
  const [activeCategory, setActiveCategory] = useState<GalleryFilterSlug>(initialState.category);
  const [activeSort, setActiveSort] = useState<GallerySortMode>(initialState.sort);
  const [activeQuery, setActiveQuery] = useState(initialState.query);
  const [queryDraft, setQueryDraft] = useState(initialState.query);
  const [approvedItems, setApprovedItems] = useState<GalleryItem[]>([]);
  const [approvedFacets, setApprovedFacets] = useState<ApprovedGalleryFacets>(emptyFacets);
  const [approvedTotal, setApprovedTotal] = useState(0);
  const [approvedHasMore, setApprovedHasMore] = useState(false);
  const [approvedCursor, setApprovedCursor] = useState<string | null>(null);
  const [approvedPartial, setApprovedPartial] = useState(false);
  const [approvedFeedState, setApprovedFeedState] = useState<ApprovedFeedState>("loading");
  const [approvedFeedAttempt, setApprovedFeedAttempt] = useState(0);
  const [approvedLoadMoreBusy, setApprovedLoadMoreBusy] = useState(false);
  const [renderWindow, setRenderWindow] = useState({ key: "", limit: galleryRenderBatchSize });
  const [shareStatus, setShareStatus] = useState("");
  const [openItemKey, setOpenItemKey] = useState<string | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const nextPageControllerRef = useRef<AbortController | null>(null);
  const consumedCursorRef = useRef<Set<string>>(new Set());
  const portalRoot = useBodyPortalRoot();

  const resetApprovedFeed = useCallback(() => {
    nextPageControllerRef.current?.abort();
    consumedCursorRef.current.clear();
    setApprovedItems([]);
    setApprovedFacets(emptyFacets);
    setApprovedTotal(0);
    setApprovedHasMore(false);
    setApprovedCursor(null);
    setApprovedPartial(false);
    setApprovedFeedState("loading");
    setApprovedLoadMoreBusy(false);
    setApprovedFeedAttempt((attempt) => attempt + 1);
  }, []);

  const staticItems = useMemo(
    () => items
      .map((item, index) => normalizeGalleryItem(item, index))
      .filter((item): item is NormalizedGalleryItem => Boolean(item)),
    [items],
  );
  const normalizedApprovedItems = useMemo(
    () => approvedItems
      .map((item, index) => normalizeGalleryItem(item, items.length + index, index))
      .filter((item): item is NormalizedGalleryItem => Boolean(item)),
    [approvedItems, items.length],
  );

  const declaredLabels = useMemo(() => new Map(
    categories
      .map((category) => {
        const slug = normalizedGallerySlug(category.slug);
        return isGalleryCategory(slug) ? [slug, text(category.label, galleryFilterLabel(slug))] as const : null;
      })
      .filter((entry): entry is readonly [(typeof GALLERY_CATEGORY_SLUGS)[number], string] => Boolean(entry)),
  ), [categories]);

  useEffect(() => {
    const replaceWithCanonicalState = (url: URL, state: GalleryRouteState) => {
      if (state.category === GALLERY_ALL_CATEGORY) url.searchParams.delete("category");
      else url.searchParams.set("category", state.category);
      if (state.sort === GALLERY_DEFAULT_SORT) url.searchParams.delete("sort");
      else url.searchParams.set("sort", state.sort);
      if (state.query) url.searchParams.set("q", state.query);
      else url.searchParams.delete("q");
      const canonical = `${url.pathname}${url.search}${url.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (canonical !== current) window.history.replaceState(window.history.state, "", canonical);
    };

    const readState = () => {
      const url = new URL(window.location.href);
      const state = normalizeGalleryRouteState(url.searchParams);
      resetApprovedFeed();
      setActiveCategory(state.category);
      setActiveSort(state.sort);
      setActiveQuery(state.query);
      setQueryDraft(state.query);
      replaceWithCanonicalState(url, state);
    };

    replaceWithCanonicalState(new URL(window.location.href), initialState);
    window.addEventListener("popstate", readState);
    return () => window.removeEventListener("popstate", readState);
  }, [initialState, resetApprovedFeed]);

  useEffect(() => {
    const controller = new AbortController();

    listApprovedGallerySubmissions({
      sort: activeSort === "oldest" ? "oldest" : "newest",
      category: activeCategory,
      query: activeQuery,
    }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok || !result.data) {
        setApprovedFeedState("error");
        return;
      }
      setApprovedItems(result.data.items.map(approvedSubmissionToGalleryItem));
      setApprovedFacets(result.data.facets);
      setApprovedTotal(result.data.totalEligible);
      setApprovedHasMore(result.data.hasMore);
      setApprovedCursor(result.data.nextCursor);
      setApprovedPartial(result.data.partial);
      setApprovedFeedState(result.data.totalEligible > 0 ? "ready" : "empty");
    }).catch((error) => {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setApprovedFeedState("error");
    });

    return () => controller.abort();
  }, [activeCategory, activeQuery, activeSort, approvedFeedAttempt]);

  useEffect(() => () => nextPageControllerRef.current?.abort(), []);

  const retryApprovedFeed = useCallback(() => {
    resetApprovedFeed();
  }, [resetApprovedFeed]);

  const updateApprovedThumbnail = useCallback((submissionId: string, refreshedSrc: string) => {
    setApprovedItems((current) => replaceGalleryThumbnail(current, submissionId, refreshedSrc));
  }, []);

  const staticQueryItems = useMemo(
    () => staticItems.filter((item) => matchesQuery(item, activeQuery)),
    [activeQuery, staticItems],
  );
  const staticFilteredItems = useMemo(
    () => staticQueryItems.filter((item) =>
      activeCategory === GALLERY_ALL_CATEGORY
        ? true
        : activeCategory === GALLERY_MEMBER_SUBMISSIONS_CATEGORY
          ? false
          : item.categories.includes(activeCategory)),
    [activeCategory, staticQueryItems],
  );

  const filterCategories = useMemo(() => {
    const staticCounts = new Map<GalleryFilterSlug, number>([[GALLERY_ALL_CATEGORY, staticQueryItems.length]]);
    for (const category of GALLERY_CATEGORY_SLUGS) staticCounts.set(category, 0);
    for (const item of staticQueryItems) {
      for (const category of item.categories) {
        if (isGalleryCategory(category)) staticCounts.set(category, (staticCounts.get(category) || 0) + 1);
      }
    }
    return [
      {
        slug: GALLERY_ALL_CATEGORY,
        label: galleryFilterLabel(GALLERY_ALL_CATEGORY),
        count: (staticCounts.get(GALLERY_ALL_CATEGORY) || 0) + approvedFacets[GALLERY_MEMBER_SUBMISSIONS_CATEGORY],
      },
      ...GALLERY_CATEGORY_SLUGS.map((slug) => ({
        slug,
        label: declaredLabels.get(slug) || galleryFilterLabel(slug),
        count: (staticCounts.get(slug) || 0) + approvedFacets[slug],
      })),
      {
        slug: GALLERY_MEMBER_SUBMISSIONS_CATEGORY,
        label: galleryFilterLabel(GALLERY_MEMBER_SUBMISSIONS_CATEGORY),
        count: approvedFacets[GALLERY_MEMBER_SUBMISSIONS_CATEGORY],
      },
    ];
  }, [approvedFacets, declaredLabels, staticQueryItems]);

  const randomSeed = useMemo(() => stableGalleryMixSeed(staticItems), [staticItems]);
  const visibleItems = useMemo(() => orderGalleryPresentation({
    staticItems: staticFilteredItems,
    runtimeItems: normalizedApprovedItems,
    sort: activeSort,
    randomSeed,
    runtimeHasMore: approvedHasMore,
  }), [activeSort, approvedHasMore, normalizedApprovedItems, randomSeed, staticFilteredItems]);

  const renderWindowKey = `${activeCategory}:${activeSort}:${activeQuery}:${randomSeed}`;
  const effectiveRenderLimit = renderWindow.key === renderWindowKey ? renderWindow.limit : galleryRenderBatchSize;
  const renderedItems = useMemo(() => visibleItems.slice(0, effectiveRenderLimit), [effectiveRenderLimit, visibleItems]);
  const totalVisible = staticFilteredItems.length + approvedTotal;
  const hasMoreItems = renderedItems.length < visibleItems.length || approvedHasMore;
  const chronologicalOrderPending = activeSort !== GALLERY_DEFAULT_SORT && approvedFeedState === "loading";
  const openItem = openItemKey === null ? null : visibleItems.find((item) => item.stableKey === openItemKey) || null;
  const openApprovedSubmissionId = openItem?.approvedSubmissionId || null;
  const activeLabel = filterCategories.find((category) => category.slug === activeCategory)?.label || "All";
  const availabilitySuffix = approvedFeedState === "ready" || approvedFeedState === "empty"
    ? ""
    : " currently available";
  const countText = activeLabel === "All"
    ? `Showing ${renderedItems.length} of ${totalVisible} ${totalVisible === 1 ? "image" : "images"}${availabilitySuffix}.`
    : `Showing ${renderedItems.length} of ${totalVisible} ${totalVisible === 1 ? "image" : "images"}${availabilitySuffix} in ${activeLabel}.`;

  const closeModal = useCallback(() => {
    setOpenItemKey(null);
    window.setTimeout(() => {
      lastFocusRef.current?.focus({ preventScroll: true });
      lastFocusRef.current = null;
    }, 0);
  }, []);

  const resolveOpenFullImage = useCallback((signal: AbortSignal) => {
    if (!openApprovedSubmissionId) return Promise.reject(new Error("The full image is unavailable."));
    return resolveApprovedGalleryOriginal(openApprovedSubmissionId, signal);
  }, [openApprovedSubmissionId]);

  useBodyScrollLock(Boolean(openItem));

  const updateUrl = (category: GalleryFilterSlug, sort: GallerySortMode, query: string) => {
    const url = new URL(window.location.href);
    if (category === GALLERY_ALL_CATEGORY) url.searchParams.delete("category");
    else url.searchParams.set("category", category);
    if (sort === GALLERY_DEFAULT_SORT) url.searchParams.delete("sort");
    else url.searchParams.set("sort", sort);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.pushState({ galleryCategory: category, gallerySort: sort, galleryQuery: query }, "", next);
  };

  const chooseCategory = (category: GalleryFilterSlug) => {
    resetApprovedFeed();
    setActiveCategory(category);
    setShareStatus("");
    updateUrl(category, activeSort, activeQuery);
  };

  const chooseSort = (sort: string) => {
    const nextSort = normalizeGallerySort(sort);
    resetApprovedFeed();
    setActiveSort(nextSort);
    setShareStatus("");
    updateUrl(activeCategory, nextSort, activeQuery);
  };

  const submitQuery = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = normalizeGalleryQuery(queryDraft);
    resetApprovedFeed();
    setQueryDraft(nextQuery);
    setActiveQuery(nextQuery);
    setShareStatus("");
    updateUrl(activeCategory, activeSort, nextQuery);
  };

  const clearQuery = () => {
    resetApprovedFeed();
    setQueryDraft("");
    setActiveQuery("");
    setShareStatus("");
    updateUrl(activeCategory, activeSort, "");
  };

  const resetEmptyView = () => {
    resetApprovedFeed();
    setActiveCategory(GALLERY_ALL_CATEGORY);
    setQueryDraft("");
    setActiveQuery("");
    setShareStatus("");
    updateUrl(GALLERY_ALL_CATEGORY, activeSort, "");
  };

  const loadNextApprovedPage = async () => {
    if (!approvedHasMore || !approvedCursor || approvedLoadMoreBusy) return false;
    if (consumedCursorRef.current.has(approvedCursor)) {
      setApprovedFeedState("error");
      return false;
    }
    consumedCursorRef.current.add(approvedCursor);
    nextPageControllerRef.current?.abort();
    const controller = new AbortController();
    nextPageControllerRef.current = controller;
    setApprovedLoadMoreBusy(true);
    try {
      const result = await listApprovedGallerySubmissions({
        cursor: approvedCursor,
        sort: activeSort === "oldest" ? "oldest" : "newest",
        category: activeCategory,
        query: activeQuery,
      }, controller.signal);
      if (!result.ok || !result.data) {
        setApprovedFeedState("error");
        return false;
      }
      const page = result.data;
      const knownIds = new Set(approvedItems.map((item) => item.approvedSubmissionId));
      if (
        page.totalEligible !== approvedTotal ||
        JSON.stringify(page.facets) !== JSON.stringify(approvedFacets) ||
        page.items.some((item) => knownIds.has(item.id)) ||
        (page.hasMore && (!page.nextCursor || consumedCursorRef.current.has(page.nextCursor)))
      ) {
        setApprovedFeedState("error");
        return false;
      }
      setApprovedItems((current) => {
        return [
          ...current,
          ...page.items.map(approvedSubmissionToGalleryItem),
        ];
      });
      setApprovedFacets(page.facets);
      setApprovedTotal(page.totalEligible);
      setApprovedHasMore(page.hasMore);
      setApprovedCursor(page.nextCursor);
      setApprovedPartial((partial) => partial || page.partial);
      setApprovedFeedState("ready");
      return true;
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return false;
      setApprovedFeedState("error");
      return false;
    } finally {
      if (nextPageControllerRef.current === controller) nextPageControllerRef.current = null;
      if (!controller.signal.aborted) setApprovedLoadMoreBusy(false);
    }
  };

  const showMoreImages = async () => {
    const remainingLoaded = visibleItems.length - renderedItems.length;
    if (remainingLoaded < galleryRenderBatchSize && approvedHasMore) await loadNextApprovedPage();
    setRenderWindow((current) => ({
      key: renderWindowKey,
      limit: Math.max(
        current.key === renderWindowKey ? current.limit : galleryRenderBatchSize,
        renderedItems.length + galleryRenderBatchSize,
      ),
    }));
  };

  const openModal = (item: NormalizedGalleryItem, trigger: HTMLElement) => {
    lastFocusRef.current = trigger;
    setOpenItemKey(item.stableKey);
  };

  const copyCurrentLink = async () => {
    try {
      const copied = await copyText(window.location.href);
      setShareStatus(copied ? "Link copied" : "Copy failed");
    } catch {
      setShareStatus("Copy failed");
    }
  };

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
          <form className="gallery-order" role="search" onSubmit={submitQuery}>
            <label className="gallery-order__label" htmlFor="gallerySearch">Search</label>
            <input
              id="gallerySearch"
              className="gallery-order__select"
              type="search"
              value={queryDraft}
              maxLength={GALLERY_QUERY_MAX_LENGTH}
              onChange={(event) => setQueryDraft(event.target.value)}
            />
            <button className="gallery-copy-link" type="submit">Search</button>
            {activeQuery ? (
              <button className="gallery-copy-link" type="button" onClick={clearQuery}>Clear</button>
            ) : null}
          </form>
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
          aria-busy={approvedFeedState === "loading" || approvedLoadMoreBusy}
        >
          {approvedFeedState === "loading"
            ? "Loading member-submitted images…"
            : approvedFeedState === "error"
              ? "Member-submitted images are temporarily unavailable. The rest of the gallery is still available."
              : approvedFeedState === "empty"
                ? "No member-submitted images are available yet."
                : approvedLoadMoreBusy
                  ? "Loading more member-submitted images…"
                  : approvedPartial
                    ? "Some member-submitted images could not be shown."
                    : "Member-submitted images loaded."}
        </p>
        {approvedFeedState === "error" ? (
          <button className="gallery-feed-retry" type="button" aria-describedby="galleryMemberFeedStatus" onClick={retryApprovedFeed}>
            Try again
          </button>
        ) : null}
      </div>

      <p id="galleryEmpty" className="gallery-empty" role="status" hidden={totalVisible > 0}>
        {activeQuery ? "No images match this search." : "No images in this category yet."}
      </p>
      {totalVisible === 0 &&
        (activeCategory !== GALLERY_ALL_CATEGORY || activeQuery) ? (
          <div className="gallery-load-more-row">
            <button className="gallery-load-more" type="button" onClick={resetEmptyView}>
              Show all images
            </button>
          </div>
        ) : null}

      <noscript>
        <style>{".gallery-toolbar,.gallery-feed-state,.gallery-load-more-row{display:none!important}.gallery-grid[data-order-pending='true']{visibility:visible!important;pointer-events:auto!important}"}</style>
        <p className="gallery-feed-status">
          Interactive filters and member-submitted images require JavaScript. The published images below remain available as direct links.
        </p>
      </noscript>

      <div
        id="galleryGrid"
        className="gallery-grid"
        data-order-pending={chronologicalOrderPending}
        aria-busy={chronologicalOrderPending}
        aria-hidden={chronologicalOrderPending || undefined}
        hidden={totalVisible === 0}
      >
        {renderedItems.map((item) => {
          const media = (
            <ResponsiveGalleryMedia
              src={item.thumb}
              alt={item.alt}
              refreshSource={item.approvedSubmissionId
                ? (signal) => refreshApprovedGalleryThumbnail(item.approvedSubmissionId || "", signal)
                : undefined}
              onSourceRefresh={item.approvedSubmissionId
                ? (refreshedSrc) => updateApprovedThumbnail(item.approvedSubmissionId || "", refreshedSrc)
                : undefined}
            />
          );
          const sharedProps = {
            "data-caption": item.caption,
            "data-category": item.categories[0] || undefined,
            "data-full": item.full || undefined,
          };

          return item.approvedSubmissionId ? (
            <button
              {...sharedProps}
              className="gallery-thumb responsive-gallery-frame"
              type="button"
              key={item.stableKey}
              onClick={(event) => openModal(item, event.currentTarget)}
            >
              {media}
            </button>
          ) : (
            <a
              {...sharedProps}
              className="gallery-thumb responsive-gallery-frame"
              href={item.full}
              key={item.stableKey}
              onClick={(event) => {
                event.preventDefault();
                openModal(item, event.currentTarget);
              }}
            >
              {media}
            </a>
          );
        })}
      </div>

      {hasMoreItems ? (
        <div className="gallery-load-more-row">
          <button
            id="galleryLoadMore"
            className="gallery-load-more"
            type="button"
            disabled={approvedLoadMoreBusy}
            onClick={() => void showMoreImages()}
          >
            {approvedLoadMoreBusy ? "Loading more images…" : "Show more images"}
          </button>
        </div>
      ) : null}

      {portalRoot && openItem ? (
        <UniversalImageLightbox
          item={{
            key: openItem.stableKey,
            previewSrc: openItem.thumb,
            fullSrc: openItem.full || undefined,
            alt: openItem.alt,
            caption: openItem.caption,
            resolveFullSrc: openApprovedSubmissionId ? resolveOpenFullImage : undefined,
          }}
          ids={{
            root: "lightbox",
            backdrop: "lightboxBackdrop",
            close: "lightboxClose",
            image: "lightboxImg",
            caption: "lightboxCaption",
          }}
          dialogLabel="Image viewer"
          appearance="gallery"
          portalRoot={portalRoot}
          onClose={closeModal}
        />
      ) : null}
    </>
  );
}
