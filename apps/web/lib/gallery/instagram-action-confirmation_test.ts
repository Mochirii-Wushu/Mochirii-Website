import assert from "node:assert/strict";
import test from "node:test";
import {
  fingerprintInstagramAction,
  normalizeInstagramPostPermalink,
} from "./instagram-action-confirmation.ts";

const base = {
  jobId: "11111111-1111-4111-8111-111111111111",
  status: "queued",
  attemptCount: 0,
} as const;

test("Instagram publish confirmation fingerprints the exact normalized copy and job state", () => {
  const armed = fingerprintInstagramAction({
    ...base,
    action: "publish",
    caption: "  Approved caption  ",
    altText: "Approved alt text",
  });

  assert.equal(armed, fingerprintInstagramAction({
    ...base,
    action: "publish",
    caption: "Approved caption",
    altText: "Approved alt text",
  }));
  assert.notEqual(armed, fingerprintInstagramAction({
    ...base,
    action: "publish",
    caption: "Changed caption",
    altText: "Approved alt text",
  }));
  assert.notEqual(armed, fingerprintInstagramAction({
    ...base,
    action: "publish",
    caption: "Approved caption",
    altText: "Changed alt text",
  }));
  assert.notEqual(armed, fingerprintInstagramAction({
    ...base,
    status: "failed",
    action: "publish",
    caption: "Approved caption",
    altText: "Approved alt text",
  }));
});

test("reconciliation evidence accepts and normalizes only canonical Instagram posts or reels", () => {
  assert.equal(
    normalizeInstagramPostPermalink("https://instagram.com/p/AbC_123/?igsh=tracking"),
    "https://www.instagram.com/p/AbC_123/",
  );
  assert.equal(
    normalizeInstagramPostPermalink("https://www.instagram.com/reel/Reel-123"),
    "https://www.instagram.com/reel/Reel-123/",
  );

  for (const invalid of [
    "http://www.instagram.com/p/example/",
    "https://user@www.instagram.com/p/example/",
    "https://www.instagram.com/p/example/#fragment",
    "https://m.instagram.com/p/example/",
    "https://www.instagram.com/stories/example/123/",
    "https://www.instagram.com/p/example/extra/",
    "https://instagram.example/p/example/",
  ]) {
    assert.equal(normalizeInstagramPostPermalink(invalid), null, invalid);
  }
});

test("reconciliation confirmation fingerprints resolution and every evidence field", () => {
  const armed = fingerprintInstagramAction({
    ...base,
    status: "reconcile_required",
    action: "reconcile-published",
    mediaId: "123456789",
    permalink: "https://www.instagram.com/p/example/",
    note: "Matched the official account post",
  });

  for (const changed of [
    { action: "reconcile-not-published" as const },
    { mediaId: "987654321" },
    { permalink: "https://www.instagram.com/p/changed/" },
    { note: "Changed evidence note" },
    { attemptCount: 1 },
  ]) {
    assert.notEqual(armed, fingerprintInstagramAction({
      ...base,
      status: "reconcile_required",
      action: "reconcile-published",
      mediaId: "123456789",
      permalink: "https://www.instagram.com/p/example/",
      note: "Matched the official account post",
      ...changed,
    }));
  }
});
