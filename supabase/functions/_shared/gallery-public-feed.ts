export const GALLERY_PUBLIC_SCHEMA_VERSION = 2;
export const GALLERY_PUBLIC_PAGE_SIZE = 24;
export const GALLERY_PUBLIC_MAX_QUERY_LENGTH = 80;
export const GALLERY_CURSOR_MAX_AGE_MS = 10 * 60 * 1000;
export const GALLERY_PUBLIC_EVIDENCE_CACHE_TTL_MS = 15 * 1000;
export const GALLERY_PUBLIC_EVIDENCE_CACHE_MAX_ENTRIES = 32;
export const GALLERY_PUBLIC_CIRCUIT_BURST = 48;
export const GALLERY_PUBLIC_CIRCUIT_REFILL_PER_SECOND = 2;
export const GALLERY_PUBLIC_CIRCUIT_MAX_CONCURRENT = 12;
const GALLERY_CURSOR_CLOCK_SKEW_MS = 30 * 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonicalCategories = new Set([
  "portraits",
  "gatherings",
  "action",
  "scenery",
  "companions",
  "member-submissions",
]);
const publicationCategories = new Set([
  "portraits",
  "gatherings",
  "action",
  "scenery",
  "companions",
]);
const sortModes = new Set(["newest", "oldest"]);

type JsonRecord = Record<string, unknown>;

export type GalleryFeedCursor = {
  v: 2;
  snapshotAt: string;
  reviewedAt: string;
  createdAt: string;
  id: string;
  sort: "newest" | "oldest";
  category: string | null;
  query: string | null;
};

export type GalleryPublicRequest =
  | {
    action: "list";
    pageSize: number;
    cursor: GalleryFeedCursor | null;
    sort: "newest" | "oldest";
    category: string | null;
    query: string | null;
  }
  | {
    action: "full";
    id: string;
  }
  | {
    action: "thumbnail";
    id: string;
  };

export type GalleryPublicRequestResult =
  | { ok: true; request: GalleryPublicRequest }
  | { ok: false; error: string };

type GalleryDeliveryReservationFields = {
  retryAfterSeconds: number;
  dailyReservedBytes: number;
  dailyLimitBytes: number;
};

export type GalleryDeliveryAllowedReservation =
  & GalleryDeliveryReservationFields
  & { allowed: true };
export type GalleryDeliveryDeniedReservation =
  & GalleryDeliveryReservationFields
  & { allowed: false };
export type GalleryDeliveryReservation =
  | GalleryDeliveryAllowedReservation
  | GalleryDeliveryDeniedReservation;

export type GalleryMediaReservation = GalleryDeliveryReservationFields & {
  allowed: true;
  id: string;
  storageBucket: "member-gallery";
  storagePath: string;
  mimeType: "image/webp";
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
};

type GalleryEvidenceCacheEntry = {
  promise: Promise<unknown>;
  expiresAt: number | null;
};

export type GalleryCircuitBreakerPermit =
  | { ok: true; release: () => void }
  | { ok: false; retryAfterSeconds: number };

export class GalleryEvidenceNotCacheableError extends Error {
  constructor() {
    super("gallery_evidence_not_cacheable");
    this.name = "GalleryEvidenceNotCacheableError";
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function containsBearerCapability(value: unknown): boolean {
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();
  let visitedNodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    visitedNodes += 1;
    if (visitedNodes > 1_000) return true;

    if (typeof current === "string") {
      if (
        /\/storage\/v1\/object\/sign\//i.test(current) ||
        /[?&](?:token|signature|x-amz-signature)=/i.test(current)
      ) return true;
      continue;
    }
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) return true;
    visited.add(current);

    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }

    for (const [key, nested] of Object.entries(current)) {
      if (/(?:signed|token|secret|authorization)/i.test(key)) return true;
      pending.push(nested);
    }
  }

  return false;
}

export function isUnsignedGalleryPageEvidence(value: unknown): boolean {
  const page = record(value);
  return safeIntegerForEvidence(page.schemaVersion) ===
      GALLERY_PUBLIC_SCHEMA_VERSION &&
    Array.isArray(page.items) &&
    page.items.length <= GALLERY_PUBLIC_PAGE_SIZE &&
    page.items.every((item) =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    ) &&
    !containsBearerCapability(page);
}

