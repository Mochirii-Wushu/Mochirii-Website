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
const publicConfig = read("apps/web/lib/supabase/config.ts");
const providerRegistry = read("apps/web/lib/supabase/auth-providers.ts");
const providerPolicyCore = read("apps/web/lib/supabase/auth-provider-policy-core.ts");
const providerPolicyTest = read("apps/web/lib/supabase/auth-provider-policy-core.test.mts");
const providerLogo = read("apps/web/components/member-workflow/ProviderLogo.tsx");
const authClient = read("apps/web/lib/supabase/auth.ts");
const profileClient = read("apps/web/lib/supabase/profile.ts");
const authPanel = read("apps/web/components/member-workflow/AuthPanel.tsx");
const accountPanel = read("apps/web/components/member-workflow/AccountPanel.tsx");
const nextCss = readAppCss();
const memberWorkflowCss = read("apps/web/app/styles/member-workflow.css");
const leaderDashboardCss = read("apps/web/app/styles/member-leader-dashboard.css");
const multiProviderDoc = read("docs/multi-provider-login-and-verification.md");
const supabaseReadme = read("supabase/README.md");
const providerAssetProvenance = read("apps/web/public/assets/auth-providers/README.md");
const providerChooserSmoke = read("scripts/smoke-auth-provider-chooser.mjs");
const privacyPage = read("apps/web/components/public-pages/route-pages/PrivacyPage.tsx");
const deletionPage = read("apps/web/components/public-pages/route-pages/MetaDataDeletionPage.tsx");
const gallerySubmit = read("apps/web/components/member-workflow/GallerySubmitForm.tsx");
const leaderDashboard = read("apps/web/components/member-workflow/LeaderDashboard.tsx");
const moderationClient = read("apps/web/lib/supabase/moderation.ts");
const supabaseConfig = read("supabase/config.toml");
const migration = read("supabase/migrations/20260615041842_add_multi_provider_member_verification.sql");
const verifyMemberAccess = read("supabase/functions/verify-member-access/index.ts");
const oauthDecisionRoute = read("apps/web/app/api/oauth/decision/route.ts");
[
  'from "@/lib/supabase/server-fetch"',
  "fetch: supabaseServerFetch",
  "await supabaseServerFetch(endpoint",
].forEach((snippet) => assertIncludes("OAuth decision bounded transport", oauthDecisionRoute, snippet));
const verifyDiscordMember = read("supabase/functions/verify-discord-member/index.ts");
const discordApi = read("supabase/functions/_shared/discord-api.ts");
const outboundHttp = read("supabase/functions/_shared/outbound-http.ts");
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
  '"check:auth-provider-brand-assets": "node scripts/check-auth-provider-brand-assets.mjs"',
  '"test:auth-provider-policy": "node --experimental-default-type=module --experimental-strip-types --test apps/web/lib/supabase/auth-provider-policy-core.test.mts"',
  '"smoke:auth-provider-chooser": "node scripts/smoke-auth-provider-chooser.mjs"',
  '"test:member-verification-identity": "deno test --lock=deno.lock --frozen=true supabase/functions/_shared/member-verification-identity_test.ts"',
  '"test:supabase-service-role": "deno test --lock=deno.lock --frozen=true supabase/functions/_shared/supabase-service-role_test.ts"',
  '"test:member-access-refresh": "deno test --allow-env --node-modules-dir=auto --import-map=supabase/functions/verify-member-access/deno.json',
].forEach((snippet) => assertIncludes("package scripts", packageJson, snippet));

assertIncludes("check-all", checkAll, '["check:multi-provider-auth", ["node", "scripts/check-multi-provider-auth.mjs"]]');
assertIncludes("check-all", checkAll, '["check:auth-provider-brand-assets", ["node", "scripts/check-auth-provider-brand-assets.mjs"]]');
assertIncludes("check-all", checkAll, '["test:auth-provider-policy", ["node", "--experimental-default-type=module", "--experimental-strip-types", "--test", "apps/web/lib/supabase/auth-provider-policy-core.test.mts"]]');
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
  "NEXT_PUBLIC_AUTH_IDENTITY_LINK_PROVIDER_IDS",
  "NEXT_PUBLIC_AUTH_PROVIDER_PLACEHOLDER_IDS",
  'signInLabel: "Continue with Apple"',
  'signInLabel: "Continue with Facebook"',
  'signInLabel: "Continue with Google"',
  'signInLabel: "Sign in with Discord"',
  'signInLabel: "Log in with Twitch"',
  'signInLabel: "Log in with Spotify"',
  'requestedProviderIds()',
  'requestedIdentityLinkProviderIds()',
  'requestedPlaceholderProviderIds()',
  'enabledIdentityLinkProviders',
  'isSignInProviderEnabled',
  'isIdentityLinkProviderEnabled',
  'placeholderOAuthProviders',
].forEach((snippet) => assertIncludes("auth provider registry", providerRegistry, snippet));

