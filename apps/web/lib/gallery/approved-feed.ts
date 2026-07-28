import publicUrls from "../../config/public-urls.json" with { type: "json" };
import {
  GALLERY_CATEGORY_SLUGS,
  GALLERY_ALL_CATEGORY,
  GALLERY_MEMBER_SUBMISSIONS_CATEGORY,
  type GalleryFilterSlug,
  galleryItemCategories,
  isGalleryCategory,
  normalizeGalleryQuery,
} from "./categories.ts";

export const APPROVED_GALLERY_SCHEMA_VERSION = 2;
export const APPROVED_GALLERY_PAGE_SIZE = 24;

export type ApprovedGallerySort = "newest" | "oldest";

export type ApprovedGallerySubmission = {
  id: string;
  title: string | null;
  caption: string | null;
  category: (typeof GALLERY_CATEGORY_SLUGS)[number];
  categories: GalleryFilterSlug[];
  mime_type: "image/webp";
  size_bytes: number;
  created_at: string;
  reviewed_at: string;
  thumbnail_url: string;
  thumbnail_size_bytes: number;
  thumbnail_width: number;
  thumbnail_height: number;
};

export type ApprovedGalleryFacets = Record<
  typeof GALLERY_MEMBER_SUBMISSIONS_CATEGORY | (typeof GALLERY_CATEGORY_SLUGS)[number],
  number
>;

export type ApprovedGalleryPage = {
  schemaVersion: typeof APPROVED_GALLERY_SCHEMA_VERSION;
  items: ApprovedGallerySubmission[];
  count: number;
  totalEligible: number;
  facets: ApprovedGalleryFacets;
  hasMore: boolean;
  nextCursor: string | null;
  partial: boolean;
  complete: boolean;
  deliveryFailures: number;
  delivery: "bounded-edge-media";
  cacheSeconds: number;
};

export type ApprovedGalleryAsset = {
  schemaVersion: typeof APPROVED_GALLERY_SCHEMA_VERSION;
  id: string;
  mediaUrl: string;
};

export type ApprovedGalleryPageRequest = {
  cursor?: string | null;
  sort?: ApprovedGallerySort;
  category?: GalleryFilterSlug | null;
  query?: string | null;
  pageSize?: number;
};

export type PublicGalleryFeedResult<T> = {
  ok: boolean;
  status: number;
  statusText: string;
  data: T | null;
  message: string | null;
};

type JsonRecord = Record<string, unknown>;

const unavailableMessage = "Member-submitted images are temporarily unavailable.";
const fullImageUnavailableMessage = "The full image is unavailable.";
const thumbnailUnavailableMessage = "The image preview is unavailable.";
const APPROVED_GALLERY_REQUEST_TIMEOUT_MS = 8_000;
const APPROVED_GALLERY_CACHE_MAX_ENTRIES = 40;
const APPROVED_GALLERY_CACHE_MAX_TTL_MS = 60_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cursorPattern = /^[A-Za-z0-9_-]{1,1024}$/;
const galleryMediaPath = "/functions/v1/list-approved-gallery-submissions";
const listDataKeys = new Set([
  "schemaVersion",
  "items",
  "count",
  "totalEligible",
  "facets",
  "hasMore",
  "nextCursor",
  "partial",
  "complete",
  "deliveryFailures",
  "delivery",
  "cacheSeconds",
]);
const itemKeys = new Set([
  "id",
  "title",
  "caption",
  "category",
  "categories",
  "mime_type",
  "size_bytes",
  "created_at",
  "reviewed_at",
  "thumbnail_url",
  "thumbnail_size_bytes",
  "thumbnail_width",
  "thumbnail_height",
]);
const assetDataKeys = new Set([
  "schemaVersion",
  "id",
  "full_url",
  "thumbnail_url",
]);

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function hasOnlyKeys(value: JsonRecord, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function stringOrNull(value: unknown, maximumLength: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const clean = value.normalize("NFKC").trim();
  if (clean.length > maximumLength) return undefined;
  return clean || null;
}

function nonemptyString(value: unknown, maximumLength: number): string | null {
  const clean = stringOrNull(value, maximumLength);
  return typeof clean === "string" && clean ? clean : null;
}

function safeInteger(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

function validDateOrNull(value: unknown) {
  const clean = stringOrNull(value, 80);
  if (clean === null) return null;
  return typeof clean === "string" && Number.isFinite(Date.parse(clean)) ? clean : undefined;
}

function configuredSupabaseUrl() {
  const fallback = new URL(`https://${publicUrls.supabaseProjectRef}.supabase.co`);
  const configured = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!configured) return fallback;

  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password) return fallback;
    return new URL(url.origin);
  } catch {
    return fallback;
  }
}

