import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchWithGalleryTimeout,
  galleryItemCategories,
  isGalleryFilter,
  listApprovedGallerySubmissions,
  loadApprovedGalleryOriginal,
  normalizeGalleryQuery,
  normalizedGallerySlug,
  parseApprovedGalleryPage,
  refreshApprovedGalleryThumbnail,
  resolveApprovedGalleryOriginal,
} from "./approved-feed.ts";

const submissionId = "10000000-0000-4000-8000-000000000001";
const mediaOrigin = "https://deyvmtncimmcinldjyqe.supabase.co";

function mediaUrl(kind: "full" | "thumbnail", id = submissionId) {
  return `${mediaOrigin}/functions/v1/list-approved-gallery-submissions?asset=${kind}&id=${id}`;
}

function validItem() {
  return {
    id: submissionId,
    title: "Cloud terrace",
    caption: "Members gather above the valley.",
    category: "gatherings",
    categories: ["member-submissions", "gatherings"],
    mime_type: "image/webp",
    size_bytes: 123_456,
    created_at: "2026-07-27T12:00:00.000Z",
    reviewed_at: "2026-07-28T12:00:00.000Z",
    thumbnail_url: mediaUrl("thumbnail"),
    thumbnail_size_bytes: 42_000,
    thumbnail_width: 720,
    thumbnail_height: 450,
  };
}

function validPage() {
  return {
    schemaVersion: 2,
    items: [validItem()],
    count: 1,
    totalEligible: 31,
    facets: {
      "member-submissions": 31,
      portraits: 3,
      gatherings: 9,
      action: 7,
      scenery: 6,
      companions: 5,
    },
    hasMore: true,
    nextCursor: "ZXhhbXBsZV9jdXJzb3I",
    partial: false,
    complete: false,
    deliveryFailures: 0,
    delivery: "bounded-edge-media",
    cacheSeconds: 15,
  };
}

test("the self-contained Gallery category contract normalizes bounded public state", () => {
  assert.equal(normalizedGallerySlug("  Member Submissions  "), "member-submissions");
  assert.equal(isGalleryFilter(" Portraits "), true);
  assert.equal(isGalleryFilter("not-a-category"), false);
  assert.deepEqual(
    galleryItemCategories([" GATHERINGS ", "member-submissions", "gatherings", "unknown"]),
    ["gatherings", "member-submissions"],
  );
  assert.equal(normalizeGalleryQuery(`  ${"x".repeat(100)}  `).length, 80);
});

test("the Gallery page parser accepts the strict schema-v2 public DTO", () => {
  const parsed = parseApprovedGalleryPage(validPage());
  assert.equal(parsed?.schemaVersion, 2);
  assert.equal(parsed?.items[0]?.thumbnail_width, 720);
  assert.deepEqual(parsed?.items[0]?.categories, ["member-submissions", "gatherings"]);
  assert.equal(parsed?.facets.gatherings, 9);
});

test("malformed or expanded item DTOs fail closed", () => {
  const leaked = validPage();
  leaked.items = [{ ...validItem(), storage_path: "private/original.png" } as ReturnType<typeof validItem>];
  assert.equal(parseApprovedGalleryPage(leaked), null);

  const leakedIdentity = validPage();
  leakedIdentity.items = [{ ...validItem(), uploader_display_name: "Private Member" } as ReturnType<typeof validItem>];
  assert.equal(parseApprovedGalleryPage(leakedIdentity), null);

  const invalidGeometry = validPage();
  invalidGeometry.items[0].thumbnail_width = 721;
  assert.equal(parseApprovedGalleryPage(invalidGeometry), null);

  const missingAggregate = validPage();
  missingAggregate.items[0].categories = ["gatherings"];
  assert.equal(parseApprovedGalleryPage(missingAggregate), null);

  const duplicateIds = validPage();
  duplicateIds.items = [validItem(), validItem()];
  duplicateIds.count = 2;
  assert.equal(parseApprovedGalleryPage(duplicateIds), null);

  const invalidDisplay = validPage();
  invalidDisplay.items[0].mime_type = "image/jpeg";
  assert.equal(parseApprovedGalleryPage(invalidDisplay), null);

  const unclassified = validPage();
  unclassified.items[0].category = "";
  assert.equal(parseApprovedGalleryPage(unclassified), null);
});

test("cursor, totals, and partial delivery invariants fail closed", () => {
  assert.equal(parseApprovedGalleryPage({ ...validPage(), nextCursor: null }), null);
  assert.equal(parseApprovedGalleryPage({ ...validPage(), totalEligible: 0 }), null);
  assert.equal(parseApprovedGalleryPage({ ...validPage(), partial: true, deliveryFailures: 0 }), null);
  assert.equal(parseApprovedGalleryPage({ ...validPage(), partial: true, deliveryFailures: 1 }), null);
  assert.equal(parseApprovedGalleryPage({ ...validPage(), complete: true }), null);

  const finalPage = { ...validPage(), hasMore: false, nextCursor: null, complete: true };
  delete (finalPage as Partial<typeof finalPage>).nextCursor;
  assert.equal(parseApprovedGalleryPage(finalPage), null);
});

test("asset resolvers derive only the exact credential-free media URL", async () => {
  assert.equal(await resolveApprovedGalleryOriginal(submissionId), mediaUrl("full"));
  assert.equal(await refreshApprovedGalleryThumbnail(submissionId), mediaUrl("thumbnail"));
  await assert.rejects(
    resolveApprovedGalleryOriginal("not-a-publication-id"),
    /full image is unavailable/i,
  );

  const caller = new AbortController();
  caller.abort();
  await assert.rejects(
    refreshApprovedGalleryThumbnail(submissionId, caller.signal),
    { name: "AbortError" },
  );
});