[
  "OFFICIAL_PROVIDER_ASSETS",
  "/assets/auth-providers/apple-logo.generated.svg",
  "/assets/auth-providers/facebook-login-mark.svg",
  "/assets/auth-providers/google-g.generated.svg",
  "/assets/auth-providers/discord-symbol-white.svg",
  "/assets/auth-providers/twitch-glitch-white.svg",
  "/assets/auth-providers/spotify-primary-logo-green.svg",
  'provider === "kakao"',
  'provider === "phone"',
  "unoptimized",
  "aria-hidden=\"true\"",
].forEach((snippet) => assertIncludes("provider logo component", providerLogo, snippet));

[
  '?? "apple,google,discord,twitch"',
  "NEXT_PUBLIC_AUTH_IDENTITY_LINK_PROVIDER_IDS",
  '?? "discord,google,twitch,apple"',
  "authIdentityLinkProviderIds: NEXT_PUBLIC_AUTH_IDENTITY_LINK_PROVIDER_IDS",
].forEach((snippet) => assertIncludes("Supabase public provider config", publicConfig, snippet));

[
  "normalizeProviderPolicyIds",
  "resolveProviderPolicyIds",
  "new Set(normalizeProviderPolicyIds(value))",
].forEach((snippet) => assertIncludes("auth provider policy core", providerPolicyCore, snippet));

[
  "sign-in and identity-link provider policies resolve independently",
  "an explicitly empty identity-link policy stays empty",
  "provider policies reject unsupported identifiers",
  "identity linking can be staged independently from public sign-in",
  'assert.equal(identityLink.includes("facebook"), false)',
  'assert.equal(identityLink.includes("spotify"), false)',
].forEach((snippet) => assertIncludes("auth provider policy tests", providerPolicyTest, snippet));

[
  "signInWithProvider",
  "signInWithPhoneOtp",
  "shouldCreateUser: false",
  "captchaToken: cleanCaptchaToken",
  "requirePhoneCaptchaToken",
  "verifyPhoneOtp",
  "linkProviderIdentity",
  "isSignInProviderEnabled",
  "isIdentityLinkProviderEnabled",
  "That sign-in provider is not enabled.",
  "That identity-linking provider is not enabled.",
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
  "provider.signInLabel",
  "AuthCaptcha",
  "readPhoneOtpResendDeadline",
  "verifyPhoneOtp",
  "placeholderOAuthProviders",
  "Setup pending",
  "provider-button--${provider.id} provider-button--placeholder",
  "provider-button__label",
  "provider-option__note",
  "aria-describedby={noteId}",
].forEach((snippet) => assertIncludes("AuthPanel", authPanel, snippet));
assertNotIncludes("AuthPanel provider prominence", authPanel, "provider-button--primary");
assertNotIncludes("AuthPanel placeholder privacy", authPanel, "Setup pending. {provider.setupNote}");

[
  "Identity Linking",
  "linkProviderIdentity",
  "ProviderLogo",
  "enabledIdentityLinkProviders",
  "refreshMemberAccess({ refreshDiscord: true })",
  "moderator-approved member verification",
].forEach((snippet) => assertIncludes("AccountPanel", accountPanel, snippet));
assertNotIncludes("AccountPanel link policy", accountPanel, "placeholderOAuthProviders");
assertNotIncludes("AccountPanel link policy", accountPanel, "Setup pending");

