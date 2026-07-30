import {
  safeGalleryModerationConflict,
  safeGalleryModerationSubmission,
  safeGalleryModeratorProfile,
  safeGalleryPublishJob,
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