test("public media stays pinned to the configured Supabase project", async () => {
  const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://outside.invalid";
    assert.equal(await resolveApprovedGalleryOriginal(submissionId), mediaUrl("full"));

    process.env.NEXT_PUBLIC_SUPABASE_URL = `${mediaOrigin}/unexpected/path`;
    assert.equal(await refreshApprovedGalleryThumbnail(submissionId), mediaUrl("thumbnail"));
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = original;
  }
});

test("only list requests use POST while media uses deterministic GET URLs", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{
    url: string;
    method: string | undefined;
    headers: Record<string, string>;
    cache: RequestCache | undefined;
    credentials: RequestCredentials | undefined;
    body: Record<string, unknown>;
  }> = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    requests.push({
      url: String(input),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      cache: init?.cache,
      credentials: init?.credentials,
      body,
    });
    const data = validPage();
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const page = await listApprovedGallerySubmissions({
      sort: "oldest",
      category: "gatherings",
      query: "  Cloud  ",
      cursor: "ZXhhbXBsZV9jdXJzb3I",
    });
    assert.equal(page.ok, true);
    assert.equal(await resolveApprovedGalleryOriginal(submissionId), mediaUrl("full"));
    assert.equal(await resolveApprovedGalleryOriginal(submissionId), mediaUrl("full"));
    assert.equal(await refreshApprovedGalleryThumbnail(submissionId), mediaUrl("thumbnail"));
    assert.deepEqual(requests.map((request) => request.body), [{
      action: "list",
      pageSize: 24,
      cursor: "ZXhhbXBsZV9jdXJzb3I",
      sort: "oldest",
      category: "gatherings",
      query: "Cloud",
    }]);
    for (const request of requests) {
      assert.equal(request.url, `${mediaOrigin}/functions/v1/list-approved-gallery-submissions`);
      assert.equal(request.method, "POST");
      assert.deepEqual(request.headers, { "content-type": "application/json" });
      assert.equal(request.cache, "no-store");
      assert.equal(request.credentials, "omit");
      assert.equal("authorization" in request.headers, false);
      assert.equal("apikey" in request.headers, false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("full-image loading uses an abortable credential-free bounded WebP request", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": "4",
      },
    });
  };

  try {
    const blob = await loadApprovedGalleryOriginal(submissionId);
    assert.equal(blob.type, "image/webp");
    assert.equal(blob.size, 4);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, mediaUrl("full"));
    assert.equal(requests[0].init.method, "GET");
    assert.equal(requests[0].init.credentials, "omit");
    assert.equal(requests[0].init.cache, "default");
    assert.ok(requests[0].init.signal instanceof AbortSignal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("full-image loading rejects unsafe responses without exposing response details", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    new Response("not webp", { status: 200, headers: { "Content-Type": "image/png" } }),
    new Response(new Uint8Array([1]), {
      status: 200,
      headers: { "Content-Type": "image/webp", "Content-Length": String(2 * 1024 * 1024 + 1) },
    }),
    new Response(new Uint8Array([1]), {
      status: 200,
      headers: { "Content-Type": "image/webp", "Content-Length": "2" },
    }),
  ];
  let responseIndex = 0;
  globalThis.fetch = async () => responses[responseIndex++];

  try {
    for (let index = 0; index < responses.length; index += 1) {
      await assert.rejects(
        loadApprovedGalleryOriginal(submissionId),
        (error: unknown) => error instanceof Error && error.message === "The full image is unavailable.",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("closing an approved full-image request propagates caller cancellation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input, init = {}) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })) as typeof fetch;

  try {
    const caller = new AbortController();
    const pending = loadApprovedGalleryOriginal(submissionId, caller.signal);
    caller.abort();
    await assert.rejects(pending, { name: "AbortError" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the internal timeout bounds a hung fetch and caller cancellation wins promptly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
  try {
    const startedAt = Date.now();
    await assert.rejects(
      fetchWithGalleryTimeout("https://example.test/hung", {}, undefined, 15),
      { name: "GalleryRequestTimeoutError" },
    );
    assert.ok(Date.now() - startedAt < 500);

    const caller = new AbortController();
    const pending = fetchWithGalleryTimeout("https://example.test/hung", {}, caller.signal, 500);
    caller.abort();
    await assert.rejects(pending, { name: "AbortError" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("identical in-flight and fresh list requests are deduplicated by request context", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify({ ok: true, data: validPage() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const request = { sort: "newest" as const, category: "portraits" as const, query: "Cache proof" };
    const [first, second] = await Promise.all([
      listApprovedGallerySubmissions(request),
      listApprovedGallerySubmissions(request),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(fetchCount, 1);
    assert.equal((await listApprovedGallerySubmissions(request)).ok, true);
    assert.equal(fetchCount, 1);

    assert.equal((await listApprovedGallerySubmissions({ ...request, cursor: "YW5vdGhlcl9wYWdl" })).ok, true);
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cached list responses honor the bounded public cache contract", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({
      ok: true,
      data: { ...validPage(), cacheSeconds: 1 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const request = { sort: "newest" as const, query: "Expiry proof" };
    assert.equal((await listApprovedGallerySubmissions(request)).ok, true);
    assert.equal((await listApprovedGallerySubmissions(request)).ok, true);
    assert.equal(fetchCount, 1);
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    assert.equal((await listApprovedGallerySubmissions(request)).ok, true);
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