[
  "Manual Linking",
  "security_manual_linking_enabled",
  "NEXT_PUBLIC_AUTH_PROVIDER_IDS=apple,google,discord,twitch",
  "NEXT_PUBLIC_AUTH_IDENTITY_LINK_PROVIDER_IDS=discord,google,twitch,apple",
  "Continue with Apple",
  "Continue with Facebook",
  "Continue with Google",
  "Sign in with Discord",
  "Log in with Twitch",
  "Log in with Spotify",
  "Supabase Auth remains the sole OAuth broker",
].forEach((snippet) => {
  assertIncludes("multi-provider docs", multiProviderDoc, snippet);
  assertIncludes("Supabase README", supabaseReadme, snippet);
});

[
  "not part of Mochirii's project license",
  "production-disabled",
  "apple-logo.generated.svg",
  "facebook-login-mark.svg",
  "google-g.generated.svg",
  "discord-symbol-white.svg",
  "twitch-glitch-white.svg",
  "spotify-primary-logo-green.svg",
].forEach((snippet) => assertIncludes("official provider asset provenance", providerAssetProvenance, snippet));

[
  'NEXT_PUBLIC_AUTH_PROVIDER_IDS: "apple,facebook,google,discord,twitch,spotify"',
  'NEXT_PUBLIC_AUTH_IDENTITY_LINK_PROVIDER_IDS: "discord,google,twitch,apple"',
  'NEXT_PUBLIC_AUTH_PROVIDER_PLACEHOLDER_IDS: ""',
  '"Continue with Facebook", "facebook-login-mark.svg"',
  "const syntheticAuthOrigin = baseUrl;",
  'url.pathname === "/auth/v1/authorize"',
  'directive.toLowerCase() !== "upgrade-insecure-requests"',
  'handoff.searchParams.get("provider") !== "facebook"',
  'facebook\\.com$|(^|\\.)fbcdn\\.net$|(^|\\.)meta\\.com$',
  "Chromium",
  "Firefox",
  "WebKit",
].forEach((snippet) => assertIncludes("provider chooser browser smoke", providerChooserSmoke, snippet));

[
  "the basic",
  "identity details supplied by an enabled sign-in option",
  "A sign-in identity does not prove guild membership by itself.",
  "If Facebook sign-in is activated later",
].forEach((snippet) => assertIncludes("privacy sign-in disclosure", privacyPage, snippet));

[
  "The Page and Instagram publishing workflow is separate from member authentication.",
  "A future",
  "Facebook sign-in option would use a separate, minimum-data authentication client through the Website",
  "this process also covers eligible Facebook identity data held",
].forEach((snippet) => assertIncludes("Facebook deletion separation", deletionPage, snippet));

[
  ".provider-logo",
  ".provider-logo--discord",
  ".provider-logo--google",
  ".provider-button--placeholder",
  ".provider-button__copy",
  ".provider-button__label",
  ".provider-option__note",
].forEach((snippet) => assertIncludes("Next auth CSS", nextCss, snippet));

const mobileProviderGridRule = ".provider-grid,\n  .provider-grid--compact{\n    grid-template-columns:1fr;";
assertIncludes("shared auth mobile layout", memberWorkflowCss, mobileProviderGridRule);
assertNotIncludes("leader-only auth mobile layout", leaderDashboardCss, mobileProviderGridRule);

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

[
  "../_shared/discord-api.ts",
  "discordFetch(",
  "timeoutMs: DISCORD_REQUEST_TIMEOUT_MS",
  "discordMemberRoleState(",
].forEach((snippet) =>
  assertIncludes("verify-discord-member bounded Discord lookup", verifyDiscordMember, snippet)
);

[
  '../_shared/member-access-policy.ts',
  'currentMemberAccess({',
  "discordVerificationNeedsRefresh(profile, discordUserId)",
  "discordFetch(",
  "timeoutMs: options.requestTimeoutMs || DISCORD_REQUEST_TIMEOUT_MS",
  "discordMemberRoleState(",
  "discordResult.status === 429 ? 429 : 503",
].forEach((snippet) => assertIncludes("verify-member-access shared access policy", verifyMemberAccess, snippet));

[
  'export const DISCORD_API_BASE = "https://discord.com/api/v10"',
  "fetchWithTimeout(",
  "readBoundedResponseText(",
  "discordMemberRoleState(",
].forEach((snippet) => assertIncludes("shared bounded Discord API", discordApi, snippet));
[
  'redirect: "error"',
  "AbortSignal.timeout(options.timeoutMs)",
  "readBoundedResponseBytes(",
].forEach((snippet) => assertIncludes("shared bounded outbound transport", outboundHttp, snippet));

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
