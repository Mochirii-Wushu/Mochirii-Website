import { readFileSync } from "node:fs";
import { readAppCss } from "./lib/app-css.mjs";

const failures = [];

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertIncludes(label, text, snippet) {
  if (!text.includes(snippet)) failures.push(`${label}: expected snippet not found: ${snippet}`);
}

function assertNotIncludes(label, text, snippet) {
  if (text.includes(snippet)) failures.push(`${label}: forbidden snippet found: ${snippet}`);
}

const packageJson = read("package.json");
const checkAll = read("scripts/check-all.mjs");
const providerRegistry = read("apps/web/lib/supabase/auth-providers.ts");
const providerLogo = read("apps/web/components/member-workflow/ProviderLogo.tsx");
const authClient = read("apps/web/lib/supabase/auth.ts");
const profileClient = read("apps/web/lib/supabase/profile.ts");
const authPanel = read("apps/web/components/member-workflow/AuthPanel.tsx");
const accountPanel = read("apps/web/components/member-workflow/AccountPanel.tsx");
const nextCss = readAppCss();
const multiProviderDoc = read("docs/multi-provider-login-and-verification.md");
const supabaseReadme = read("supabase/README.md");
const gallerySubmit = read("apps/web/components/member-workflow/GallerySubmitForm.tsx");
const leaderDashboard = read("apps/web/components/member-workflow/LeaderDashboard.tsx");
const moderationClient = read("apps/web/lib/supabase/moderation.ts");
const supabaseConfig = read("supabase/config.toml");
const migration = read("supabase/migrations/20260615041842_add_multi_provider_member_verification.sql");
const verifyMemberAccess = read("supabase/functions/verify-member-access/index.ts");
const oauthDecisionRoute = read("apps/web/app/api/oauth/decision/route.ts");
const verifyDiscordMember = read("supabase/functions/verify-discord-member/index.ts");
const memberVerificationIdentity = read("supabase/functions/_shared/member-verification-identity.ts");
const memberVerificationIdentityTest = read("supabase/functions/_shared/member-verification-identity_test.ts");
const memberAccessPolicy = read("supabase/functions/_shared/member-access-policy.ts");
const supabaseServiceRole = read("supabase/functions/_shared/supabase-service-role.ts");
const supabaseServiceRoleTest = read("supabase/functions/_shared/supabase-service-role_test.ts");
const approvedGalleryFeed = read("supabase/functions/list-approved-gallery-submissions/index.ts");
const discordGalleryIngest = read("supabase/functions/submit-discord-gallery-image/index.ts");
const galleryModeration = read("supabase/functions/_shared/gallery-moderation.ts");
const reviewMemberVerification = read("supabase/functions/review-member-verification/index.ts");

[
  '"check:multi-provider-auth": "node scripts/check-multi-provider-auth.mjs"',
  '"test:member-verification-identity": "deno test --lock=deno.lock --frozen=true supabase/functions/_shared/member-verification-identity_test.ts"',
  '"test:supabase-service-role": "deno test --lock=deno.lock --frozen=true supabase/functions/_shared/supabase-service-role_test.ts"',
  '"test:member-access-refresh": "deno test --allow-env --node-modules-dir=auto --import-map=supabase/functions/verify-member-access/deno.json',
].forEach((snippet) => assertIncludes("package scripts", packageJson, snippet));

assertIncludes("check-all", checkAll, '["check:multi-provider-auth", ["node", "scripts/check-multi-provider-auth.mjs"]]');
assertIncludes("check-all", checkAll, '["test:member-verification-identity", ["deno", "test"');
assertIncludes("check-all", checkAll, '["test:supabase-service-role", ["deno", "test"');
assertIncludes("check-all", checkAll, '["test:member-access-refresh", ["deno", "test"');

[
  '"discord"',
  '"phone"',
  '"apple"',
  '"facebook"',
  '"google"',
  '"kakao"',
  'scopes: "profile_nickname profile_image"',
  '"twitch"',
  '"spotify"',
  'process.env.NEXT_PUBLIC_PHONE_AUTH_READY === "true"',
  'process.env.NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED === "true"',
  "NEXT_PUBLIC_AUTH_PROVIDER_PLACEHOLDER_IDS",
  'requestedProviderIds()',
  'requestedPlaceholderProviderIds()',
  'placeholderOAuthProviders',
].forEach((snippet) => assertIncludes("auth provider registry", providerRegistry, snippet));

[
  "provider-logo--${provider}",
  'provider === "discord"',
  'provider === "google"',
  'provider === "twitch"',
  'provider === "spotify"',
  'provider === "kakao"',
  'provider === "apple"',
  'provider === "facebook"',
  'provider === "phone"',
  "aria-hidden=\"true\"",
].forEach((snippet) => assertIncludes("provider logo component", providerLogo, snippet));