function validGalleryMediaUrl(
  value: unknown,
  mediaKind: "display" | "thumbnail",
  publicationId: string,
) {
  const clean = nonemptyString(value, 4_000);
  if (!clean) return null;
  try {
    const url = new URL(clean);
    const configured = configuredSupabaseUrl();
    if (
      url.origin !== configured.origin || url.protocol !== "https:" || url.username || url.password ||
      url.hash || url.pathname !== galleryMediaPath ||
      [...url.searchParams.keys()].sort().join(",") !== "asset,id" ||
      url.searchParams.get("asset") !== (mediaKind === "display" ? "full" : "thumbnail") ||
      url.searchParams.get("id") !== publicationId
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function parseItem(value: unknown): ApprovedGallerySubmission | null {
  const item = record(value);
  if (!item || !hasOnlyKeys(item, itemKeys)) return null;

  const id = nonemptyString(item.id, 80);
  const title = stringOrNull(item.title, 80);
  const caption = stringOrNull(item.caption, 300);
  const rawCategory = stringOrNull(item.category, 40);
  const rawCategories = Array.isArray(item.categories) ? item.categories : null;
  const categories = galleryItemCategories(item.categories);
  const mimeType = stringOrNull(item.mime_type, 80);
  const sizeBytes = safeInteger(item.size_bytes, 0, Number.MAX_SAFE_INTEGER);
  const createdAt = validDateOrNull(item.created_at);
  const reviewedAt = validDateOrNull(item.reviewed_at);
  const thumbnailUrl = id
    ? validGalleryMediaUrl(item.thumbnail_url, "thumbnail", id)
    : null;
  const thumbnailSizeBytes = safeInteger(item.thumbnail_size_bytes, 1, 80 * 1024);
  const thumbnailWidth = safeInteger(item.thumbnail_width, 1, 720);
  const thumbnailHeight = safeInteger(item.thumbnail_height, 1, 720);
  const category = rawCategory !== null && isGalleryCategory(rawCategory) ? rawCategory : undefined;

  if (
    !id || !uuidPattern.test(id) || title === undefined || caption === undefined || category === undefined ||
    !rawCategories || rawCategories.length !== categories.length || categories.length < 1 || categories.length > 2 ||
    categories.includes(GALLERY_ALL_CATEGORY) || !categories.includes(GALLERY_MEMBER_SUBMISSIONS_CATEGORY) ||
    categories.length !== 2 || !categories.includes(category) ||
    mimeType !== "image/webp" || sizeBytes === null || sizeBytes < 1 || sizeBytes > 2 * 1024 * 1024 ||
    !createdAt || !reviewedAt ||
    !thumbnailUrl || thumbnailSizeBytes === null || thumbnailWidth === null || thumbnailHeight === null
  ) return null;

  return {
    id,
    title,
    caption,
    category,
    categories,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    created_at: createdAt,
    reviewed_at: reviewedAt,
    thumbnail_url: thumbnailUrl,
    thumbnail_size_bytes: thumbnailSizeBytes,
    thumbnail_width: thumbnailWidth,
    thumbnail_height: thumbnailHeight,
  };
}

function parseFacets(value: unknown): ApprovedGalleryFacets | null {
  const facets = record(value);
  const keys = [GALLERY_MEMBER_SUBMISSIONS_CATEGORY, ...GALLERY_CATEGORY_SLUGS] as const;
  if (!facets || Object.keys(facets).length !== keys.length || !keys.every((key) => key in facets)) return null;
  const parsed = Object.fromEntries(
    keys.map((key) => [key, safeInteger(facets[key], 0, Number.MAX_SAFE_INTEGER)]),
  );
  return Object.values(parsed).every((count) => count !== null)
    ? parsed as ApprovedGalleryFacets
    : null;
}

export function parseApprovedGalleryPage(value: unknown): ApprovedGalleryPage | null {
  const data = record(value);
  if (
    !data || Object.keys(data).length !== listDataKeys.size ||
    !hasOnlyKeys(data, listDataKeys) || data.schemaVersion !== APPROVED_GALLERY_SCHEMA_VERSION
  ) return null;
  if (!Array.isArray(data.items)) return null;
  const items = data.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  const itemIds = items.map((item) => item?.id || "");
  if (new Set(itemIds).size !== itemIds.length) return null;

  const count = safeInteger(data.count, 0, APPROVED_GALLERY_PAGE_SIZE);
  const totalEligible = safeInteger(data.totalEligible, 0, Number.MAX_SAFE_INTEGER);
  const facets = parseFacets(data.facets);
  const nextCursor = data.nextCursor === null ? null : nonemptyString(data.nextCursor, 1024);
  const deliveryFailures = safeInteger(data.deliveryFailures, 0, APPROVED_GALLERY_PAGE_SIZE);
  const cacheSeconds = safeInteger(data.cacheSeconds, 1, 60);
  if (
    count === null || count !== items.length || totalEligible === null || totalEligible < items.length || !facets ||
    typeof data.hasMore !== "boolean" || (data.hasMore && (!nextCursor || !cursorPattern.test(nextCursor))) ||
    (!data.hasMore && nextCursor !== null) || data.partial !== false ||
    typeof data.complete !== "boolean" || deliveryFailures !== 0 ||
    data.complete !== !data.hasMore ||
    data.delivery !== "bounded-edge-media" || cacheSeconds === null
  ) return null;

  return {
    schemaVersion: APPROVED_GALLERY_SCHEMA_VERSION,
    items: items as ApprovedGallerySubmission[],
    count,
    totalEligible,
    facets,
    hasMore: data.hasMore,
    nextCursor,
    partial: data.partial,
    complete: data.complete,
    deliveryFailures,
    delivery: "bounded-edge-media",
    cacheSeconds,
  };
}

export function parseApprovedGalleryAsset(
  value: unknown,
  expectedId: string,
  urlKey: "full_url" | "thumbnail_url",
): ApprovedGalleryAsset | null {
  const data = record(value);
  if (!data || !hasOnlyKeys(data, assetDataKeys) || data.schemaVersion !== APPROVED_GALLERY_SCHEMA_VERSION) return null;
  const id = nonemptyString(data.id, 80);
  const mediaUrl = id
    ? validGalleryMediaUrl(
      data[urlKey],
      urlKey === "full_url" ? "display" : "thumbnail",
      id,
    )
    : null;
  if (!id || id !== expectedId || !uuidPattern.test(id) || !mediaUrl) return null;
  if (urlKey === "full_url" && "thumbnail_url" in data) return null;
  if (urlKey === "thumbnail_url" && "full_url" in data) return null;
  return { schemaVersion: APPROVED_GALLERY_SCHEMA_VERSION, id, mediaUrl };
}

function approvedGalleryFeedUrl() {
  return `${configuredSupabaseUrl().origin}/functions/v1/list-approved-gallery-submissions`;
}

class GalleryRequestTimeoutError extends Error {
  constructor() {
    super("The Gallery request timed out.");
    this.name = "GalleryRequestTimeoutError";
  }
}

function abortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

export async function fetchWithGalleryTimeout(
  input: string,
  init: RequestInit,
  callerSignal?: AbortSignal,
  timeoutMs = APPROVED_GALLERY_REQUEST_TIMEOUT_MS,
) {
  if (callerSignal?.aborted) throw abortError();

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeCallerAbort = () => {};
  const stop = new Promise<Response>((_resolve, reject) => {
    const onCallerAbort = () => {
      controller.abort();
      reject(abortError());
    };
    if (callerSignal) {
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      removeCallerAbort = () => callerSignal.removeEventListener("abort", onCallerAbort);
    }
    timeout = setTimeout(() => {
      controller.abort();
      reject(new GalleryRequestTimeoutError());
    }, Math.max(1, Math.min(APPROVED_GALLERY_REQUEST_TIMEOUT_MS, timeoutMs)));
  });

  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      stop,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    removeCallerAbort();
  }
}

type GalleryCacheEntry = {
  controller: AbortController;
  consumers: number;
  expiresAt: number;
  promise: Promise<PublicGalleryFeedResult<unknown>>;
  settled: boolean;
};

const approvedGalleryResponseCache = new Map<string, GalleryCacheEntry>();

function pruneApprovedGalleryCache(now = Date.now()) {
  for (const [key, entry] of approvedGalleryResponseCache) {
    if (entry.settled && entry.expiresAt <= now) approvedGalleryResponseCache.delete(key);
  }
}

function makeRoomInApprovedGalleryCache() {
  while (approvedGalleryResponseCache.size >= APPROVED_GALLERY_CACHE_MAX_ENTRIES) {
    const settled = [...approvedGalleryResponseCache].find(([, entry]) => entry.settled);
    const oldest = settled || approvedGalleryResponseCache.entries().next().value;
    if (!oldest) break;
    const [key, entry] = oldest;
    if (!entry.settled) entry.controller.abort();
    approvedGalleryResponseCache.delete(key);
  }
}

function galleryCacheTtlMs(result: PublicGalleryFeedResult<unknown>) {
  const data = record(result.data);
  const cacheSeconds = safeInteger(data?.cacheSeconds, 1, 60);
  return result.ok && cacheSeconds !== null
    ? Math.min(APPROVED_GALLERY_CACHE_MAX_TTL_MS, cacheSeconds * 1_000)
    : 0;
}

function consumeGalleryCacheEntry<T>(
  key: string,
  entry: GalleryCacheEntry,
  signal?: AbortSignal,
): Promise<PublicGalleryFeedResult<T>> {
  if (signal?.aborted) return Promise.reject(abortError());
  entry.consumers += 1;

  return new Promise((resolve, reject) => {
    let complete = false;
    const release = () => {
      if (complete) return;
      complete = true;
      signal?.removeEventListener("abort", onAbort);
      entry.consumers -= 1;
      if (!entry.settled && entry.consumers === 0 && approvedGalleryResponseCache.get(key) === entry) {
        approvedGalleryResponseCache.delete(key);
        entry.controller.abort();
      }
    };
    const onAbort = () => {
      release();
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (result) => {
        release();
        resolve(result as PublicGalleryFeedResult<T>);
      },
      (error) => {
        release();
        reject(error);
      },
    );
  });
}

async function performApprovedGalleryRequest<T>({
  body,
  signal,
  parse,
  unavailable,
}: {
  body: JsonRecord;
  signal: AbortSignal;
  parse: (value: unknown) => T | null;
  unavailable: string;
}): Promise<PublicGalleryFeedResult<T>> {
  try {
    const response = await fetchWithGalleryTimeout(approvedGalleryFeedUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
    }, signal);
    const payload = record(await response.json().catch(() => null));
    const data = payload?.ok === true ? parse(payload.data) : null;
    if (!response.ok || !data) {
      return { ok: false, status: response.status, statusText: response.statusText, data: null, message: unavailable };
    }
    return { ok: true, status: response.status, statusText: response.statusText, data, message: null };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, statusText: "", data: null, message: unavailable };
  }
}