function safeIntegerForEvidence(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function parseGalleryDeliveryReservation(
  value: unknown,
): GalleryDeliveryReservation | null {
  const reservation = record(value);
  const keys = [
    "allowed",
    "retryAfterSeconds",
    "dailyReservedBytes",
    "dailyLimitBytes",
  ];
  if (
    Object.keys(reservation).length !== keys.length ||
    keys.some((key) => !(key in reservation)) ||
    typeof reservation.allowed !== "boolean"
  ) return null;
  const retryAfterSeconds = safeIntegerForEvidence(
    reservation.retryAfterSeconds,
  );
  const dailyReservedBytes = safeIntegerForEvidence(
    reservation.dailyReservedBytes,
  );
  const dailyLimitBytes = safeIntegerForEvidence(reservation.dailyLimitBytes);
  if (
    retryAfterSeconds === null || dailyReservedBytes === null ||
    dailyLimitBytes === null || dailyLimitBytes < 1 ||
    dailyReservedBytes > dailyLimitBytes ||
    (reservation.allowed ? retryAfterSeconds !== 0 : retryAfterSeconds < 1)
  ) return null;
  return reservation.allowed
    ? {
      allowed: true,
      retryAfterSeconds,
      dailyReservedBytes,
      dailyLimitBytes,
    }
    : {
      allowed: false,
      retryAfterSeconds,
      dailyReservedBytes,
      dailyLimitBytes,
    };
}

export function parseGalleryMediaReservation(
  value: unknown,
  expectedId: string,
  kind: "full" | "thumbnail",
): GalleryMediaReservation | GalleryDeliveryDeniedReservation | null {
  const media = record(value);
  const reservationKeys = [
    "allowed",
    "retryAfterSeconds",
    "dailyReservedBytes",
    "dailyLimitBytes",
  ];
  const mediaKeys = [
    ...reservationKeys,
    "id",
    "storageBucket",
    "storagePath",
    "mimeType",
    "sizeBytes",
    "width",
    "height",
    "sha256",
  ];
  const reservation = {
    allowed: media.allowed,
    retryAfterSeconds: media.retryAfterSeconds,
    dailyReservedBytes: media.dailyReservedBytes,
    dailyLimitBytes: media.dailyLimitBytes,
  };
  const parsedReservation = parseGalleryDeliveryReservation(reservation);
  if (!parsedReservation) return null;
  if (!parsedReservation.allowed) {
    return Object.keys(media).length === reservationKeys.length &&
        reservationKeys.every((key) => key in media)
      ? parsedReservation
      : null;
  }
  if (
    Object.keys(media).length !== mediaKeys.length ||
    mediaKeys.some((key) => !(key in media))
  ) return null;

  const id = safeGalleryText(media.id, 80);
  const storageBucket = safeGalleryText(media.storageBucket, 80);
  const storagePath = safeGalleryText(media.storagePath, 1000);
  const mimeType = safeGalleryText(media.mimeType, 80)?.toLowerCase();
  const sizeBytes = safeIntegerForEvidence(media.sizeBytes);
  const width = safeIntegerForEvidence(media.width);
  const height = safeIntegerForEvidence(media.height);
  const sha256 = safeGalleryText(media.sha256, 64);
  const maximumBytes = kind === "thumbnail" ? 80 * 1024 : 2 * 1024 * 1024;
  const maximumDimension = kind === "thumbnail" ? 720 : 2560;
  if (
    !id || id !== expectedId || !UUID_RE.test(id) ||
    storageBucket !== "member-gallery" || !storagePath ||
    mimeType !== "image/webp" || sizeBytes === null || sizeBytes < 1 ||
    sizeBytes > maximumBytes || width === null || width < 1 ||
    width > maximumDimension || height === null || height < 1 ||
    height > maximumDimension || !sha256 || !/^[0-9a-f]{64}$/.test(sha256)
  ) return null;

  return {
    ...parsedReservation,
    id,
    storageBucket,
    storagePath,
    mimeType,
    sizeBytes,
    width,
    height,
    sha256,
  };
}

export function galleryPublicListCacheKey(
  request: GalleryPublicRequest,
): string | null {
  if (request.action !== "list") return null;
  return JSON.stringify({
    v: GALLERY_PUBLIC_SCHEMA_VERSION,
    pageSize: request.pageSize,
    sort: request.sort,
    category: request.category,
    query: request.query,
    cursor: request.cursor
      ? {
        snapshotAt: request.cursor.snapshotAt,
        reviewedAt: request.cursor.reviewedAt,
        createdAt: request.cursor.createdAt,
        id: request.cursor.id,
      }
      : null,
  });
}

export class GalleryIsolateEvidenceCache {
  private readonly entries = new Map<string, GalleryEvidenceCacheEntry>();
  private lastObservedAt: number;

  constructor(
    private readonly options: {
      maxEntries?: number;
      ttlMs?: number;
      now?: () => number;
    } = {},
  ) {
    this.lastObservedAt = this.rawNow();
  }

  private rawNow(): number {
    return this.options.now?.() ?? Date.now();
  }

  private monotonicNow(): number {
    this.lastObservedAt = Math.max(this.lastObservedAt, this.rawNow());
    return this.lastObservedAt;
  }

  private get maxEntries(): number {
    return Math.max(
      1,
      Math.floor(
        this.options.maxEntries ??
          GALLERY_PUBLIC_EVIDENCE_CACHE_MAX_ENTRIES,
      ),
    );
  }

  private get ttlMs(): number {
    return Math.max(
      1,
      Math.floor(this.options.ttlMs ?? GALLERY_PUBLIC_EVIDENCE_CACHE_TTL_MS),
    );
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private makeRoom(): boolean {
    if (this.entries.size < this.maxEntries) return true;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null) {
        this.entries.delete(key);
        return true;
      }
    }
    return false;
  }

  async getOrLoad(
    key: string,
    loader: () => Promise<unknown>,
  ): Promise<unknown> {
    const now = this.monotonicNow();
    this.prune(now);

    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return await existing.promise;
    }

    if (!this.makeRoom()) {
      const uncached = await loader();
      if (!isUnsignedGalleryPageEvidence(uncached)) {
        throw new GalleryEvidenceNotCacheableError();
      }
      return uncached;
    }

    const entry: GalleryEvidenceCacheEntry = {
      promise: Promise.resolve(undefined),
      expiresAt: null,
    };
    entry.promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (!isUnsignedGalleryPageEvidence(value)) {
          throw new GalleryEvidenceNotCacheableError();
        }
        entry.expiresAt = this.monotonicNow() + this.ttlMs;
        return value;
      })
      .catch((error) => {
        if (this.entries.get(key) === entry) {
          this.entries.delete(key);
        }
        throw error;
      });
    this.entries.set(key, entry);
    return await entry.promise;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export class GalleryIsolateCircuitBreaker {
  private tokens: number;
  private active = 0;
  private lastRefillAt: number;

  constructor(
    private readonly options: {
      burst?: number;
      refillPerSecond?: number;
      maxConcurrent?: number;
      now?: () => number;
    } = {},
  ) {
    this.tokens = this.burst;
    this.lastRefillAt = this.now();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private get burst(): number {
    return Math.max(
      1,
      Math.floor(this.options.burst ?? GALLERY_PUBLIC_CIRCUIT_BURST),
    );
  }

  private get refillPerSecond(): number {
    return Math.max(
      0.001,
      this.options.refillPerSecond ??
        GALLERY_PUBLIC_CIRCUIT_REFILL_PER_SECOND,
    );
  }

  private get maxConcurrent(): number {
    return Math.max(
      1,
      Math.floor(
        this.options.maxConcurrent ?? GALLERY_PUBLIC_CIRCUIT_MAX_CONCURRENT,
      ),
    );
  }

  tryAcquire(): GalleryCircuitBreakerPermit {
    const now = this.now();
    if (now > this.lastRefillAt) {
      this.tokens = Math.min(
        this.burst,
        this.tokens +
          ((now - this.lastRefillAt) / 1_000) * this.refillPerSecond,
      );
      this.lastRefillAt = now;
    }

    if (this.active >= this.maxConcurrent) {
      return { ok: false, retryAfterSeconds: 1 };
    }
    if (this.tokens < 1) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((1 - this.tokens) / this.refillPerSecond),
        ),
      };
    }

    this.tokens -= 1;
    this.active += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.active = Math.max(0, this.active - 1);
      },
    };
  }
}