[
  "signInWithProvider",
  "signInWithPhoneOtp",
  "shouldCreateUser: false",
  "captchaToken: cleanCaptchaToken",
  "requirePhoneCaptchaToken",
  "verifyPhoneOtp",
  "linkProviderIdentity",
  "getLinkedIdentities",
  "signInWithDiscord",
].forEach((snippet) => assertIncludes("auth client", authClient, snippet));

[
  "verifyMemberAccess",
  "verify-member-access",
  "memberAccessIsApproved",
  "Member verification must be approved before continuing.",
].forEach((snippet) => assertIncludes("profile client", profileClient, snippet));

[
  "Choose a sign-in method",
  "provider-grid",
  "ProviderLogo",
  "signInWithProvider",
  "signInWithPhoneOtp",
  "AuthCaptcha",
  "readPhoneOtpResendDeadline",
  "verifyPhoneOtp",
  "placeholderOAuthProviders",
  "Setup pending",
].forEach((snippet) => assertIncludes("AuthPanel", authPanel, snippet));

[
  "Identity Linking",
  "linkProviderIdentity",
  "ProviderLogo",
  "refreshMemberAccess({ refreshDiscord: true })",
  "moderator-approved member verification",
  "placeholderOAuthProviders",
  "Setup pending",
].forEach((snippet) => assertIncludes("AccountPanel", accountPanel, snippet));

[
  "Manual Linking",
  "security_manual_linking_enabled",
].forEach((snippet) => {
  assertIncludes("multi-provider docs", multiProviderDoc, snippet);
  assertIncludes("Supabase README", supabaseReadme, snippet);
});

[
  ".provider-logo",
  ".provider-logo--discord",
  ".provider-logo--google",
  ".provider-button--placeholder",
  ".provider-button__copy",
].forEach((snippet) => assertIncludes("Next auth CSS", nextCss, snippet));

[
  "Member Verification Required",
  "verifyMemberAccess({ refreshDiscord: refresh })",
  "profileIsActive(nextProfile, accessResult.data)",
  "moderator-approved member verification",
].forEach((snippet) => assertIncludes("GallerySubmitForm", gallerySubmit, snippet));

[
  "reviewMemberVerification",
  "review-member-verification",
].forEach((snippet) => assertIncludes("moderation client", moderationClient, snippet));

[
  "reviewMemberVerification",
  "memberVerificationPanel",
  "Review Gallery Access",
  "Approve access",
  "Reject",
  "Revoke",
  "redacted note",
].forEach((snippet) => assertIncludes("LeaderDashboard", leaderDashboard, snippet));

[
  "[functions.verify-member-access]",
  "verify_jwt = true",
  "[functions.review-member-verification]",
].forEach((snippet) => assertIncludes("supabase config", supabaseConfig, snippet));

[
  "create table if not exists public.member_auth_identities",
  "create table if not exists public.member_verifications",
  "alter table public.member_auth_identities enable row level security;",
  "alter table public.member_verifications enable row level security;",
  "revoke all on table public.member_auth_identities from public, anon, authenticated;",
  "revoke all on table public.member_verifications from public, anon, authenticated;",
  "grant usage on schema private to authenticated, service_role;",
  "create or replace function private.member_has_gallery_upload_access",
  "security definer",
  "private.member_has_gallery_upload_access((select auth.uid()))",
  "'approved'",
  "'revoked'",
  "'expired'",
].forEach((snippet) => assertIncludes("multi-provider migration", migration, snippet));

[
  "APPROVED_PROVIDER_IDS",
  "syncIdentities",
  "member_auth_identities",
  "member_verifications",
  "updateDiscordProfile",
  "provider_email_verified",
  "provider_phone_verified",
  "galleryEligible",
  "const profileQuery =",
  "const verificationQuery =",
  "const identityQuery =",
  "await Promise.all([profileQuery, verificationQuery, identityQuery])",
].forEach((snippet) => assertIncludes("verify-member-access", verifyMemberAccess, snippet));

[
  "../_shared/member-verification-identity.ts",
  "resolveDiscordIdentity",
].forEach((snippet) => {
  assertIncludes("verify-member-access shared identity", verifyMemberAccess, snippet);
  assertIncludes("verify-discord-member shared identity", verifyDiscordMember, snippet);
});

[
  "defaultDisplayName",
  "providerSubject",
  "resolveDiscordIdentity",
  "profileMatchesTrustedDiscordIdentity",
  "identity.active !== true",
  "discordAvatarUrl",
].forEach((snippet) => assertIncludes("shared member verification identity", memberVerificationIdentity, snippet));