async function requestApprovedGallery<T>({
  body,
  cacheCompleted = true,
  signal,
  parse,
  unavailable,
}: {
  body: JsonRecord;
  cacheCompleted?: boolean;
  signal?: AbortSignal;
  parse: (value: unknown) => T | null;
  unavailable: string;
}): Promise<PublicGalleryFeedResult<T>> {
  const cacheKey = `${approvedGalleryFeedUrl()}\n${JSON.stringify(body)}`;
  const now = Date.now();
  pruneApprovedGalleryCache(now);
  let entry = approvedGalleryResponseCache.get(cacheKey);
  if (entry?.settled && entry.expiresAt <= now) {
    approvedGalleryResponseCache.delete(cacheKey);
    entry = undefined;
  }

  if (!entry) {
    makeRoomInApprovedGalleryCache();
    const controller = new AbortController();
    entry = {
      controller,
      consumers: 0,
      expiresAt: Number.POSITIVE_INFINITY,
      settled: false,
      promise: Promise.resolve({ ok: false, status: 0, statusText: "", data: null, message: unavailable }),
    };
    const currentEntry = entry;
    currentEntry.promise = performApprovedGalleryRequest({ body, signal: controller.signal, parse, unavailable })
      .then((result) => {
        currentEntry.settled = true;
        const ttlMs = galleryCacheTtlMs(result);
        if (cacheCompleted && ttlMs > 0 && approvedGalleryResponseCache.get(cacheKey) === currentEntry) {
          currentEntry.expiresAt = Date.now() + ttlMs;
        } else {
          approvedGalleryResponseCache.delete(cacheKey);
        }
        return result as PublicGalleryFeedResult<unknown>;
      }, (error) => {
        currentEntry.settled = true;
        approvedGalleryResponseCache.delete(cacheKey);
        throw error;
      });
    approvedGalleryResponseCache.set(cacheKey, currentEntry);
  }

  return consumeGalleryCacheEntry<T>(cacheKey, entry, signal);
}