export function safeGalleryText(
  value: unknown,
  maxLength: number,
): string | null {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function validDate(value: unknown): string | null {
  const text = safeGalleryText(value, 80);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}

function decodeCursor(value: unknown): GalleryFeedCursor | null | undefined {
  const encoded = safeGalleryText(value, 1024);
  if (!encoded) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined;

  try {
    const decoded = JSON.parse(decodeBase64Url(encoded)) as unknown;
    const cursor = record(decoded);
    const version = Number(cursor.v);
    const snapshotAt = validDate(cursor.snapshotAt);
    const reviewedAt = validDate(cursor.reviewedAt);
    const createdAt = validDate(cursor.createdAt);
    const id = safeGalleryText(cursor.id, 80);
    const sort = safeGalleryText(cursor.sort, 20)?.toLowerCase();
    const category = safeGalleryText(cursor.category, 40)?.toLowerCase() ||
      null;
    const query = safeGalleryText(
      cursor.query,
      GALLERY_PUBLIC_MAX_QUERY_LENGTH + 1,
    );
    if (
      version !== GALLERY_PUBLIC_SCHEMA_VERSION || !snapshotAt || !reviewedAt ||
      !createdAt ||
      Date.parse(snapshotAt) > Date.now() + GALLERY_CURSOR_CLOCK_SKEW_MS ||
      Date.parse(snapshotAt) < Date.now() - GALLERY_CURSOR_MAX_AGE_MS ||
      !id || !UUID_RE.test(id) ||
      !sort || !sortModes.has(sort) ||
      !("category" in cursor) || !("query" in cursor) ||
      (category !== null && category !== "all" &&
        !canonicalCategories.has(category)) ||
      (query !== null && query.length > GALLERY_PUBLIC_MAX_QUERY_LENGTH)
    ) {
      return undefined;
    }
    return {
      v: 2,
      snapshotAt,
      reviewedAt,
      createdAt,
      id,
      sort: sort as "newest" | "oldest",
      category: category === "all" ? null : category,
      query,
    };
  } catch {
    return undefined;
  }
}

export function encodeGalleryCursor(value: unknown): string | null {
  const cursor = record(value);
  const snapshotAt = validDate(cursor.snapshotAt);
  const reviewedAt = validDate(cursor.reviewedAt);
  const createdAt = validDate(cursor.createdAt);
  const id = safeGalleryText(cursor.id, 80);
  const sort = safeGalleryText(cursor.sort, 20)?.toLowerCase();
  const category = safeGalleryText(cursor.category, 40)?.toLowerCase() || null;
  const query = safeGalleryText(
    cursor.query,
    GALLERY_PUBLIC_MAX_QUERY_LENGTH + 1,
  );
  if (
    !snapshotAt || !reviewedAt || !createdAt ||
    Date.parse(snapshotAt) > Date.now() + GALLERY_CURSOR_CLOCK_SKEW_MS ||
    Date.parse(snapshotAt) < Date.now() - GALLERY_CURSOR_MAX_AGE_MS ||
    !id || !UUID_RE.test(id) || !sort || !sortModes.has(sort) ||
    !("category" in cursor) || !("query" in cursor) ||
    (category !== null && category !== "all" &&
      !canonicalCategories.has(category)) ||
    (query !== null && query.length > GALLERY_PUBLIC_MAX_QUERY_LENGTH)
  ) return null;

  return encodeBase64Url(JSON.stringify({
    v: GALLERY_PUBLIC_SCHEMA_VERSION,
    snapshotAt,
    reviewedAt,
    createdAt,
    id,
    sort,
    category: category === "all" ? null : category,
    query,
  }));
}

export function parseGalleryPublicRequest(
  value: unknown,
): GalleryPublicRequestResult {
  const payload = record(value);
  const action = safeGalleryText(payload.action, 20)?.toLowerCase() || "list";

  if (action === "full" || action === "thumbnail") {
    const id = safeGalleryText(payload.id, 80);
    return id && UUID_RE.test(id)
      ? { ok: true, request: { action, id } }
      : { ok: false, error: "invalid_submission_id" };
  }

  if (action !== "list") return { ok: false, error: "invalid_action" };

  const rawPageSize = Number(payload.pageSize ?? GALLERY_PUBLIC_PAGE_SIZE);
  if (!Number.isSafeInteger(rawPageSize) || rawPageSize < 1) {
    return { ok: false, error: "invalid_page_size" };
  }
  const pageSize = Math.min(GALLERY_PUBLIC_PAGE_SIZE, rawPageSize);
  const sort = safeGalleryText(payload.sort, 20)?.toLowerCase() || "newest";
  if (!sortModes.has(sort)) return { ok: false, error: "invalid_sort" };

  const category = safeGalleryText(payload.category, 40)?.toLowerCase() || null;
  if (category && category !== "all" && !canonicalCategories.has(category)) {
    return { ok: false, error: "invalid_category" };
  }

  const query = safeGalleryText(
    payload.query,
    GALLERY_PUBLIC_MAX_QUERY_LENGTH + 1,
  );
  if (query && query.length > GALLERY_PUBLIC_MAX_QUERY_LENGTH) {
    return { ok: false, error: "query_too_long" };
  }

  const cursor = decodeCursor(payload.cursor);
  if (cursor === undefined) return { ok: false, error: "invalid_cursor" };
  if (
    cursor &&
    (cursor.sort !== sort ||
      cursor.category !== (category === "all" ? null : category) ||
      cursor.query !== query)
  ) {
    return { ok: false, error: "cursor_context_mismatch" };
  }

  return {
    ok: true,
    request: {
      action: "list",
      pageSize,
      cursor,
      sort: sort as "newest" | "oldest",
      category: category === "all" ? null : category,
      query,
    },
  };
}

export function isLegacyGalleryListRequest(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 0;
}

const databasePageKeys = new Set([
  "schemaVersion",
  "snapshotAt",
  "snapshotExpiresAt",
  "items",
  "hasMore",
  "nextCursor",
  "totalEligible",
  "facets",
  "unknownCategoryCount",
]);
const databaseItemKeys = new Set([
  "id",
  "title",
  "caption",
  "category",
  "categories",
  "mimeType",
  "sizeBytes",
  "createdAt",
  "reviewedAt",
  "thumbnailSizeBytes",
  "thumbnailWidth",
  "thumbnailHeight",
]);
const databaseFacetKeys = [
  "member-submissions",
  "portraits",
  "gatherings",
  "action",
  "scenery",
  "companions",
];

export function parseGalleryDatabasePage(value: unknown): JsonRecord | null {
  const page = record(value);
  if (
    Object.keys(page).length !== databasePageKeys.size ||
    Object.keys(page).some((key) => !databasePageKeys.has(key)) ||
    safeIntegerForEvidence(page.schemaVersion) !==
      GALLERY_PUBLIC_SCHEMA_VERSION ||
    !Array.isArray(page.items) ||
    page.items.length > GALLERY_PUBLIC_PAGE_SIZE ||
    typeof page.hasMore !== "boolean"
  ) return null;

  const snapshotAt = validDate(page.snapshotAt);
  const snapshotExpiresAt = validDate(page.snapshotExpiresAt);
  const snapshotMs = snapshotAt ? Date.parse(snapshotAt) : Number.NaN;
  const expiryMs = snapshotExpiresAt
    ? Date.parse(snapshotExpiresAt)
    : Number.NaN;
  if (!snapshotAt || !snapshotExpiresAt || expiryMs <= snapshotMs) return null;

  const totalEligible = safeIntegerForEvidence(page.totalEligible);
  const unknownCategoryCount = safeIntegerForEvidence(
    page.unknownCategoryCount,
  );
  if (
    totalEligible === null || totalEligible < page.items.length ||
    unknownCategoryCount !== 0
  ) return null;

  const facets = record(page.facets);
  if (
    Object.keys(facets).length !== databaseFacetKeys.length ||
    databaseFacetKeys.some((key) =>
      safeIntegerForEvidence(facets[key]) === null
    )
  ) return null;

  const itemsValid = page.items.every((value) => {
    const item = record(value);
    return Object.keys(item).length === databaseItemKeys.size &&
      Object.keys(item).every((key) => databaseItemKeys.has(key));
  });
  if (!itemsValid) return null;

  const cursor = page.nextCursor === null ? null : record(page.nextCursor);
  if (page.hasMore) {
    if (
      !cursor || Object.keys(cursor).length !== 4 ||
      !validDate(cursor.reviewedAt) || !validDate(cursor.createdAt) ||
      !validDate(cursor.snapshotAt) ||
      cursor.snapshotAt !== snapshotAt ||
      !safeGalleryText(cursor.id, 80) || !UUID_RE.test(String(cursor.id))
    ) return null;
  } else if (page.nextCursor !== null) {
    return null;
  }

  return page;
}

function safeCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return ["member-submissions"];
  const categories = value
    .map((item) => safeGalleryText(item, 40)?.toLowerCase() || "")
    .filter((item) => canonicalCategories.has(item));
  return [...new Set(["member-submissions", ...categories])];
}

