import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readAppCss } from "./lib/app-css.mjs";
import { siteUrl } from "./lib/public-urls.mjs";

const root = process.cwd();
const failures = [];

const files = {
  packageJson: "package.json",
  checkAll: "scripts/check-all.mjs",
  appLayout: "apps/web/app/layout.tsx",
  appCss: "apps/web/app/mochirii.css",
  fontFallbacks: "apps/web/app/styles/font-fallbacks.css",
  fontBundleGuard: "apps/web/scripts/check-font-bundle.mjs",
  nextConfig: "apps/web/next.config.ts",
  supabaseConfig: "supabase/config.toml",
  supabaseSmoke: "scripts/smoke-supabase-edge-functions.mjs",
  reaper: "supabase/functions/reaper-discord-interactions/index.ts",
  reaperSignature: "supabase/functions/_shared/discord-signature.ts",
  reaperMemberSync: "supabase/functions/reaper-discord-member-sync/index.ts",
  reaperSpinnerDispatch: "supabase/functions/reaper-spinner-dispatch/index.ts",
  spinnerDiscordOutbox: "supabase/functions/_shared/spinner-discord-outbox.ts",
  approvedFeed: "supabase/functions/list-approved-gallery-submissions/index.ts",
  approvedFeedHelper: "supabase/functions/_shared/gallery-public-feed.ts",
  visibleProfileCards: "supabase/functions/list-visible-profile-cards/index.ts",
  mochiPetsAlphaShared: "supabase/functions/_shared/mochi-pets-alpha.ts",
  mochiPetsAlphaAction: "supabase/functions/mochi-pets-alpha-action/index.ts",
  mochiPetsAlphaProgress: "supabase/functions/mochi-pets-alpha-progress/index.ts",
  discordIngest: "supabase/functions/submit-discord-gallery-image/index.ts",
  discordIngestHelper: "supabase/functions/_shared/gallery-discord-ingest.ts",
  voteReminder: "supabase/functions/send-vote-reminder/index.ts",
  spotlightPollShared: "supabase/functions/_shared/spotlight-polls.ts",
  spotlightPollSender: "supabase/functions/send-member-spotlight-poll/index.ts",
  spotlightPollPublisher: "supabase/functions/publish-member-spotlight-winner/index.ts",
  spotlightPollPublicWinner: "supabase/functions/get-current-spotlight-winner/index.ts",
  pixelfedSocialSync: "supabase/functions/sync-pixelfed-social-account/index.ts",
  report: "reports/free-security-hardening-2026-06-08.md",
  cspReport: "reports/csp-enforcement-verification-2026-06-08.md",
  deployment: "docs/operations/deployment.md",
  appReadme: "apps/web/README.md",
  currentLiveState: "docs/current-live-state.md",
  securityPolicy: "SECURITY.md",
  appSecurityTxt: "apps/web/public/.well-known/security.txt",
  securityScanReport: "reports/security-scan-remediation-2026-06-10.md",
};

function read(file) {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) {
    failures.push(`${file}: missing required security hardening file.`);
    return "";
  }
  return readFileSync(fullPath, "utf8");
}

function assertIncludes(label, text, snippet) {
  if (!text.includes(snippet)) failures.push(`${label}: expected snippet not found: ${snippet}`);
}

function assertMatches(label, text, pattern, message) {
  if (!pattern.test(text)) failures.push(`${label}: ${message}`);
}

function assertNotMatches(label, text, pattern, message) {
  if (pattern.test(text)) failures.push(`${label}: ${message}`);
}

function extractVerifyJwtFalseFunctions(config) {
  const blocks = [...config.matchAll(/\[functions\.([^\]]+)\]([\s\S]*?)(?=\n\[functions\.|\s*$)/g)];
  return blocks
    .filter(([, , body]) => /verify_jwt\s*=\s*false/.test(body))
    .map(([_, name]) => name);
}

function extractConfiguredFunctions(config) {
  return [...config.matchAll(/\[functions\.([^\]]+)\]/g)].map(([, name]) => name);
}

