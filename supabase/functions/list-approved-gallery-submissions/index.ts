import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  encodeGalleryCursor,
  GALLERY_PUBLIC_SCHEMA_VERSION,
  GalleryIsolateCircuitBreaker,
  GalleryIsolateEvidenceCache,
  galleryPublicListCacheKey,
  parseGalleryDatabasePage,
  parseGalleryDeliveryReservation,
  parseGalleryPublicRequest,
  safeGalleryText,
  toPublicGalleryItem,
} from "../_shared/gallery-public-feed.ts";
import { getServiceRoleKey } from "../_shared/supabase-service-role.ts";

type JsonRecord = Record<string, unknown>;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const MEMBER_GALLERY_BUCKET = "member-gallery";
const MAX_BODY_BYTES = 2048;
const publicFeedEvidenceCache = new GalleryIsolateEvidenceCache();
const publicFeedCircuitBreaker = new GalleryIsolateCircuitBreaker();

class GalleryPageLookupError extends Error {
  constructor(readonly safeCode: string) {
    super("gallery_page_lookup_failed");
    this.name = "GalleryPageLookupError";
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function jsonResponse(
  body: JsonRecord,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function publicMediaUrl(
  supabaseUrl: string,
  kind: "full" | "thumbnail",
  id: string,
): string {
  const url = new URL(
    "/functions/v1/list-approved-gallery-submissions",
    supabaseUrl,
  );
  url.searchParams.set("asset", kind);
  url.searchParams.set("id", id);
  return url.toString();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function reserveDelivery(
  requestReservation: () => PromiseLike<{
    data: unknown;
    error: { code?: string } | null;
  }>,
  kind: "list" | "full" | "thumbnail",
  reservedBytes: number,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const { data, error } = await requestReservation();
  const reservation = error ? null : parseGalleryDeliveryReservation(data);
  if (!reservation) {
    if (error) {
      console.error("list-approved-gallery-submissions delivery reservation failed", {
        code: error.code,
        mediaKind: kind,
      });
    }
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: "gallery_delivery_unavailable",
          message: "Member-submitted images are temporarily unavailable.",
        },
        503,
        { "Retry-After": "60" },
      ),
    };
  }

  if (!reservation.allowed) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: "gallery_delivery_limit_reached",
          message: "Member-submitted images are temporarily unavailable.",
        },
        429,
        { "Retry-After": String(reservation.retryAfterSeconds) },
      ),
    };
  }

  const dailyReservedBytes = reservation.dailyReservedBytes;
  const dailyLimitBytes = reservation.dailyLimitBytes;
  if (dailyLimitBytes > 0 && dailyReservedBytes * 5 >= dailyLimitBytes * 4) {
    console.warn("list-approved-gallery-submissions delivery budget warning", {
      mediaKind: kind,
      dailyReservedBytes,
      dailyLimitBytes,
    });
  }
  return { ok: true };
}