export function toPublicGalleryItem(
  value: unknown,
  thumbnailUrl: string,
): JsonRecord | null {
  const item = record(value);
  const id = safeGalleryText(item.id, 80);
  const thumbnailSizeBytes = Number(item.thumbnailSizeBytes || 0);
  const thumbnailWidth = Number(item.thumbnailWidth || 0);
  const thumbnailHeight = Number(item.thumbnailHeight || 0);
  const displayMimeType = safeGalleryText(item.mimeType, 80)?.toLowerCase();
  const displaySizeBytes = Number(item.sizeBytes || 0);
  const createdAt = validDate(item.createdAt);
  const reviewedAt = validDate(item.reviewedAt);
  const category = safeGalleryText(item.category, 40)?.toLowerCase() || null;
  if (
    !id || !UUID_RE.test(id) || !thumbnailUrl ||
    displayMimeType !== "image/webp" ||
    !Number.isSafeInteger(displaySizeBytes) || displaySizeBytes < 1 ||
    displaySizeBytes > 2 * 1024 * 1024 ||
    !createdAt || !reviewedAt || !category ||
    !publicationCategories.has(category) ||
    !Number.isSafeInteger(thumbnailSizeBytes) || thumbnailSizeBytes < 1 ||
    thumbnailSizeBytes > 80 * 1024 ||
    !Number.isSafeInteger(thumbnailWidth) || thumbnailWidth < 1 ||
    thumbnailWidth > 720 ||
    !Number.isSafeInteger(thumbnailHeight) || thumbnailHeight < 1 ||
    thumbnailHeight > 720
  ) return null;

  return {
    id,
    title: safeGalleryText(item.title, 80),
    caption: safeGalleryText(item.caption, 300),
    category,
    categories: safeCategories(item.categories),
    mime_type: displayMimeType,
    size_bytes: displaySizeBytes,
    created_at: createdAt,
    reviewed_at: reviewedAt,
    thumbnail_url: thumbnailUrl,
    thumbnail_size_bytes: thumbnailSizeBytes,
    thumbnail_width: thumbnailWidth,
    thumbnail_height: thumbnailHeight,
  };
}