export async function listApprovedGallerySubmissions(
  request: ApprovedGalleryPageRequest = {},
  signal?: AbortSignal,
): Promise<PublicGalleryFeedResult<ApprovedGalleryPage>> {
  const pageSize = Number.isSafeInteger(request.pageSize)
    ? Math.min(APPROVED_GALLERY_PAGE_SIZE, Math.max(1, Number(request.pageSize)))
    : APPROVED_GALLERY_PAGE_SIZE;
  const query = normalizeGalleryQuery(request.query);
  return requestApprovedGallery({
    body: {
      action: "list",
      pageSize,
      cursor: request.cursor || null,
      sort: request.sort === "oldest" ? "oldest" : "newest",
      category: request.category && request.category !== "all" ? request.category : null,
      query: query || null,
    },
    signal,
    parse: parseApprovedGalleryPage,
    unavailable: unavailableMessage,
  });
}

async function resolveApprovedGalleryAsset(
  action: "full" | "thumbnail",
  id: string,
  signal?: AbortSignal,
) {
  if (!uuidPattern.test(id)) throw new Error(action === "full" ? fullImageUnavailableMessage : thumbnailUnavailableMessage);
  const result = await requestApprovedGallery({
    body: { action, id },
    cacheCompleted: false,
    signal,
    parse: (value) => parseApprovedGalleryAsset(value, id, action === "full" ? "full_url" : "thumbnail_url"),
    unavailable: action === "full" ? fullImageUnavailableMessage : thumbnailUnavailableMessage,
  });
  if (!result.ok || !result.data) throw new Error(result.message || unavailableMessage);
  return result.data.mediaUrl;
}

export function resolveApprovedGalleryOriginal(id: string, signal?: AbortSignal) {
  return resolveApprovedGalleryAsset("full", id, signal);
}

export function refreshApprovedGalleryThumbnail(id: string, signal?: AbortSignal) {
  return resolveApprovedGalleryAsset("thumbnail", id, signal);
}
