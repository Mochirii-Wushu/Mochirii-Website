import {
  GALLERY_ALL_CATEGORY,
  normalizeGalleryQuery,
  isGalleryFilter,
  normalizedGallerySlug,
  type GalleryFilterSlug,
} from "./approved-feed.ts";

export const GALLERY_DEFAULT_SORT = "random" as const;
export const GALLERY_SORT_MODES = [GALLERY_DEFAULT_SORT, "newest", "oldest"] as const;

export type GallerySortMode = (typeof GALLERY_SORT_MODES)[number];
export type GalleryChronologicalSort = Exclude<GallerySortMode, typeof GALLERY_DEFAULT_SORT>;
export type GalleryRouteState = {
  category: GalleryFilterSlug;
  sort: GallerySortMode;
  query: string;
};

export type GallerySearchParameters =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

export type GalleryPresentationItem = {
  originalIndex: number;
  runtimeOrder: number | null;
  sortTimestamp: number;
  stableKey: string;
  stableSequence: number;
};

export type GalleryThumbnailStateItem = {
  approvedSubmissionId?: string;
  src?: string;
  thumb?: string;
};

const sortModeSet = new Set<string>(GALLERY_SORT_MODES);

function firstParameter(parameters: GallerySearchParameters, key: string) {
  if (parameters instanceof URLSearchParams) return parameters.get(key);
  const value = parameters[key];
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeGallerySort(value: unknown): GallerySortMode {
  const sort = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  return sortModeSet.has(sort) ? sort as GallerySortMode : GALLERY_DEFAULT_SORT;
}

export function normalizeGalleryRouteState(parameters: GallerySearchParameters): GalleryRouteState {
  const normalizedCategory = normalizedGallerySlug(firstParameter(parameters, "category"));
  return {
    category: isGalleryFilter(normalizedCategory) ? normalizedCategory : GALLERY_ALL_CATEGORY,
    sort: normalizeGallerySort(firstParameter(parameters, "sort")),
    query: normalizeGalleryQuery(firstParameter(parameters, "q")),
  };
}

export function galleryRouteHref(currentUrl: URL, state: GalleryRouteState) {
  const url = new URL(currentUrl.toString());
  const category = isGalleryFilter(state.category) ? state.category : GALLERY_ALL_CATEGORY;
  const sort = normalizeGallerySort(state.sort);
  const query = normalizeGalleryQuery(state.query);
  if (category === GALLERY_ALL_CATEGORY) url.searchParams.delete("category");
  else url.searchParams.set("category", category);
  if (sort === GALLERY_DEFAULT_SORT) url.searchParams.delete("sort");
  else url.searchParams.set("sort", sort);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function replaceGalleryThumbnail<T extends GalleryThumbnailStateItem>(
  items: T[],
  submissionId: string,
  refreshedSrc: string,
) {
  let changed = false;
  const next = items.map((item) => {
    if (
      item.approvedSubmissionId !== submissionId ||
      (item.src === refreshedSrc && item.thumb === refreshedSrc)
    ) return item;
    changed = true;
    return { ...item, src: refreshedSrc, thumb: refreshedSrc };
  });
  return changed ? next : items;
}

export function stableGalleryMixSeed(items: Array<{ stableKey: string }>) {
  let hash = 0x811c9dc5;
  for (const item of items) {
    for (const character of item.stableKey) {
      hash ^= character.codePointAt(0) || 0;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0 || 1;
}

function stableGalleryMixRank(stableKey: string, seed: number) {
  let hash = seed >>> 0;
  for (const character of stableKey) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function stableGalleryMixOrder<T extends GalleryPresentationItem>(items: T[], seed: number) {
  return [...items].sort((a, b) => {
    const rankDelta = stableGalleryMixRank(a.stableKey, seed) - stableGalleryMixRank(b.stableKey, seed);
    return rankDelta || a.stableKey.localeCompare(b.stableKey);
  });
}

function compareChronologicalItems<T extends GalleryPresentationItem>(
  a: T,
  b: T,
  sort: GalleryChronologicalSort,
) {
  const direction = sort === "newest" ? -1 : 1;
  const timeDelta = a.sortTimestamp - b.sortTimestamp;
  if (timeDelta !== 0) return direction * timeDelta;

  const aIsRuntime = a.runtimeOrder !== null;
  const bIsRuntime = b.runtimeOrder !== null;
  // Static cards precede runtime cards with the exact same public timestamp.
  // This makes the keyset boundary safe even when an unseen runtime row shares it.
  if (aIsRuntime !== bIsRuntime) return aIsRuntime ? 1 : -1;
  if (aIsRuntime && bIsRuntime) return (a.runtimeOrder || 0) - (b.runtimeOrder || 0);

  const sequenceDelta = a.stableSequence - b.stableSequence;
  if (sequenceDelta !== 0) return direction * sequenceDelta;
  const indexDelta = a.originalIndex - b.originalIndex;
  if (indexDelta !== 0) return direction * indexDelta;
  return direction * a.stableKey.localeCompare(b.stableKey);
}

export function orderGalleryPresentation<T extends GalleryPresentationItem>({
  staticItems,
  runtimeItems,
  sort,
  randomSeed,
  runtimeHasMore,
}: {
  staticItems: T[];
  runtimeItems: T[];
  sort: GallerySortMode;
  randomSeed: number;
  runtimeHasMore: boolean;
}) {
  if (sort === GALLERY_DEFAULT_SORT) {
    // Runtime cards arrive after hydration. Appending them preserves the exact
    // positions of every static card that the visitor has already painted.
    return [...stableGalleryMixOrder(staticItems, randomSeed), ...runtimeItems];
  }

  let safeStaticItems = staticItems;
  const runtimeBoundary = runtimeHasMore ? runtimeItems.at(-1) : undefined;
  if (runtimeBoundary) {
    safeStaticItems = staticItems.filter((item) => sort === "newest"
      ? item.sortTimestamp >= runtimeBoundary.sortTimestamp
      : item.sortTimestamp <= runtimeBoundary.sortTimestamp);
  }

  return [...safeStaticItems, ...runtimeItems]
    .sort((a, b) => compareChronologicalItems(a, b, sort));
}
