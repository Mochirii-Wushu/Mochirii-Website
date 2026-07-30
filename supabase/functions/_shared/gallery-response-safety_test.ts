import {
  safeGalleryModerationConflict,
  safeGalleryModerationSubmission,
  safeGalleryModeratorProfile,
  safeGalleryPublishJob,
  safeInstagramPublishQueueItem,
  safeInstagramPublishResponse,
} from "./gallery-response-safety.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Gallery response helpers strip private paths and source evidence", () => {
  const safe = safeGalleryModerationSubmission({
    id: "submission-id",
    status: "approved",
    title: "Title",
    reviewed_at: "2026-07-29T00:00:00Z",
    storage_bucket: "member-gallery",
    storage_path: "member/private/source.jpg",
    source_sha256: "private-hash",
    source_storage_object_version: "private-version",
    instagram_opt_in: true,
  });
  const encoded = JSON.stringify(safe);
  assert(safe.id === "submission-id", "safe submission id was lost");
  assert(safe.instagramOptIn === true, "safe opt-in state was lost");
  assert(!encoded.includes("storage"), "storage reference reached the DTO");
  assert(!encoded.includes("hash"), "source hash reached the DTO");
  assert(!encoded.includes("version"), "source evidence reached the DTO");
});

Deno.test("Gallery response helpers strip provider identifiers, profile URLs, publication copy, and raw job fields", () => {
  const profile = safeGalleryModeratorProfile({
    display_name: "Member",
    discord_username: "member-name",
    discord_user_id: "123456789012345678",
    profile_url: "https://example.invalid/member",
  });
  const job = safeGalleryPublishJob({
    id: "job-id",
    submission_id: "submission-id",
    status: "queued",
    message: "Visit https://example.invalid/facebook",
    caption: "Visit www.example.invalid/instagram",
    alt_text: "example.invalid should not leave the provider queue",
    storage_path: "private/job.jpg",
    confirmation_fingerprint: "private-fingerprint",
    provider_response: "private-provider-response",
  });
  const encoded = JSON.stringify({ profile, job });
  assert(encoded.includes("member-name"), "safe profile label was lost");
  assert(encoded.includes("job-id"), "safe queue identifier was lost");
  assert(!encoded.includes("123456789012345678"), "provider id leaked");
  assert(!encoded.includes("private/job.jpg"), "private job path leaked");
  assert(!encoded.includes("fingerprint"), "confirmation evidence leaked");
  assert(!encoded.includes("provider-response"), "raw provider data leaked");
  assert(
    !encoded.includes("example.invalid"),
    "URL-bearing provider copy leaked",
  );
});

Deno.test("Instagram queue response uses an exact browser-safe top-level shape", () => {
  const safe = safeInstagramPublishQueueItem({
    id: "job-id",
    status: "reconcile_required",
    eligibilityReason: null,
    caption: "Reviewed caption",
    altText: "Reviewed alt text",
    instagramMediaId: "synthetic-stable-media-id",
    instagramPermalink: "https://www.instagram.com/p/synthetic/",
    attemptCount: 1,
    attemptStartedAt: "2026-07-29T00:00:00Z",
    publishedAt: null,
    createdAt: "2026-07-29T00:00:00Z",
    updatedAt: "2026-07-29T00:01:00Z",
    galleryPublicationId: "publication-id",
    thumbnailUrl: "https://project.supabase.co/functions/v1/gallery-thumbnail",
    previewError: null,
    submission: { id: "submission-id" },
    events: [],
    instagramContainerId: "synthetic-private-container-id",
    instagram_container_id: "synthetic-private-snake-container-id",
    containerId: "synthetic-private-alias-id",
    container_id: "synthetic-private-snake-alias-id",
    providerResponse: "synthetic-private-provider-response",
  });
  const expectedKeys = [
    "altText",
    "attemptCount",
    "attemptStartedAt",
    "caption",
    "createdAt",
    "eligibilityReason",
    "events",
    "galleryPublicationId",
    "id",
    "instagramMediaId",
    "instagramPermalink",
    "previewError",
    "publishedAt",
    "status",
    "submission",
    "thumbnailUrl",
    "updatedAt",
  ];
  assert(
    JSON.stringify(Object.keys(safe).sort()) === JSON.stringify(expectedKeys),
    "Instagram queue response shape drifted",
  );
  const encoded = JSON.stringify(safe);
  assert(
    encoded.includes("synthetic-stable-media-id"),
    "stable reconciliation media evidence was lost",
  );
  assert(
    !encoded.includes("private-container") &&
      !encoded.includes("private-alias") &&
      !encoded.includes("private-provider-response"),
    "private transient provider state reached the Instagram queue DTO",
  );
});

Deno.test("Instagram publish responses use exact caller-safe success and failure shapes", () => {
  const success = safeInstagramPublishResponse("job-id", {
    attempted: true,
    ok: true,
    status: "published",
    instagramContainerId: "synthetic-private-container-id",
    instagramMediaId: "synthetic-stable-media-id",
    instagramPermalink: "https://www.instagram.com/p/synthetic/",
    publishedAt: "2026-07-29T00:02:00Z",
    error: null,
    message: "Image published to @mochirii_guild.",
    job: { instagram_container_id: "synthetic-private-db-container-id" },
    details: { raw_provider_response: "synthetic-private-success-detail" },
  });
  const failure = safeInstagramPublishResponse("job-id", {
    attempted: true,
    ok: false,
    status: "reconcile_required",
    instagramContainerId: "synthetic-private-container-id",
    instagramMediaId: "synthetic-stable-media-id",
    instagramPermalink: null,
    publishedAt: null,
    error: "instagram_publish_reconcile_required",
    message: "Inspect the official account before any retry.",
    providerResponse: "synthetic-private-provider-response",
    details: { raw_provider_response: "synthetic-private-failure-detail" },
  });

  const expectedSuccess = {
    ok: true,
    data: {
      jobId: "job-id",
      status: "published",
      instagramMediaId: "synthetic-stable-media-id",
      instagramPermalink: "https://www.instagram.com/p/synthetic/",
      publishedAt: "2026-07-29T00:02:00Z",
    },
    message: "Image published to @mochirii_guild.",
  };
  const expectedFailure = {
    ok: false,
    error: "instagram_publish_reconcile_required",
    data: {
      jobId: "job-id",
      status: "reconcile_required",
      attempted: true,
      instagramMediaId: "synthetic-stable-media-id",
      instagramPermalink: null,
    },
    message: "Inspect the official account before any retry.",
  };
  assert(
    JSON.stringify(success) === JSON.stringify(expectedSuccess),
    "Instagram publish success response shape drifted",
  );
  assert(
    JSON.stringify(failure) === JSON.stringify(expectedFailure),
    "Instagram publish failure response shape drifted",
  );
  const encoded = JSON.stringify({ success, failure });
  assert(
    !encoded.includes("private-container") &&
      !encoded.includes("private-provider") &&
      !encoded.includes("private-success-detail") &&
      !encoded.includes("private-failure-detail"),
    "private transient provider state reached an Instagram publish response",
  );
});

Deno.test("Gallery conflicts expose only reviewed categories", () => {
  assert(
    safeGalleryModerationConflict("submission_revision_conflict") ===
      "submission_revision_conflict",
    "reviewed conflict was not preserved",
  );
  assert(
    safeGalleryModerationConflict("private database reason") ===
      "moderation_conflict",
    "raw database reason reached the public contract",
  );
});
