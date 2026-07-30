import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { siteUrl } from "./lib/public-urls.mjs";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  const full = path.join(root, relativePath);
  if (!existsSync(full)) {
    failures.push(`${relativePath}: missing required workflow QA file.`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function assertIncludes(label, text, snippet) {
  if (!text.includes(snippet)) failures.push(`${label}: expected snippet not found: ${snippet}`);
}

function assertNotIncludes(label, text, snippet) {
  if (text.includes(snippet)) failures.push(`${label}: unexpected retired snippet found: ${snippet}`);
}

function assertRegex(label, text, pattern, message) {
  if (!pattern.test(text)) failures.push(`${label}: ${message}`);
}

const packageJson = read("package.json");
const checkAll = read("scripts/check-all.mjs");
const runbook = read("docs/member-workflow-production-qa-runbook.md");
const profileGuide = read("docs/member-profiles-and-rank-roles.md");
const galleryGuide = read("docs/gallery-guide.md");
const supabaseReadme = read("supabase/README.md");
const supabaseConfig = read("supabase/config.toml");
const accountPanel = read("apps/web/components/member-workflow/AccountPanel.tsx");
const workflowState = read("apps/web/components/member-workflow/WorkflowState.tsx");
const memberWorkflowFormat = read("apps/web/components/member-workflow/format.ts");
const gallerySubmit = read("apps/web/components/member-workflow/GallerySubmitForm.tsx");
const leaderDashboard = read("apps/web/components/member-workflow/LeaderDashboard.tsx");
const memberProfilesClient = read("apps/web/lib/member-profiles/visible-profile-cards.ts");
const profileClient = read("apps/web/lib/supabase/profile.ts");
const memberProfileShared = read("supabase/functions/_shared/member-profiles.ts");
const listMemberProfiles = read("supabase/functions/list-member-profiles/index.ts");
const getMemberProfile = read("supabase/functions/get-member-profile/index.ts");
const visibleProfileCards = read("supabase/functions/list-visible-profile-cards/index.ts");
const approvedFeed = read("supabase/functions/list-approved-gallery-submissions/index.ts");
const approvedFeedShared = read("supabase/functions/_shared/gallery-public-feed.ts");
const migrationGallery = read("supabase/migrations/20260513081523_create_discord_role_gated_gallery_uploads.sql");
const migrationGalleryModeration = read("supabase/migrations/20260513195853_create_gallery_moderation_events.sql");
const migrationProfiles = read("supabase/migrations/20260608210000_add_member_profiles_and_media.sql");
const migrationRefine = read("supabase/migrations/20260608233000_refine_member_profile_identity_media.sql");
const migrationGalleryPublicationRevisions = read(
  "supabase/migrations/20260728132000_add_gallery_publication_revisions.sql",
);

const retiredFiles = [
  "apps/web/app/members/page.tsx",
  "apps/web/app/members/[slug]/page.tsx",
  "apps/web/components/member-workflow/MemberDirectory.tsx",
];

assertIncludes("package scripts", packageJson, '"check:member-workflow-qa": "node scripts/check-member-workflow-qa.mjs"');
assertIncludes("check-all", checkAll, '["check:member-workflow-qa", ["node", "scripts/check-member-workflow-qa.mjs"]]');

for (const file of retiredFiles) {
  if (existsSync(path.join(root, file))) failures.push(`${file}: retired members route surface must stay removed.`);
}

[
  "D02: Live OAuth And Account Smoke",
  "D03: Live Upload And Moderation Smoke",
  siteUrl("/auth"),
  "Pending content was not public before approval.",
  "Cleanup must not be ad hoc.",
  "Do not record:",
  "signed URLs",
].forEach((snippet) => assertIncludes("member workflow runbook", runbook, snippet));

[
  "Retired Member Profile Surface",
  "Discord handle is server-owned.",
  "bio of up to 1,000 characters",
  "shared backend identity data",
  "Mōchirīī Social",
].forEach((snippet) => assertIncludes("member profile guide", profileGuide, snippet));

[
  "The current static Gallery source has 73 images",
  "Approved member and Discord submissions are added at runtime",
  "All - 73",
  "Member Submissions",
].forEach((snippet) => assertIncludes("gallery guide", galleryGuide, snippet));

[
  "public.handle_new_member_profile()",
  "security definer",
  "member-gallery",
  "Approved submissions with a validated public derivative become eligible for the Gallery feed",
  "member profile publishing is retired",
  "shared backend identity data",
  "list-visible-profile-cards",
  "Bios are capped at 1,000 characters.",
].forEach((snippet) => assertIncludes("supabase readme", supabaseReadme, snippet));

[
  "[functions.list-member-profiles]",
  "verify_jwt = true",
  "[functions.get-member-profile]",
  "[functions.submit-member-profile-media]",
  "[functions.list-member-profile-media-queue]",
  "[functions.moderate-member-profile-media]",
  "[functions.list-visible-profile-cards]",
  "verify_jwt = false",
].forEach((snippet) => assertIncludes("supabase config", supabaseConfig, snippet));

assertRegex(
  "AccountPanel",
  accountPanel,
  /id="discord_handle_readonly"[\s\S]*?readOnly[\s\S]*?aria-readonly="true"[\s\S]*?Verified from Discord and not editable here\./,
  "Discord handle must remain read-only and server-derived on Account.",
);
assertRegex("AccountPanel", accountPanel, /id="bio"[\s\S]*?maxLength=\{1000\}[\s\S]*?\{bioLength\} \/ 1000 characters/, "Bio must stay capped at 1,000 characters with visible counter.");
assertIncludes("AccountPanel", accountPanel, "Open Mōchirīī Social");
assertIncludes("AccountPanel", accountPanel, "Leader Dashboard");
[
  "Published profiles are visible only to active verified members",
  "Published Page",
  "profile-media-upload",
  "View profile",
  "Shown on profile",
  "Show link",
].forEach((snippet) => assertNotIncludes("AccountPanel", accountPanel, snippet));

[
  "export function WorkflowNotice",
  "export function WorkflowEmptyState",
  'role = "status"',
  'role?: "status" | "alert";',
  'aria-live={role === "alert" ? "assertive" : "polite"}',
  'className="workflow-empty-state"',
].forEach((snippet) => assertIncludes("WorkflowState", workflowState, snippet));

[
  ["AccountPanel", accountPanel],
  ["GallerySubmitForm", gallerySubmit],
  ["LeaderDashboard", leaderDashboard],
].forEach(([label, source]) => {
  assertIncludes(label, source, "WorkflowNotice");
  assertIncludes(label, source, "WorkflowEmptyState");
  assertIncludes(label, source, "aria-busy=");
});

[
  'const gateTitle = mode === "signed-out" ? "Login Required" : allowed ? "Upload Ready" : "Member Verification Required";',
  "verifyMemberAccess({ refreshDiscord: refresh })",
  "profileIsActive(nextProfile, accessResult.data)",
].forEach((snippet) => assertIncludes("GallerySubmitForm", gallerySubmit, snippet));

[
  "listGalleryReviewQueue",
  "moderateGallerySubmission",
  "reviewMemberVerification",
].forEach((snippet) => assertIncludes("LeaderDashboard", leaderDashboard, snippet));
[
  "listProfileMediaQueue",
  "moderateProfileMedia",
  "Add a decline reason before rejecting this profile image.",
  "profileMediaStatusConfig",
].forEach((snippet) => assertNotIncludes("LeaderDashboard", leaderDashboard, snippet));

[
  'export const editableProfileFields = [',
  '"display_name"',
  '"game_uid"',
  '"region"',
  '"timezone"',
  '"bio"',
].forEach((snippet) => assertIncludes("member workflow format", memberWorkflowFormat, snippet));
if (memberWorkflowFormat.includes('"discord_handle"') || memberWorkflowFormat.includes('"avatar_url"')) {
  failures.push("member workflow format: editable profile fields must not include discord_handle or avatar_url.");
}

assertIncludes("member profile client", memberProfilesClient, "listVisibleProfileCards");
[
  "MAX_PROFILE_AVATAR_BYTES",
  "MAX_PROFILE_BANNER_BYTES",
  "MEMBER_PROFILE_MEDIA_BUCKET",
  "storagePath",
  "submit-member-profile-media",
  "list-member-profile-media-queue",
  "moderate-member-profile-media",
].forEach((snippet) => assertNotIncludes("member profile client", memberProfilesClient, snippet));

assertIncludes("profile client", profileClient, "updateCurrentProfile");
assertRegex("profile client", profileClient, /\.update\(\s*clean\s*\)/, "Profile updates must use the sanitized editable field payload.");

[
  'PROFILE_MEDIA_BUCKET = "member-profile-media"',
  "PROFILE_MEDIA_SIGNED_URL_SECONDS = 10 * 60",
  "avatar: 50 * 1024 * 1024",
  "banner: 50 * 1024 * 1024",
  "requireActiveMember",
  "titleFromRoles",
].forEach((snippet) => assertIncludes("member profile shared edge", memberProfileShared, snippet));

[
  "requireActiveMember(req)",
  "profile_public_enabled",
  "signedUrl",
].forEach((snippet) => assertIncludes("list member profiles", listMemberProfiles, snippet));

[
  "requireActiveMember(req)",
  "profile_public_enabled",
  "signedUrl",
].forEach((snippet) => assertIncludes("get member profile", getMemberProfile, snippet));

[
  "profile_cards_not_configured",
  "slugs",
  "hasApprovedAvatar",
  "profileHref: \"\"",
  "signedUrl",
].forEach((snippet) => assertIncludes("visible profile cards", visibleProfileCards, snippet));

[
  "GALLERY_PUBLIC_SCHEMA_VERSION",
  "isLegacyGalleryListRequest",
  'adminClient.rpc("gallery_reserve_public_delivery"',
  '"gallery_public_feed_page_v2"',
  '"gallery_reserve_public_media_v2"',
  "publicMediaUrl",
  "toPublicGalleryItem",
  "toLegacyGalleryItem",
  'delivery: "bounded-edge-media"',
].forEach((snippet) => assertIncludes("approved gallery feed", approvedFeed, snippet));

[
  "export const GALLERY_PUBLIC_SCHEMA_VERSION = 2;",
  "containsBearerCapability",
  "parseGalleryDatabasePage",
  "thumbnail_url: thumbnailUrl",
  "full_signed_url: safeFullUrl",
  "uploader_display_name: null",
].forEach((snippet) => assertIncludes("approved gallery feed shared contract", approvedFeedShared, snippet));

assertNotIncludes("approved gallery feed", approvedFeed, "createSignedUrls");
assertRegex(
  "approved Gallery v2 public item",
  approvedFeedShared,
  /export function toPublicGalleryItem\([\s\S]*?return \{(?:(?!storagePath|storageBucket|userId|full_signed_url|thumbnail_signed_url)[\s\S])*thumbnail_url: thumbnailUrl,[\s\S]*?^\}/m,
  "Gallery feed v2 must expose a bounded Edge thumbnail URL without private storage or member fields.",
);
assertRegex(
  "approved Gallery legacy compatibility item",
  approvedFeedShared,
  /export function toLegacyGalleryItem\([\s\S]*?return \{(?:(?!storagePath|storageBucket|userId)[\s\S])*full_signed_url: safeFullUrl,[\s\S]*?thumbnail_signed_url: thumbnailUrl,[\s\S]*?^\}/m,
  "The deferred Website UI compatibility DTO must use Edge media URLs without private storage or member fields.",
);

[
  "private.gallery_public_delivery_windows",
  "create or replace function public.gallery_reserve_public_delivery(",
  "daily_byte_limit constant bigint := 67108864;",
  "create or replace function public.gallery_public_feed_page_v2(",
  "interval '10 minutes'",
  "create function public.gallery_reserve_public_media_v2(",
  "interval '1 hour'",
  "from public, anon, authenticated;",
  "to service_role;",
].forEach((snippet) =>
  assertIncludes("approved Gallery reservation contract", migrationGalleryPublicationRevisions, snippet)
);

[
  "alter table public.member_profiles enable row level security;",
  "alter table public.gallery_submissions enable row level security;",
  "create or replace function public.handle_new_member_profile()",
  "security definer",
  "revoke all on function public.handle_new_member_profile() from public, anon, authenticated;",
].forEach((snippet) => assertIncludes("gallery/member migration", migrationGallery, snippet));

[
  "alter table public.gallery_moderation_events enable row level security;",
  "revoke all on table public.gallery_moderation_events from anon;",
  "revoke all on table public.gallery_moderation_events from authenticated;",
  "grant all on table public.gallery_moderation_events to service_role;",
].forEach((snippet) => assertIncludes("gallery moderation migration", migrationGalleryModeration, snippet));

[
  "member-profile-media",
  "alter table public.member_profile_media enable row level security;",
  "alter table public.member_profile_media_events enable row level security;",
  "grant all on table public.member_profile_media to service_role;",
].forEach((snippet) => assertIncludes("profile media migration", migrationProfiles, snippet));

[
  "char_length(bio) <= 1000",
  "revoke update (discord_handle, avatar_url) on table public.member_profiles from authenticated;",
  "52428800",
].forEach((snippet) => assertIncludes("profile refinement migration", migrationRefine, snippet));

if (failures.length) {
  console.error("Member workflow QA validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Member workflow QA validation OK.");
