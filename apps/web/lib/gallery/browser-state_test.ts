import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeGalleryRouteState,
  orderGalleryPresentation,
  replaceGalleryThumbnail,
  stableGalleryMixSeed,
  type GalleryPresentationItem,
} from "./browser-state.ts";

function item(
  stableKey: string,
  sortTimestamp: number,
  runtimeOrder: number | null,
  stableSequence = sortTimestamp,
): GalleryPresentationItem {
  return {
    stableKey,
    sortTimestamp,
    runtimeOrder,
    stableSequence,
    originalIndex: runtimeOrder ?? stableSequence,
  };
}

test("route state is normalized identically for server records and browser parameters", () => {
  assert.deepEqual(normalizeGalleryRouteState({
    category: [" Portraits ", "ignored"],
    sort: " NEWEST ",
    q: "  Cloud terrace  ",
  }), {
    category: "portraits",
    sort: "newest",
    query: "Cloud terrace",
  });

  assert.deepEqual(normalizeGalleryRouteState(new URLSearchParams({
    category: "not-a-category",
    sort: "not-a-sort",
    q: "   ",
  })), {
    category: "all",
    sort: "random",
    query: "",
  });
});

test("the default mix appends runtime cards without moving painted static cards", () => {
  const staticItems = [item("static-a", 30, null), item("static-b", 20, null), item("static-c", 10, null)];
  const seed = stableGalleryMixSeed(staticItems);
  const before = orderGalleryPresentation({
    staticItems,
    runtimeItems: [],
    sort: "random",
    randomSeed: seed,
    runtimeHasMore: false,
  });
  const after = orderGalleryPresentation({
    staticItems,
    runtimeItems: [item("runtime-a", 40, 0), item("runtime-b", 35, 1)],
    sort: "random",
    randomSeed: seed,
    runtimeHasMore: true,
  });

  assert.deepEqual(after.slice(0, before.length).map(({ stableKey }) => stableKey), before.map(({ stableKey }) => stableKey));
  assert.deepEqual(after.slice(before.length).map(({ stableKey }) => stableKey), ["runtime-a", "runtime-b"]);
});

test("a refreshed thumbnail updates the shared item used by the grid and viewer", () => {
  const items = [
    { approvedSubmissionId: "publication-a", src: "old-a", thumb: "old-a", caption: "A" },
    { approvedSubmissionId: "publication-b", src: "old-b", thumb: "old-b", caption: "B" },
  ];
  const refreshed = replaceGalleryThumbnail(items, "publication-a", "fresh-a");
  assert.notEqual(refreshed, items);
  assert.deepEqual(refreshed[0], {
    approvedSubmissionId: "publication-a",
    src: "fresh-a",
    thumb: "fresh-a",
    caption: "A",
  });
  assert.equal(refreshed[1], items[1]);
  assert.equal(replaceGalleryThumbnail(refreshed, "publication-a", "fresh-a"), refreshed);
});

test("chronological views expose only the prefix proven safe by the runtime cursor", () => {
  const staticItems = [item("static-300", 300, null), item("static-150", 150, null), item("static-50", 50, null)];
  const firstRuntimePage = [item("runtime-250", 250, 0), item("runtime-100", 100, 1)];
  const first = orderGalleryPresentation({
    staticItems,
    runtimeItems: firstRuntimePage,
    sort: "newest",
    randomSeed: 1,
    runtimeHasMore: true,
  });
  assert.deepEqual(first.map(({ stableKey }) => stableKey), [
    "static-300",
    "runtime-250",
    "static-150",
    "runtime-100",
  ]);

  const complete = orderGalleryPresentation({
    staticItems,
    runtimeItems: [...firstRuntimePage, item("runtime-25", 25, 2)],
    sort: "newest",
    randomSeed: 1,
    runtimeHasMore: false,
  });
  assert.deepEqual(complete.map(({ stableKey }) => stableKey), [
    "static-300",
    "runtime-250",
    "static-150",
    "runtime-100",
    "static-50",
    "runtime-25",
  ]);
  assert.deepEqual(complete.slice(0, first.length).map(({ stableKey }) => stableKey), first.map(({ stableKey }) => stableKey));
});

test("oldest-first also withholds static cards beyond the runtime boundary", () => {
  const ordered = orderGalleryPresentation({
    staticItems: [item("static-50", 50, null), item("static-150", 150, null), item("static-300", 300, null)],
    runtimeItems: [item("runtime-100", 100, 0), item("runtime-250", 250, 1)],
    sort: "oldest",
    randomSeed: 1,
    runtimeHasMore: true,
  });
  assert.deepEqual(ordered.map(({ stableKey }) => stableKey), [
    "static-50",
    "runtime-100",
    "static-150",
    "runtime-250",
  ]);
});

test("runtime keyset order remains stable when timestamps tie", () => {
  const ordered = orderGalleryPresentation({
    staticItems: [item("static", 100, null)],
    runtimeItems: [item("runtime-first", 100, 0), item("runtime-second", 100, 1)],
    sort: "oldest",
    randomSeed: 1,
    runtimeHasMore: true,
  });
  assert.deepEqual(ordered.map(({ stableKey }) => stableKey), ["static", "runtime-first", "runtime-second"]);
});