[
  "metadata.provider_id",
  "profile?.discord_user_id ||",
].forEach((snippet) => assertNotIncludes("shared member verification identity authority", memberVerificationIdentity, snippet));

[
  "Discord identity resolution accepts only active synced or provider identities",
  "Discord identity resolution fails closed when trusted sources conflict",
  "Discord profile verification requires an exact trusted identity match",
  "Discord avatar URLs select static and animated CDN formats",
].forEach((snippet) => assertIncludes("shared member verification identity tests", memberVerificationIdentityTest, snippet));

[
  ["verify-member-access", verifyMemberAccess],
  ["verify-discord-member", verifyDiscordMember],
  ["shared gallery moderation", galleryModeration],
].forEach(([label, source]) => {
  assertIncludes(label, source, "member_auth_identities");
  assertIncludes(label, source, '.eq("active", true)');
  assertIncludes(label, source, "resolveDiscordIdentity(");
});

assertIncludes(
  "verify-discord-member bounded Discord lookup",
  verifyDiscordMember,
  "AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS)",
);

[
  '../_shared/member-access-policy.ts',
  'currentMemberAccess({',
  "discordVerificationNeedsRefresh(profile, discordUserId)",
  "AbortSignal.timeout(",
  "discordResult.status === 429 ? 429 : 503",
].forEach((snippet) => assertIncludes("verify-member-access shared access policy", verifyMemberAccess, snippet));

assertIncludes(
  "Social authorization decision membership refresh",
  oauthDecisionRoute,
  'body: { refreshDiscord: true }',
);

[
  "profileMatchesTrustedDiscordIdentity(",
  "profile?.has_required_discord_roles !== true",
  "profile?.discord_verified_at",
  "timestamp <= nowMs",
  "MEMBER_VERIFICATION_MAX_AGE_MS",
  "discordVerificationNeedsRefresh(",
  "DISCORD_NEGATIVE_RECHECK_AFTER_MS",
  "profile?.discord_checked_at",
  "nowMs - timestamp >= MEMBER_VERIFICATION_MAX_AGE_MS",
  'status !== "approved"',
  "verifiedTimestamp > nowMs",
  "expiry >= nowMs",
  "profile?.member_status",
].forEach((snippet) => assertIncludes("shared current-member access policy", memberAccessPolicy, snippet));

[
  'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
  'Deno.env.get("SUPABASE_SECRET_KEYS")',
  "resolveServiceRoleKey",
].forEach((snippet) => assertIncludes("shared Supabase service role", supabaseServiceRole, snippet));
assertNotIncludes("shared Supabase service role", supabaseServiceRole, "console.");

[
  "direct service role key wins unchanged",
  "bundled default key wins over the legacy key",
  "missing or unusable service role values fail closed",
].forEach((snippet) => assertIncludes("shared Supabase service role tests", supabaseServiceRoleTest, snippet));

[
  ["verify-member-access", verifyMemberAccess],
  ["verify-discord-member", verifyDiscordMember],
].forEach(([label, source]) => {
  assertIncludes(label, source, "../_shared/supabase-service-role.ts");
  assertIncludes(label, source, "getServiceRoleKey()");
  assertNotIncludes(label, source, "function getServiceRoleKey");
});

[
  ["list-approved-gallery-submissions", approvedGalleryFeed, "../_shared/supabase-service-role.ts"],
  ["submit-discord-gallery-image", discordGalleryIngest, "../_shared/supabase-service-role.ts"],
  ["shared gallery moderation", galleryModeration, "./supabase-service-role.ts"],
].forEach(([label, source, importPath]) => {
  assertIncludes(label, source, importPath);
  assertIncludes(label, source, "getServiceRoleKey()");
  assertNotIncludes(label, source, "function getServiceRoleKey");
  assertNotIncludes(label, source, 'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
  assertNotIncludes(label, source, 'Deno.env.get("SUPABASE_SECRET_KEYS")');
});

[
  "requireModeratorAccess(req)",
  "VALID_METHODS",
  "approve",
  "reject",
  "revoke",
  "member_verifications",
].forEach((snippet) => assertIncludes("review-member-verification", reviewMemberVerification, snippet));

[
  "provider_token",
  "providerToken",
  "provider_refresh_token",
  "refresh_token",
  "access_token",
  "client_secret",
].forEach((snippet) => {
  [
    ["auth provider registry", providerRegistry],
    ["verify-member-access", verifyMemberAccess],
    ["review-member-verification", reviewMemberVerification],
    ["multi-provider migration", migration],
  ].forEach(([label, text]) => assertNotIncludes(label, text, snippet));
});

if (failures.length) {
  console.error("Multi-provider auth validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Multi-provider auth validation OK.");
