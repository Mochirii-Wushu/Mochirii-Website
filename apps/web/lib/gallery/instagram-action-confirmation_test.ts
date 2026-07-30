import assert from "node:assert/strict";
import test from "node:test";
import {
  instagramPublishConfirmation,
  instagramReconciliationFingerprint,
  normalizeInstagramPostPermalink,
} from "./instagram-action-confirmation.ts";

const job = {
  id: "63333333-3333-4333-8333-333333333333",
  status: "queued",
  attemptCount: 0,
  updatedAt: "2026-07-29T12:34:56.123456+00:00",
};
const moderator = "61111111-1111-4111-8111-111111111111";

test("Instagram publication confirmation binds exact copy and queue revision", async () => {
  const armed = await instagramPublishConfirmation(job, moderator, "Caption", "Alt text");
  assert.notEqual(
    armed.confirmation_fingerprint,
    (await instagramPublishConfirmation(job, moderator, "Edited", "Alt text")).confirmation_fingerprint,
  );
  assert.notEqual(
    armed.confirmation_fingerprint,
    (await instagramPublishConfirmation({ ...job, attemptCount: 1 }, moderator, "Caption", "Alt text")).confirmation_fingerprint,
  );
});

test("Instagram reconciliation confirmation binds every inspected field", async () => {
  const draft = {
    resolution: "confirmed_published" as const,
    note: "Inspected official account",
    instagramMediaId: "123456789",
    instagramPermalink: "https://www.instagram.com/p/example/",
  };
  const armed = await instagramReconciliationFingerprint(job, draft);
  assert.notEqual(armed, await instagramReconciliationFingerprint(job, {
    ...draft,
    note: "Changed inspection",
  }));
  assert.notEqual(armed, await instagramReconciliationFingerprint({ ...job, updatedAt: "2026-07-29T12:34:57Z" }, draft));
});

test("Instagram permalink normalization accepts only canonical posts and reels", () => {
  assert.equal(
    normalizeInstagramPostPermalink("https://instagram.com/p/AbC_123/?tracking=x"),
    "https://www.instagram.com/p/AbC_123/",
  );
  assert.equal(
    normalizeInstagramPostPermalink("https://www.instagram.com/reel/Reel-123"),
    "https://www.instagram.com/reel/Reel-123/",
  );
  for (const value of [
    "http://www.instagram.com/p/example/",
    "https://user@www.instagram.com/p/example/",
    "https://www.instagram.com/p/example/#fragment",
    "https://m.instagram.com/p/example/",
  ]) assert.equal(normalizeInstagramPostPermalink(value), null);
});