const packageJson = read(files.packageJson);
const checkAll = read(files.checkAll);
const appLayout = read(files.appLayout);
const appCss = readAppCss();
const fontFallbacks = read(files.fontFallbacks);
const fontBundleGuard = read(files.fontBundleGuard);
const nextConfig = read(files.nextConfig);
const supabaseConfig = read(files.supabaseConfig);
const supabaseSmoke = read(files.supabaseSmoke);
const reaper = read(files.reaper);
const reaperSignature = read(files.reaperSignature);
const reaperSecuritySource = [reaper, reaperSignature].join("\n");
const reaperMemberSync = read(files.reaperMemberSync);
const reaperSpinnerDispatch = read(files.reaperSpinnerDispatch);
const spinnerDiscordOutbox = read(files.spinnerDiscordOutbox);
const reaperSpinnerSecuritySource = `${reaperSpinnerDispatch}\n${spinnerDiscordOutbox}`;
const approvedFeed = read(files.approvedFeed);
const approvedFeedHelper = read(files.approvedFeedHelper);
const approvedFeedSecuritySource = `${approvedFeed}\n${approvedFeedHelper}`;
const approvedFeedListResponseStart = approvedFeed.lastIndexOf("return jsonResponse({\n    ok: true,");
const approvedFeedListResponse = approvedFeedListResponseStart >= 0
  ? approvedFeed.slice(approvedFeedListResponseStart)
  : "";
const visibleProfileCards = read(files.visibleProfileCards);
const mochiPetsAlphaShared = read(files.mochiPetsAlphaShared);
const mochiPetsAlphaAction = read(files.mochiPetsAlphaAction);
const mochiPetsAlphaProgress = read(files.mochiPetsAlphaProgress);
const discordIngest = read(files.discordIngest);
const discordIngestHelper = read(files.discordIngestHelper);
const discordIngestSecuritySource = `${discordIngest}\n${discordIngestHelper}`;
const voteReminder = read(files.voteReminder);
const spotlightPollShared = read(files.spotlightPollShared);
const spotlightPollSender = read(files.spotlightPollSender);
const spotlightPollPublisher = read(files.spotlightPollPublisher);
const spotlightPollPublicWinner = read(files.spotlightPollPublicWinner);
const pixelfedSocialSync = read(files.pixelfedSocialSync);
const report = read(files.report);
const cspReport = read(files.cspReport);
const deployment = read(files.deployment);
const appReadme = read(files.appReadme);
const currentLiveState = read(files.currentLiveState);
const securityPolicy = read(files.securityPolicy);
const securityTxt = read(files.appSecurityTxt);
const securityScanReport = read(files.securityScanReport);