function safeInteger(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function safeFacets(value: unknown): JsonRecord {
  const facets = record(value);
  return Object.fromEntries(
    [
      "member-submissions",
      "portraits",
      "gatherings",
      "action",
      "scenery",
      "companions",
    ]
      .map((key) => [key, safeInteger(facets[key])]),
  );
}

async function readPayload(req: Request): Promise<JsonRecord | null> {
  const contentType = req.headers.get("content-type")?.split(";", 1)[0]
    .trim().toLowerCase();
  if (contentType !== "application/json") return null;

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return null;
  }

  try {
    if (!req.body) return {};
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel("request_too_large");
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return record(body ? JSON.parse(body) : {});
  } catch {
    return null;
  }
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({
      ok: false,
      error: "method_not_allowed",
      message: "Method not allowed.",
    }, 405);
  }

  const payload = req.method === "GET"
    ? (() => {
      const url = new URL(req.url);
      const asset = url.searchParams.get("asset");
      const keys = [...url.searchParams.keys()].sort().join(",");
      return {
        action: keys === "asset,id" && (asset === "full" || asset === "thumbnail")
          ? asset
          : "invalid",
        id: url.searchParams.get("id"),
      };
    })()
    : await readPayload(req);
  if (!payload) {
    return jsonResponse({
      ok: false,
      error: "invalid_request",
      message: "The Gallery request is invalid.",
    }, 400);
  }

  const requestResult = parseGalleryPublicRequest(payload);
  if (!requestResult.ok) {
    return jsonResponse({
      ok: false,
      error: requestResult.error,
      message: "The Gallery request is invalid.",
    }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "list-approved-gallery-submissions missing server configuration",
      {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceRoleKey: Boolean(serviceRoleKey),
      },
    );
    return jsonResponse({
      ok: false,
      error: "approved_gallery_not_configured",
      message: "Member-submitted images are temporarily unavailable.",
    }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const request = requestResult.request;

  if (request.action === "full" || request.action === "thumbnail") {
    const isThumbnail = request.action === "thumbnail";
    const { data: originalData, error: originalError } = await adminClient.rpc(
      "gallery_public_original_v2",
      { p_publication_id: request.id },
    );
    const original = record(originalData);
    const storageBucket = safeGalleryText(original.storageBucket, 80);
    const storagePath = safeGalleryText(
      isThumbnail ? original.thumbnailStoragePath : original.storagePath,
      1000,
    );
    const mediaType = safeGalleryText(
      isThumbnail ? original.thumbnailMimeType : original.mimeType,
      80,
    )?.toLowerCase();
    const mediaSize = safeInteger(
      isThumbnail ? original.thumbnailSizeBytes : original.sizeBytes,
    );
    const mediaSha256 = safeGalleryText(
      isThumbnail ? original.thumbnailSha256 : original.sha256,
      64,
    );
    const id = safeGalleryText(original.id, 80);
    if (
      originalError || !id || id !== request.id ||
      storageBucket !== MEMBER_GALLERY_BUCKET || !storagePath ||
      mediaType !== "image/webp" || mediaSize < 1 ||
      (isThumbnail ? mediaSize > 80 * 1024 : mediaSize > 2 * 1024 * 1024) ||
      !mediaSha256 || !/^[0-9a-f]{64}$/.test(mediaSha256)
    ) {
      if (originalError) {
        console.error(
          "list-approved-gallery-submissions eligible media lookup failed",
          {
            code: originalError.code,
            submissionId: request.id,
            mediaKind: request.action,
          },
        );
      }
      return jsonResponse({
        ok: false,
        error: isThumbnail
          ? "approved_thumbnail_unavailable"
          : "approved_original_unavailable",
        message: isThumbnail
          ? "The Gallery image is unavailable."
          : "The full image is unavailable.",
      }, 404);
    }

    const assetUrl = publicMediaUrl(supabaseUrl, request.action, request.id);
    if (req.method === "POST") return jsonResponse({
      ok: true,
      data: {
        schemaVersion: GALLERY_PUBLIC_SCHEMA_VERSION,
        id: request.id,
        [isThumbnail ? "thumbnail_url" : "full_url"]: assetUrl,
      },
      message: isThumbnail ? "Gallery image ready." : "Full image ready.",
    });

    const reservation = await reserveDelivery(
      () => adminClient.rpc("gallery_reserve_public_delivery", {
        p_delivery_kind: request.action,
        p_reserved_bytes: mediaSize,
      }),
      request.action,
      mediaSize,
    );
    if (!reservation.ok) return reservation.response;

    const { data: mediaBlob, error: mediaError } = await adminClient.storage
      .from(MEMBER_GALLERY_BUCKET)
      .download(storagePath);
    if (mediaError || !mediaBlob || mediaBlob.size !== mediaSize) {
      console.warn("list-approved-gallery-submissions media download failed", {
        submissionId: request.id,
        mediaKind: request.action,
        code: mediaError?.name || "media_size_mismatch",
      });
      return jsonResponse({
        ok: false,
        error: isThumbnail
          ? "approved_thumbnail_unavailable"
          : "approved_original_unavailable",
        message: isThumbnail
          ? "The Gallery image is unavailable."
          : "The full image is unavailable.",
      }, 503);
    }
    const mediaBytes = new Uint8Array(await mediaBlob.arrayBuffer());
    if (await sha256Hex(mediaBytes) !== mediaSha256) {
      console.error("list-approved-gallery-submissions media digest mismatch", {
        submissionId: request.id,
        mediaKind: request.action,
      });
      return jsonResponse({
        ok: false,
        error: "approved_media_integrity_failed",
        message: "The Gallery image is unavailable.",
      }, 503);
    }

    return new Response(mediaBytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "private, max-age=300, stale-while-revalidate=60",
        "Content-Length": String(mediaBytes.byteLength),
        "Content-Type": mediaType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const listReservation = await reserveDelivery(
    () => adminClient.rpc("gallery_reserve_public_delivery", {
      p_delivery_kind: "list",
      p_reserved_bytes: 65536,
    }),
    "list",
    65536,
  );
  if (!listReservation.ok) return listReservation.response;

  const cacheKey = galleryPublicListCacheKey(request);
  if (!cacheKey) {
    console.error("list-approved-gallery-submissions page lookup failed", {
      code: "missing_list_cache_key",
      contractValid: false,
    });
    return jsonResponse({
      ok: false,
      error: "approved_submission_lookup_failed",
      message: "Member-submitted images are temporarily unavailable.",
    }, 500);
  }

  let pageData: unknown;
  try {
    pageData = await publicFeedEvidenceCache.getOrLoad(
      cacheKey,
      async () => {
        const { data, error } = await adminClient.rpc(
          "gallery_public_feed_page_v2",
          {
            p_limit: request.pageSize,
            p_snapshot_at: request.cursor?.snapshotAt || null,
            p_after_reviewed_at: request.cursor?.reviewedAt || null,
            p_after_created_at: request.cursor?.createdAt || null,
            p_after_id: request.cursor?.id || null,
            p_sort: request.sort,
            p_category: request.category,
            p_query: request.query,
          },
        );
        const candidate = error ? null : parseGalleryDatabasePage(data);
        if (!candidate) {
          throw new GalleryPageLookupError(
            safeGalleryText(error?.code, 80) || "invalid_page_contract",
          );
        }
        return candidate;
      },
    );
  } catch (error) {
    console.error("list-approved-gallery-submissions page lookup failed", {
      code: error instanceof GalleryPageLookupError
        ? error.safeCode
        : "uncacheable_page_contract",
      contractValid: false,
    });
    return jsonResponse({
      ok: false,
      error: "approved_submission_lookup_failed",
      message: "Member-submitted images are temporarily unavailable.",
    }, 500);
  }
  const page = parseGalleryDatabasePage(pageData);
  if (!page || !Array.isArray(page.items)) {
    console.error("list-approved-gallery-submissions page lookup failed", {
      code: "uncacheable_page_contract",
      contractValid: false,
    });
    return jsonResponse({
      ok: false,
      error: "approved_submission_lookup_failed",
      message: "Member-submitted images are temporarily unavailable.",
    }, 500);
  }
  const rawPageItems = page.items;

  const databaseItems = rawPageItems.map(record);
  const items = [];
  for (const databaseItem of databaseItems) {
    const id = safeGalleryText(databaseItem.id, 80);
    const publicItem = id
      ? toPublicGalleryItem(
        databaseItem,
        publicMediaUrl(supabaseUrl, "thumbnail", id),
      )
      : null;
    if (!publicItem) {
      console.warn("list-approved-gallery-submissions page delivery failed", {
        itemCount: databaseItems.length,
      });
      return jsonResponse({
        ok: false,
        error: "approved_thumbnail_delivery_failed",
        message: "Member-submitted images are temporarily unavailable.",
      }, 503);
    }
    items.push(publicItem);
  }

  const unknownCategoryCount = safeInteger(page.unknownCategoryCount);
  if (unknownCategoryCount > 0) {
    console.warn(
      "list-approved-gallery-submissions found reviewed category corrections",
      {
        count: unknownCategoryCount,
      },
    );
  }

  const nextCursor = encodeGalleryCursor({
    ...record(page.nextCursor),
    sort: request.sort,
    category: request.category,
    query: request.query,
  });
  if (page.hasMore === true && !nextCursor) {
    console.warn("list-approved-gallery-submissions cursor creation failed", {
      itemCount: databaseItems.length,
    });
    return jsonResponse({
      ok: false,
      error: "approved_submission_page_unavailable",
      message: "Member-submitted images are temporarily unavailable.",
    }, 503);
  }

  return jsonResponse({
    ok: true,
    data: {
      schemaVersion: GALLERY_PUBLIC_SCHEMA_VERSION,
      items,
      count: items.length,
      totalEligible: safeInteger(page.totalEligible),
      facets: safeFacets(page.facets),
      hasMore: page.hasMore === true,
      nextCursor,
      partial: false,
      complete: page.hasMore !== true,
      deliveryFailures: 0,
      delivery: "bounded-edge-media",
      cacheSeconds: 15,
    },
    message: items.length
      ? "Member-submitted images loaded."
      : "No member-submitted images are available yet.",
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const permit = publicFeedCircuitBreaker.tryAcquire();
  if (!permit.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "gallery_temporarily_busy",
        message: "The Gallery is busy. Please try again shortly.",
      },
      429,
      { "Retry-After": String(permit.retryAfterSeconds) },
    );
  }

  try {
    return await handleRequest(req);
  } finally {
    permit.release();
  }
});