export function toLegacyGalleryItem(
  value: unknown,
  fullUrl: string,
): JsonRecord | null {
  const item = record(value);
  const id = safeGalleryText(item.id, 80);
  const thumbnailUrl = safeGalleryText(item.thumbnail_url, 4000);
  const safeFullUrl = safeGalleryText(fullUrl, 4000);
  const mimeType = safeGalleryText(item.mime_type, 80)?.toLowerCase();
  const sizeBytes = Number(item.size_bytes || 0);
  const thumbnailSizeBytes = Number(item.thumbnail_size_bytes || 0);
  const createdAt = validDate(item.created_at);
  const reviewedAt = validDate(item.reviewed_at);
  const category = safeGalleryText(item.category, 40)?.toLowerCase() || null;
  if (
    !id || !UUID_RE.test(id) || !thumbnailUrl || !safeFullUrl ||
    thumbnailUrl === safeFullUrl || mimeType !== "image/webp" ||
    !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 ||
    sizeBytes > 2 * 1024 * 1024 ||
    !Number.isSafeInteger(thumbnailSizeBytes) || thumbnailSizeBytes < 1 ||
    thumbnailSizeBytes > 80 * 1024 || !createdAt || !reviewedAt ||
    !category || !publicationCategories.has(category)
  ) return null;

  return {
    id,
    title: safeGalleryText(item.title, 80),
    caption: safeGalleryText(item.caption, 300),
    category,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    created_at: createdAt,
    reviewed_at: reviewedAt,
    uploader_display_name: null,
    uploader_discord_name: null,
    full_signed_url: safeFullUrl,
    thumbnail_signed_url: thumbnailUrl,
    thumbnail_size_bytes: thumbnailSizeBytes,
    preview_error: null,
  };
}