function assertNoCurrentReportOnlyClaim(label, text) {
  const stalePatterns = [
    /current CSP is [`"]?Content-Security-Policy-Report-Only/i,
    /production CSP is report-only/i,
    /CSP should stay report-only/i,
    /Do not promote it to [`"]?Content-Security-Policy/i,
  ];

  for (const pattern of stalePatterns) {
    if (pattern.test(text)) {
      failures.push(`${label}: active docs must not describe current production CSP as report-only.`);
    }
  }
}

assertIncludes("package.json", packageJson, '"check:security-hardening"');
assertIncludes("check-all", checkAll, "check:security-hardening");

[
  "next/font/local",
  "./fonts/zhi-mang-xing-latin.woff2",
  "./fonts/noto-serif-sc-latin.woff2",
  'fallback: ["Zhi Mang Xing Fallback"]',
  'fallback: ["Noto Serif SC Fallback"]',
  "adjustFontFallback: false",
  "--font-zhi-mang",
  "--font-noto-serif-sc",
].forEach((snippet) => assertIncludes("Next font setup", appLayout, snippet));

[
  'font-family:"Zhi Mang Xing Fallback"',
  'src:local("Arial")',
  "ascent-override:126.14%",
  "size-adjust:69.76%",
  'font-family:"Noto Serif SC Fallback"',
  'src:local("Times New Roman")',
  "ascent-override:95.04%",
  "size-adjust:121.11%",
].forEach((snippet) => assertIncludes("Next font fallbacks", fontFallbacks, snippet));

[
  "fontCssLimit = 12 * 1024",
  "font CSS must not emit Unicode-range slices",
  "zhi-mang-xing-latin.woff2",
  "noto-serif-sc-latin.woff2",
].forEach((snippet) => assertIncludes("Next font bundle guard", fontBundleGuard, snippet));

[
  "@import url(\"https://fonts.googleapis.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
].forEach((snippet) => {
  if (appCss.includes(snippet)) {
    failures.push(`app CSS: external Google font loading must stay out of mochirii.css: ${snippet}`);
  }
});

[
  "--font-display:var(--font-zhi-mang), ui-serif, serif",
  "--font-body:var(--font-noto-serif-sc), ui-serif, serif",
].forEach((snippet) => assertIncludes("app CSS font variables", appCss, snippet));

[
  "Content-Security-Policy",
  "Access-Control-Allow-Origin",
  "publicUrls.siteOrigin",
  "X-Content-Type-Options",
  "nosniff",
  "Referrer-Policy",
  "strict-origin-when-cross-origin",
  "Permissions-Policy",
  "Cross-Origin-Opener-Policy",
  "same-origin-allow-popups",
  "X-Frame-Options",
  "DENY",
].forEach((snippet) => assertIncludes("Next security headers", nextConfig, snippet));

if (nextConfig.includes("Content-Security-Policy-Report-Only")) {
  failures.push("Next security headers: CSP should be enforced, not report-only.");
}

if (nextConfig.includes("'unsafe-eval'")) {
  failures.push("Next security headers: production CSP should not allow unsafe-eval.");
}

[
  "default-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "frame-src 'self' https://discord.com https://open.spotify.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://discord.com https://cdn.discordapp.com https://vitals.vercel-insights.com",
].forEach((snippet) => assertIncludes("CSP policy", nextConfig, snippet));

const verifyJwtFalseFunctions = extractVerifyJwtFalseFunctions(supabaseConfig);
const configuredFunctions = extractConfiguredFunctions(supabaseConfig);
if (configuredFunctions.length !== 33) {
  failures.push(`supabase/config.toml: expected 33 configured functions, found ${configuredFunctions.length}.`);
}
if (configuredFunctions.length - verifyJwtFalseFunctions.length !== 20) {
  failures.push(
    `supabase/config.toml: expected 20 verify_jwt=true functions, found ${configuredFunctions.length - verifyJwtFalseFunctions.length}.`,
  );
}
const expectedUnauthenticatedFunctions = [
  "list-approved-gallery-submissions",
  "list-visible-profile-cards",
  "submit-discord-gallery-image",
  "reaper-discord-interactions",
  "reaper-spinner-dispatch",
  "reaper-discord-member-sync",
  "send-vote-reminder",
  "send-member-spotlight-poll",
  "publish-member-spotlight-winner",
  "get-current-spotlight-winner",
  "mochi-pets-alpha-action",
  "mochi-pets-alpha-progress",
  "sync-pixelfed-social-account",
];

const quarantinedUnauthenticatedFunctions = new Set([
  "mochi-pets-alpha-action",
  "mochi-pets-alpha-progress",
]);

const quarantinedFunctions = new Set([
  "mochi-pets-alpha-session",
  "mochi-pets-unity-auth",
  "mochi-pets-alpha-action",
  "mochi-pets-alpha-progress",
  "mochi-pets-alpha-admin",
  "submit-mochi-pets-feedback",
]);

for (const name of configuredFunctions) {
  if (quarantinedFunctions.has(name)) continue;
  const targetDeclaration = new RegExp(`(?:name:\\s*|const name = )"${name}"`);
  assertMatches(
    "Supabase Edge Function smoke",
    supabaseSmoke,
    targetDeclaration,
    `missing fail-closed or read-only coverage for ${name}.`,
  );
}

for (const name of quarantinedUnauthenticatedFunctions) {
  if (!expectedUnauthenticatedFunctions.includes(name)) {
    failures.push(`Supabase Edge Function smoke: quarantine list contains unexpected function ${name}.`);
  }
}

assertNotMatches(
  "Supabase Edge Function smoke",
  supabaseSmoke,
  /contract smoke skipped|process\.exit\(0\)/,
  "live contract failures must not be downgraded to a successful skip.",
);

assertNotMatches(
  "Supabase Edge Function smoke",
  supabaseSmoke,
  /result\.status\s*===\s*500/,
  "runtime failures must not pass as healthy fail-closed responses.",
);

if (verifyJwtFalseFunctions.length !== expectedUnauthenticatedFunctions.length) {
  failures.push(
    `supabase/config.toml: expected ${expectedUnauthenticatedFunctions.length} verify_jwt=false functions, found ${verifyJwtFalseFunctions.length}: ${verifyJwtFalseFunctions.join(", ")}`,
  );
}

for (const name of verifyJwtFalseFunctions) {
  if (!expectedUnauthenticatedFunctions.includes(name)) {
    failures.push(`supabase/config.toml: unauthenticated function ${name} needs an explicit security review.`);
  }
}

const unauthenticatedFunctionGuardSpecs = {
  "list-approved-gallery-submissions": {
    source: approvedFeedSecuritySource,
    kind: "public read-only thumbnail DTO with globally bounded Edge-media delivery",
    snippets: [
      '"Access-Control-Allow-Origin": "*"',
      '"Access-Control-Allow-Methods": "GET, POST, OPTIONS"',
      '"gallery_public_feed_page_v2"',
      '"gallery_reserve_public_media_v2"',
      '"gallery_reserve_public_delivery"',
      'request.action === "full" || request.action === "thumbnail"',
      'if (req.method !== "GET")',
      'keys === "asset,id"',
      ".download(storagePath)",
      "await sha256Hex(mediaBytes) !== mediaSha256",
    ],
  },
  "list-visible-profile-cards": {
    source: visibleProfileCards,
    kind: "public read-only profile-card DTO",
    snippets: [".eq(\"profile_public_enabled\", true)", ".eq(\"member_status\", \"active\")", "recentVerification(profile.discord_verified_at)", "signedMediaUrl"],
  },
  "submit-discord-gallery-image": {
    source: discordIngestSecuritySource,
    kind: "shared-secret Reaper ingest",
    snippets: [
      "DISCORD_GALLERY_INGEST_SECRET",
      "x-mochirii-reaper-secret",
      "constantTimeSecretEquals(bearerOrHeaderSecret(req), ingestSecret)",
      "crypto.subtle.digest(\"SHA-256\"",
    ],
  },
  "reaper-discord-interactions": {
    source: reaperSecuritySource,
    kind: "Discord signature verified",
    snippets: ["x-signature-ed25519", "x-signature-timestamp", "verifyDiscordSignature(req, rawBody, publicKey)"],
  },
  "reaper-spinner-dispatch": {
    source: reaperSpinnerSecuritySource,
    kind: "shared-secret Reaper spinner outbox",
    snippets: [
      "REAPER_SPINNER_DISPATCH_SECRET",
      "x-mochirii-reaper-spinner-secret",
      "constantTimeSecretEqual(spinnerDispatcherSecret(req), dispatchSecret)",
      "DISCORD_RAFFLE_CHANNEL_ID",
    ],
  },
  "reaper-discord-member-sync": {
    source: reaperMemberSync,
    kind: "shared-secret Reaper member sync",
    snippets: ["x-mochirii-reaper-member-sync-secret", "REAPER_PENDING_VERIFICATION_SYNC_SECRET", "verifyMemberSyncSecret(req)"],
  },
  "send-vote-reminder": {
    source: voteReminder,
    kind: "shared-secret scheduled vote reminder",
    snippets: ["VOTE_REMINDER_CRON_SECRET", "x-mochirii-vote-reminder-secret", "bearerOrHeaderSecret(req) !== cronSecret"],
  },
  "send-member-spotlight-poll": {
    source: `${spotlightPollShared}\n${spotlightPollSender}`,
    kind: "shared-secret spotlight sender",
    snippets: ["bearerOrHeaderSecret(req) !== config.secret", "SPOTLIGHT_POLL_CRON_SECRET", "buildDiscordPollPayload"],
  },
  "publish-member-spotlight-winner": {
    source: `${spotlightPollShared}\n${spotlightPollPublisher}`,
    kind: "shared-secret spotlight publisher",
    snippets: ["bearerOrHeaderSecret(req) !== config.secret", "SPOTLIGHT_POLL_CRON_SECRET", "results.finalized"],
  },
  "get-current-spotlight-winner": {
    source: spotlightPollPublicWinner,
    kind: "public read-only spotlight DTO",
    snippets: [".eq(\"status\", \"published\")", "winner_display_name", "monthly-discord-poll"],
  },
  "mochi-pets-alpha-action": {
    source: `${mochiPetsAlphaShared}\n${mochiPetsAlphaAction}`,
    kind: "game-server shared token",
    snippets: ["requireGameServer(req)", "MOCHI_PETS_GAME_SERVER_TOKEN", "noRealValue: true"],
  },
  "mochi-pets-alpha-progress": {
    source: `${mochiPetsAlphaShared}\n${mochiPetsAlphaProgress}`,
    kind: "game-server shared token",
    snippets: ["requireGameServer(req)", "MOCHI_PETS_GAME_SERVER_TOKEN", "loadAlphaProgressSnapshot(adminClient, playerId)"],
  },
  "sync-pixelfed-social-account": {
    source: pixelfedSocialSync,
    kind: "shared-secret Pixelfed sync",
    snippets: [
      "PIXELFED_SOCIAL_SYNC_SECRET",
      "PIXELFED_SOCIAL_SYNC_SECRET_HEADER",
      "verifySyncSecret(req)",
      "../_shared/supabase-service-role.ts",
      "getServiceRoleKey()",
    ],
  },
};

for (const name of expectedUnauthenticatedFunctions) {
  const spec = unauthenticatedFunctionGuardSpecs[name];
  if (!spec) {
    failures.push(`supabase/config.toml: unauthenticated function ${name} lacks an explicit guard classification.`);
    continue;
  }

  for (const snippet of spec.snippets) {
    assertIncludes(`${name} ${spec.kind}`, spec.source, snippet);
  }
}

[
  ["list-approved-gallery-submissions", approvedFeed],
  ["list-visible-profile-cards", visibleProfileCards],
  ["get-current-spotlight-winner", spotlightPollPublicWinner],
].forEach(([name, source]) => {
  assertNotMatches(
    `${name} public read-only posture`,
    source,
    /\.(insert|update|upsert|delete)\s*\(/,
    "verify_jwt=false public DTO endpoints must not perform Supabase table mutations.",
  );
});

[
  "PIXELFED_SOCIAL_SYNC_SECRET",
  "PIXELFED_SOCIAL_SYNC_SECRET_HEADER",
  "verifySyncSecret(req)",
  "auth.admin.getUserById",
  ".from(\"social_accounts\")",
  "federation_enabled: false",
  "../_shared/supabase-service-role.ts",
  "getServiceRoleKey()",
].forEach((snippet) => assertIncludes("sync-pixelfed-social-account", pixelfedSocialSync, snippet));

[
  "x-mochi-pets-server-token",
  "MOCHI_PETS_GAME_SERVER_TOKEN",
].forEach((snippet) => assertIncludes("mochi-pets-alpha shared security", mochiPetsAlphaShared, snippet));

[
  "requireGameServer(req)",
  "noRealValue: true",
].forEach((snippet) => assertIncludes("mochi-pets-alpha-action", mochiPetsAlphaAction, snippet));

[
  "requireGameServer(req)",
  "loadAlphaProgressSnapshot(adminClient, playerId)",
  "normalizeAlphaProgressSnapshot(data)",
  "noRealValue: true",
].forEach((snippet) => assertIncludes("mochi-pets-alpha-progress", mochiPetsAlphaProgress, snippet));

[
  "x-signature-ed25519",
  "x-signature-timestamp",
  "DISCORD_PUBLIC_KEY",
  "verifyDiscordSignature(req, rawBody, publicKey)",
  "SIGNATURE_WINDOW_MS",
  "Retry-After",
  "retry_after",
].forEach((snippet) => assertIncludes("reaper-discord-interactions", reaperSecuritySource, snippet));

[
  "x-mochirii-reaper-member-sync-secret",
  "REAPER_PENDING_VERIFICATION_SYNC_SECRET",
  "verifyMemberSyncSecret(req)",
  "fetchCurrentMember",
  "buildSingleMemberPendingContainmentPlan",
  "applyPendingContainmentPlan(adminClient, plan, writePendingDiscordOverwrite)",
  "MAX_PENDING_VERIFICATION_MUTATIONS",
  "source: \"gateway_member_event\"",
].forEach((snippet) => assertIncludes("reaper-discord-member-sync", reaperMemberSync, snippet));

assertMatches(
  "reaper-discord-interactions",
  reaper,
  /const rawBody = await req\.text\(\);[\s\S]*verifyDiscordSignature\(req, rawBody, publicKey\)[\s\S]*JSON\.parse\(rawBody\)/,
  "Discord signatures must be validated against the raw body before parsing JSON.",
);

[
  "DISCORD_GALLERY_INGEST_SECRET",
  "x-mochirii-reaper-secret",
  "constantTimeSecretEquals(bearerOrHeaderSecret(req), ingestSecret)",
  "crypto.subtle.digest(\"SHA-256\"",
  "invalid_ingest_secret",
].forEach((snippet) => assertIncludes("submit-discord-gallery-image", discordIngestSecuritySource, snippet));

[
  "VOTE_REMINDER_CRON_SECRET",
  "x-mochirii-vote-reminder-secret",
  "bearerOrHeaderSecret(req) !== cronSecret",
  "DISCORD_VOTE_CHANNEL_ID",
].forEach((snippet) => assertIncludes("send-vote-reminder", voteReminder, snippet));

[
  "SPOTLIGHT_POLL_CRON_SECRET",
  "DISCORD_SPOTLIGHT_POLL_CHANNEL_ID",
].forEach((snippet) => assertIncludes("spotlight-polls shared helper", spotlightPollShared, snippet));

[
  "bearerOrHeaderSecret(req) !== config.secret",
  "buildDiscordPollPayload",
  "duplicate: true",
].forEach((snippet) => assertIncludes("send-member-spotlight-poll", spotlightPollSender, snippet));

[
  "bearerOrHeaderSecret(req) !== config.secret",
  "results.finalized",
  "winner_display_name",
].forEach((snippet) => assertIncludes("publish-member-spotlight-winner", spotlightPollPublisher, snippet));

[
  "winner_display_name",
  "monthly-discord-poll",
].forEach((snippet) => assertIncludes("get-current-spotlight-winner", spotlightPollPublicWinner, snippet));

[
  "discord_user_id",
  "discord_username",
  "vote_count",
  "answer_label",
  "candidate_order",
].forEach((snippet) => {
  if (spotlightPollPublicWinner.includes(snippet)) {
    failures.push(`get-current-spotlight-winner: public endpoint must not return or select ${snippet}.`);
  }
});

[
  '"gallery_public_feed_page_v2"',
  '"gallery_reserve_public_media_v2"',
  '"gallery_reserve_public_delivery"',
  'request.action === "full" || request.action === "thumbnail"',
  'if (req.method !== "GET")',
  'keys === "asset,id"',
  "parseGalleryMediaReservation(mediaData, request.id, request.action)",
  ".download(storagePath)",
  "mediaBlob.size !== mediaSize",
  "await sha256Hex(mediaBytes) !== mediaSha256",
  '"Cache-Control": "private, max-age=300, stale-while-revalidate=60"',
  '"X-Content-Type-Options": "nosniff"',
  "thumbnail_url",
  "thumbnail_size_bytes",
  "thumbnail_width",
  "thumbnail_height",
  'delivery: "bounded-edge-media"',
  "cacheSeconds: 15",
].forEach((snippet) => assertIncludes("list-approved-gallery-submissions", approvedFeedSecuritySource, snippet));

[
  '"storage_path"',
  '"storage_bucket"',
  '"thumbnail_storage_path"',
  '"user_id"',
  '"reviewed_by"',
  '"rejection_reason"',
  '"uploader_display_name"',
].forEach((snippet) => {
  if (approvedFeed.includes(snippet)) {
    failures.push(`list-approved-gallery-submissions: public response source must not emit private key ${snippet}.`);
  }
});

assertMatches(
  "list-approved-gallery-submissions list response",
  approvedFeedListResponse,
  /data:\s*\{[\s\S]*?items,[\s\S]*?nextCursor\s*,[\s\S]*?delivery:\s*"bounded-edge-media",[\s\S]*?cacheSeconds:\s*15[\s\S]*?\}/,
  "list action must return bounded Edge thumbnail-page metadata.",
);

assertNotMatches(
  "list-approved-gallery-submissions list response",
  approvedFeedListResponse,
  /full_url|signedUrlSeconds|thumbnailStoragePath|storagePath|uploader/i,
  "list action must not return a display-image URL.",
);

[
  /createSignedUrls?\(/,
  /thumbnail_signed_url|full_signed_url|signedUrlSeconds/,
].forEach((pattern) => assertNotMatches(
  "list-approved-gallery-submissions bearer capability posture",
  approvedFeed,
  pattern,
  "public Gallery delivery must not mint or expose bearer URLs.",
));

[
  "CORS_HEADERS",
  "new Response(\"ok\", { headers: CORS_HEADERS })",
  "asArray(body.slugs)",
  ".in(\"profile_slug\", requestedSlugs)",
  ".eq(\"profile_public_enabled\", true)",
  ".eq(\"member_status\", \"active\")",
  ".eq(\"has_required_discord_roles\", true)",
  "recentVerification(profile.discord_verified_at)",
  "signedMediaUrl",
  "hasApprovedAvatar",
].forEach((snippet) => assertIncludes("list-visible-profile-cards", visibleProfileCards, snippet));

assertMatches(
  "list-visible-profile-cards",
  visibleProfileCards,
  /return\s+\{[\s\S]*slug:[\s\S]*displayName:[\s\S]*guildTitle:[\s\S]*avatarUrl:[\s\S]*profileHref:[\s\S]*hasApprovedAvatar/s,
  "public visible profile card must return only safe card fields.",
);

[
  "discordHandle:",
  "gameUid:",
  "region:",
  "timezone:",
  "storagePath:",
  "storageBucket:",
  "discordUserId:",
].forEach((snippet) => {
  if (visibleProfileCards.includes(snippet)) {
    failures.push(`list-visible-profile-cards: public card function must not return ${snippet}`);
  }
});

assertMatches(
  "list-approved-gallery-submissions",
  approvedFeed,
  /return jsonResponse\(\{[\s\S]*?data:\s*\{[\s\S]*?schemaVersion:\s*GALLERY_PUBLIC_SCHEMA_VERSION,[\s\S]*?items,[\s\S]*?\}/,
  "public approved feed list must emit the sanitized versioned item collection.",
);

[
  "Cloudflare remains DNS-only",
  "Vercel platform-wide DDoS mitigation",
  "CodeQL",
  "Dependabot",
  "verify_jwt=false",
  "Discord 429",
].forEach((snippet) => assertIncludes("security report", report, snippet));

[
  "Content-Security-Policy",
  "no CSP report-only console violations",
  "@vercel/analytics/next",
  "@vercel/speed-insights/next",
].forEach((snippet) => assertIncludes("CSP enforcement report", cspReport, snippet));

[
  "Security Hardening",
  "Content-Security-Policy",
  "Cloudflare remains DNS-only",
].forEach((snippet) => assertIncludes("deployment docs", deployment, snippet));

[
  "Current Hardening Baseline",
  "CSP is enforced",
  "apps/web/next.config.ts",
  "Supabase service-role keys",
].forEach((snippet) => assertIncludes("security policy", securityPolicy, snippet));

[
  "Security Headers",
  "Production CSP is enforced",
  "Content-Security-Policy",
  "Cloudflare DNS-only",
  "@vercel/analytics",
  "@vercel/speed-insights",
].forEach((snippet) => assertIncludes("apps/web README", appReadme, snippet));

[
  "Current Live State",
  "Production CSP is enforced",
  "Access-Control-Allow-Origin",
  "Cloudflare remains DNS-only",
  "Supabase remains the authority",
  "Discord event schedule source is `apps/web/public/data/guild-schedule.json`",
  "Vercel Web Analytics and Speed Insights",
].forEach((snippet) => assertIncludes("current live state docs", currentLiveState, snippet));

[
  "Contact: https://github.com/Mochirii-Wushu/Mochirii-Website/security/policy",
  "Policy: https://github.com/Mochirii-Wushu/Mochirii-Website/security/policy",
  "Preferred-Languages: en",
  `Canonical: ${siteUrl("/.well-known/security.txt")}`,
  "Expires: 2027-06-10T00:00:00Z",
].forEach((snippet) => assertIncludes("security.txt", securityTxt, snippet));

assertMatches(
  "security.txt",
  securityTxt,
  /^Contact:\s+https:\/\/github\.com\/Mochirii-Wushu\/Mochirii-Website\/security\/policy/m,
  "Contact must use the HTTPS GitHub security policy URL.",
);

assertMatches(
  "security.txt",
  securityTxt,
  /^Canonical:\s+https:\/\/mochirii\.com\/\.well-known\/security\.txt/m,
  "Canonical must point to the production security.txt URL.",
);

[
  "Cloudflare Security Insights",
  "Security.txt not configured",
  "Dangling A Record detected",
  "Cloudflare remains DNS-only",
  "Server: Vercel",
  "CSP inline reduction remains a staged follow-up",
  "Supabase CLI auditability",
].forEach((snippet) => assertIncludes("security scan report", securityScanReport, snippet));

[
  ["deployment docs", deployment],
  ["apps/web README", appReadme],
  ["current live state docs", currentLiveState],
  ["security policy", securityPolicy],
].forEach(([label, text]) => assertNoCurrentReportOnlyClaim(label, text));

if (failures.length) {
  console.error("Security hardening validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Security hardening validation OK.");
