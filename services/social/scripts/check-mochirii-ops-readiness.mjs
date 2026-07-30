import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { securityTxtContractFailures } from "./security-txt-contract.mjs";

const root = process.cwd();
const repositoryRoot = path.resolve(root, "../..");

const requiredDocs = [
  "docs/mochirii-social-sync.md",
  "docs/upstream-sync-policy.md",
  "docs/media-spaces-readiness.md",
  "docs/fediverse-activation-runbook.md",
  "docs/online-hosted-runtime.md",
  "docs/online-backup-recovery.md",
];

const failures = [];
const publicDisplayName = "Mōchirīī Social";
const publicDescription = "Internal guild social platform for profiles, photos & staying connected. Only verified members can access here & everything is private with no data sharing outside.";
const publicSurfaceDirs = [
  ".github",
  "resources/views/site",
  "resources/views/settings",
  "resources/views/layouts",
  "resources/views/auth",
  "resources/views/errors",
  "resources/views/profile",
  "resources/views/status",
  "resources/views/atom",
  "resources/views/mobile",
  "resources/views/portfolio",
  "resources/views/emails",
  "resources/assets/components/partials",
  "resources/assets/components/landing",
];
const publicSurfaceFiles = [
  ".env.docker.example",
  "public/manifest.json",
  "public/offline.html",
  "public/sw.js",
  "package.json",
  "package-lock.json",
  "config/instance.php",
  "config/mochirii-branding.php",
  "resources/assets/components/AccountImport.vue",
  "resources/assets/components/Changelog.vue",
  "resources/assets/components/Direct.vue",
  "resources/assets/components/DirectMessage.vue",
  "resources/assets/components/GroupPage.vue",
  "resources/assets/components/GroupProfile.vue",
  "resources/assets/components/Discover.vue",
  "resources/assets/components/groups/GroupInvite.vue",
  "resources/assets/components/groups/GroupFeed.vue",
  "resources/assets/components/groups/GroupProfile.vue",
  "resources/assets/components/groups/GroupSettings.vue",
  "resources/assets/components/groups/partials/CommentDrawer.vue",
  "resources/assets/components/sections/DiscoverFeed.vue",
  "resources/assets/js/components/CollectionComponent.vue",
  "resources/assets/js/components/CollectionCompose.vue",
  "resources/assets/js/components/Direct.vue",
  "resources/assets/js/components/ComposeModal.vue",
  "resources/assets/js/components/DiscoverComponent.vue",
  "resources/assets/js/components/LoopComponent.vue",
  "resources/assets/js/components/My2020.vue",
  "resources/assets/js/components/PostComponent.vue",
  "resources/assets/js/components/Profile.vue",
  "resources/assets/js/i18n/en.json",
  "resources/lang/en/settings.php",
  "resources/lang/en/web.php",
];
const publicDenyTokens = [
  "Pixelfed",
  "pixelfed-icon",
  "placeholder=\"@pixelfed\"",
  "pixelfed.dev",
  "pixelfed-group-blocks",
  "'pixelfed.com'",
  "https://mochirii.com/social",
  "Instagram",
  "Mastodon",
  "Fediverse",
  "ActivityPub",
  "Global Feed",
  "Network Feed",
  "Go back to previous design",
  "Import from Instagram",
  "Instagram Import",
  "@dansup",
  "opencollective.com/pixelfed",
  "github.com/pixelfed/pixelfed-rn",
  "discord.gg/6Fy6AJMbMU",
  "danielsupernault",
  "pixelfed@yourdomain.com",
  "during staging",
  "in staging",
  "staging update",
  "dansup",
  "ctvnews.",
  "soundcloud.com",
  "youtube.com/embed",
  "321493203255693312",
];

function read(file) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Missing required file: ${file}`);
    return "";
  }
  return fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");
}

function readRepository(file) {
  const fullPath = path.join(repositoryRoot, file);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Missing required repository file: ${file}`);
    return "";
  }
  return fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");
}

function requireIncludes(file, text, needles) {
  for (const needle of needles) {
    if (!text.includes(needle)) {
      failures.push(`${file} must mention: ${needle}`);
    }
  }
}

function requireRuntimeSourceFile(file) {
  if (!fs.existsSync(path.join(root, file))) {
    failures.push(`Missing required runtime source file: ${file}`);
  }
}

function walkFiles(relativeDir) {
  const fullDir = path.join(root, relativeDir);
  if (!fs.existsSync(fullDir)) return [];

  const found = [];
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    const relative = path.join(relativeDir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      found.push(...walkFiles(relative));
    } else {
      found.push(relative);
    }
  }
  return found;
}

function assertNoPublicResidue(file) {
  const text = read(file);
  for (const token of publicDenyTokens) {
    if (text.includes(token)) {
      failures.push(`${file} contains public upstream residue: ${token}`);
    }
  }
}

function gitRemote(args) {
  try {
    return execFileSync("git", ["remote", ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    failures.push(`git remote ${args.join(" ")} failed: ${error.message}`);
    return "";
  }
}

function isCanonicalRemote(remote) {
  return /github\.com[:/]Mochirii-Wushu\/Mochirii-Website(?:\.git)?\/?$/i.test(remote);
}

for (const doc of requiredDocs) {
  read(doc);
}

for (const file of [
  ".env.testing",
  "bootstrap/cache/.gitignore",
  "public/vendor/horizon/.gitignore",
  "storage/app/bouncer/.gitignore",
  "storage/app/bouncer/all.json",
  "storage/app/public/avatars/.gitignore",
  "storage/app/public/avatars/default.jpg",
  "storage/app/public/avatars/default.png",
]) {
  requireRuntimeSourceFile(file);
}

for (const removedFile of ["funding.json", ".github/FUNDING.yml"]) {
  if (fs.existsSync(path.join(root, removedFile))) {
    failures.push(`${removedFile} should not exist in the Mochirii ops fork.`);
  }
}

for (const file of [...publicSurfaceFiles, ...publicSurfaceDirs.flatMap(walkFiles)]) {
  assertNoPublicResidue(file);
}

for (const file of publicSurfaceDirs.flatMap(walkFiles)) {
  if (read(file).includes("Mochirii Social")) {
    failures.push(`${file} contains the backend-only ASCII Social identifier in a rendered resource`);
  }
}

const manifest = read("public/manifest.json");
requireIncludes("public/manifest.json", manifest, [
  `"name": "${publicDisplayName}"`,
  '"short_name": "Mōchī"',
  `"description": "${publicDescription}"`,
  '"src": "/img/mochirii-icon.png"',
]);

const offlinePage = read("public/offline.html");
requireIncludes("public/offline.html", offlinePage, [
  "Mōchirīī Social is offline",
  '/img/mochirii-icon.png',
  'alt="Mōchirīī emblem"',
]);

const serviceWorker = read("public/sw.js");
requireIncludes("public/sw.js", serviceWorker, [
  'const OFFLINE_VERSION = 2;',
  '"/img/mochirii-icon.png"',
]);

for (const removedAsset of [
  "public/img/favicon.png",
  "public/img/pixelfed-icon-black.svg",
  "public/img/pixelfed-icon-color.png",
  "public/img/pixelfed-icon-color.svg",
  "public/img/pixelfed-icon-grey.svg",
  "public/img/pixelfed-icon-white.svg",
]) {
  if (fs.existsSync(path.join(root, removedAsset))) {
    failures.push(`${removedAsset} must not remain on the public Social surface`);
  }
}

for (const file of publicSurfaceDirs.flatMap(walkFiles)) {
  const contents = read(file);
  if (contents.includes("/img/favicon.png") || contents.includes("#10c5f8")) {
    failures.push(`${file} must use the canonical Mōchirīī emblem and theme color`);
  }
}

for (const file of [...walkFiles("public/js"), ...walkFiles("public/css")]) {
  const contents = read(file);
  for (const token of ["pixelfed-icon", "A members-only Mochirii social hall", "Mochirii Social"]) {
    if (contents.includes(token)) {
      failures.push(`${file} contains stale generated public branding: ${token}`);
    }
  }
}

const brandingConfig = read("config/mochirii-branding.php");
requireIncludes("config/mochirii-branding.php", brandingConfig, [
  `'display_name' => '${publicDisplayName}'`,
  `'guild_name' => 'Mōchirīī'`,
  `'description' => '${publicDescription}'`,
]);

const instanceConfig = read("config/instance.php");
requireIncludes("config/instance.php", instanceConfig, [
  `'description' => env('INSTANCE_DESCRIPTION', '${publicDescription}')`,
  "'beagle_api' => env('PF_INSTANCE_USE_BEAGLE_API', false)",
  "'enabled' => (bool) env('INSTANCE_NOTIFY_APP_GATEWAY', false)",
]);
const applicationConfig = read("config/app.php");
requireIncludes("config/app.php", applicationConfig, [
  "'name' => env('APP_NAME', 'Mochirii')",
  `'short_description' => env('PF_SHORT_DESCRIPTION', '${publicDescription}')`,
  `'description' => env('PF_DESCRIPTION', '${publicDescription}')`,
]);
const groupsConfig = read("config/groups.php");
requireIncludes("config/groups.php", groupsConfig, [
  "'federation' => env('GROUPS_FEDERATION', false)",
]);

for (const file of [
  "resources/views/site/index.blade.php",
  "resources/views/auth/login.blade.php",
  "resources/views/site/about.blade.php",
  "resources/views/welcome.blade.php",
  "resources/views/home.blade.php",
]) {
  const entrySource = read(file);
  requireIncludes(file, entrySource, [
    "config('mochirii-branding.display_name')",
    "config('mochirii-branding.description')",
  ]);
}

for (const file of [
  "resources/views/layouts/app.blade.php",
  "resources/views/layouts/partial/nav.blade.php",
  "resources/views/layouts/partial/noauthnav.blade.php",
]) {
  requireIncludes(file, read(file), ["config('mochirii-branding.display_name')"]);
}

for (const file of walkFiles("resources/lang")) {
  const lines = read(file).split("\n");
  lines.forEach((line, index) => {
    const separator = line.indexOf("=>");
    if (separator < 0) return;

    const visibleValue = line.slice(separator + 2).split("//", 1)[0];
    if (/pixelfed|mastodon|fedivers|fediwers|fedibertso|fedivesm|ffedirasi|فدیورس|פדיוורס|федіверс/iu.test(visibleValue)) {
      failures.push(
        `${file}:${index + 1} contains upstream branding in a customer-visible translation value`,
      );
    }
  });
}

const languageBundleFiles = [
  ...walkFiles("resources/assets/js/i18n"),
  ...walkFiles("public/_lang"),
];
const staleLanguageBundleTokens = [
  '"homeFeed": "Home Feed"',
  '"localFeed": "Local Feed"',
  '"globalFeed": "Global Feed"',
  '"discover": "Discover"',
  '"backToPreviousDesign": "Go back to previous design"',
  "Network Feed",
];

for (const file of languageBundleFiles) {
  const text = read(file);
  for (const token of staleLanguageBundleTokens) {
    if (text.includes(token)) {
      failures.push(`${file} contains stale member navigation copy: ${token}`);
    }
  }
}

const packageJson = JSON.parse(read("package.json"));
if (packageJson.name !== "mochirii-social-ops") {
  failures.push(`package.json name must be mochirii-social-ops, got: ${packageJson.name}`);
}
if (packageJson.devDependencies?.axios !== ">=1.18.1") {
  failures.push("package.json must require axios >=1.18.1");
}

const packageLock = JSON.parse(read("package-lock.json"));
if (packageLock.packages?.["node_modules/axios"]?.version !== "1.18.1") {
  failures.push("package-lock.json must resolve axios 1.18.1");
}

const vendorLicense = read("public/js/vendor.js.LICENSE.txt");
requireIncludes("public/js/vendor.js.LICENSE.txt", vendorLicense, [
  "Axios v1.18.1 Copyright",
]);
if (vendorLicense.includes("Axios v1.18.0")) {
  failures.push("public/js/vendor.js.LICENSE.txt contains the stale Axios 1.18.0 bundle");
}

const composerJson = JSON.parse(read("composer.json"));
if (composerJson.require?.php !== "^8.3|^8.4" || composerJson.config?.platform?.php !== "8.3.0") {
  failures.push("composer.json must resolve dependencies at the declared PHP 8.3 support floor");
}

const gitAttributes = read(".gitattributes");
requireIncludes(".gitattributes", gitAttributes, [
  "public/**/*.js text eol=lf -diff",
  "public/**/*.js.LICENSE.txt text eol=lf -diff",
  "public/**/*.json text eol=lf -diff",
  "public/**/*.css text eol=lf -diff",
]);

const readme = read("README.md");
requireIncludes("README.md", readme, [
  "Mochirii Social Ops",
  "social.mochirii.com",
  "DigitalOcean Spaces",
  "Federation disabled",
  "Do not commit host `.env` files",
  "isolated temporary clone",
]);

const staleReadmeMarketing = [
  "pixelfed-full-color",
  "poser.pugx",
  "fedidb",
  "YunoHost",
  "opencollective.com",
  "Made with love",
];

for (const token of staleReadmeMarketing) {
  if (readme.includes(token)) {
    failures.push(`README.md still contains upstream marketing token: ${token}`);
  }
}

const originFetch = gitRemote(["get-url", "origin"]);
const originPush = gitRemote(["get-url", "--push", "origin"]);
if (!isCanonicalRemote(originFetch)) {
  failures.push("origin fetch URL must point at the canonical repository");
}
if (!isCanonicalRemote(originPush)) {
  failures.push("origin push URL must point at the canonical repository");
}

const sourceSnapshot = read("SOURCE-SNAPSHOT.md");
requireIncludes("SOURCE-SNAPSHOT.md", sourceSnapshot, [
  "7e276f225b63ab17a227353ed5f6cb829777eb91",
  "c8bed78bee3d796c5efb57393dafafbba3706f38",
  "sanitized current-state snapshot",
]);

const syncDoc = read("docs/mochirii-social-sync.md");
requireIncludes("docs/mochirii-social-sync.md", syncDoc, [
  "MOCHIRII_SOCIAL_SYNC_URL",
  "MOCHIRII_SOCIAL_SYNC_SECRET",
  "social_accounts",
  "federation_enabled = false",
  "hard safety caps",
  "at most 300 seconds",
  "must not create",
  "a positive cache entry",
  "authenticated invalidation hook",
]);

const onlineRuntimeDoc = read("docs/online-hosted-runtime.md");
requireIncludes("docs/online-hosted-runtime.md", onlineRuntimeDoc, [
  "docker exec pixelfed-app curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/api/service/readiness-check",
  "must always return opaque",
  "image workflow does not install or attest `/etc/caddy/Caddyfile`",
  "authorization-code client with S256 PKCE",
  "server-only `MOCHIRII_SOCIAL_OAUTH_CLIENT_ID`",
  "cached for no more than 300 seconds",
  "authenticated invalidation hook",
]);

const reliabilityPacket = readRepository(
  "docs/operations/SOCIAL-RELIABILITY-PROVIDER-PACKETS-2026-07-27.md",
);
requireIncludes(
  "docs/operations/SOCIAL-RELIABILITY-PROVIDER-PACKETS-2026-07-27.md",
  reliabilityPacket,
  [
    "## Packet D: atomic production Caddy boundary",
    "## Packet E: server-only Website OAuth client binding",
    "root-owned mode-`0600` backup",
    "atomically rename",
    "`MOCHIRII_SOCIAL_OAUTH_CLIENT_ID`",
    "`NEXT_PUBLIC_` equivalent",
  ],
);

const upstreamDoc = read("docs/upstream-sync-policy.md");
requireIncludes("docs/upstream-sync-policy.md", upstreamDoc, [
  "Fetch the official source only",
  "https://github.com/pixelfed/pixelfed.git",
  "isolated temporary clone",
  "DISABLED",
  "Do not commit secrets",
]);

const mediaDoc = read("docs/media-spaces-readiness.md");
requireIncludes("docs/media-spaces-readiness.md", mediaDoc, [
  "hard safety caps",
  "EXIF",
  "thumbnail",
  "DigitalOcean Space",
  "CORS",
  "https://social.mochirii.com",
  "backup",
  "local-after-cloud cleanup",
  "90 MiB",
  "95 MiB",
  "100 MB",
  "1080px",
  "640px",
  "320px",
  "EXIF/GPS",
]);

const fediverseDoc = read("docs/fediverse-activation-runbook.md");
requireIncludes("docs/fediverse-activation-runbook.md", fediverseDoc, [
  "disabled",
  "moderation",
  "report",
  "defederation",
  "blocklist",
  "deletion",
  "WebFinger",
  "NodeInfo",
  "remote delivery",
  "approval",
]);

const envExample = read(".env.example");
requireIncludes(".env.example", envExample, [
  'APP_NAME="Mochirii"',
  'OPEN_REGISTRATION="false"',
  'APP_REGISTER="false"',
  'PF_ALLOW_APP_REGISTRATION="false"',
  'ACTIVITY_PUB="false"',
  'MAIL_FROM_NAME="Mōchirīī Social"',
  'PF_INSTANCE_USE_BEAGLE_API="false"',
  'INSTANCE_NOTIFY_APP_GATEWAY="false"',
  'GROUPS_FEDERATION="false"',
  'MOCHIRII_READINESS_DEPENDENCY_TIMEOUT_SECONDS="2"',
]);

const envDockerExample = read(".env.docker.example");
requireIncludes(".env.docker.example", envDockerExample, [
  'APP_NAME="Mochirii"',
  'OPEN_REGISTRATION="false"',
  'APP_REGISTER="false"',
  'PF_ALLOW_APP_REGISTRATION="false"',
  'INSTANCE_DISCOVER_PUBLIC="false"',
  'MAX_PHOTO_SIZE="92160"',
  'MAX_AVATAR_SIZE="92160"',
  'MEDIA_TYPES="image/jpeg,image/jpg,image/png,image/webp"',
  'PHP_POST_MAX_SIZE="100M"',
  'PHP_UPLOAD_MAX_FILE_SIZE="95M"',
  'ACTIVITY_PUB="false"',
  'AP_REMOTE_FOLLOW="false"',
  'AP_INBOX="false"',
  'AP_OUTBOX="false"',
  'AP_SHAREDINBOX="false"',
  'ATOM_FEEDS="false"',
  'NODEINFO="false"',
  'WEBFINGER="false"',
  'PF_NETWORK_TIMELINE="false"',
  'PF_ACCT_MIGRATION_ENABLED="false"',
  'PF_ENABLE_CLOUD="true"',
  'PF_LOCAL_AVATAR_TO_CLOUD="true"',
  'MAIL_FROM_NAME="Mōchirīī Social"',
  'PF_INSTANCE_USE_BEAGLE_API="false"',
  'INSTANCE_NOTIFY_APP_GATEWAY="false"',
  'GROUPS_FEDERATION="false"',
  'MOCHIRII_READINESS_DEPENDENCY_TIMEOUT_SECONDS="2"',
]);

const envTesting = read(".env.testing");
requireIncludes(".env.testing", envTesting, [
  'APP_NAME="Mochirii"',
  'APP_REGISTER=false',
  'PF_ALLOW_APP_REGISTRATION=false',
]);

const adminInviteEmail = read("app/Mail/AdminInviteEmail.php");
requireIncludes("app/Mail/AdminInviteEmail.php", adminInviteEmail, [
  "config('mochirii-branding.display_name')",
]);
if (adminInviteEmail.includes("config('app.name')")) {
  failures.push("app/Mail/AdminInviteEmail.php must not expose the technical APP_NAME in an email subject");
}

const caddy = read("caddy/Caddyfile");
requireIncludes("caddy/Caddyfile", caddy, [
  "@dependencyReadiness path /api/service/readiness-check",
  'header @dependencyReadiness Cache-Control "private, no-store"',
  "respond @dependencyReadiness 404",
  "@retiredCreationAndTokenManagement path /installer /installer/*",
  "respond @retiredCreationAndTokenManagement 404",
  "reverse_proxy 127.0.0.1:8080",
  "header -Server",
  "trusted_proxies static 103.21.244.0/22",
  "198.41.128.0/17",
  "2c0f:f248::/32",
  "client_ip_headers CF-Connecting-IP X-Forwarded-For",
  "trusted_proxies_strict",
  "header_up X-Forwarded-For {client_ip}",
  "header_up X-Request-ID {http.request.uuid}",
  "header_down -Server",
  "header_down X-Request-ID {http.request.uuid}",
]);
if (caddy.split(/\s+/u).includes("/installer*")) {
  failures.push("caddy/Caddyfile must not use the overbroad /installer* matcher");
}
if (caddy.indexOf("respond @dependencyReadiness 404") > caddy.indexOf("reverse_proxy 127.0.0.1:8080")) {
  failures.push("caddy/Caddyfile must reject readiness before the public reverse proxy");
}
if (/\{http\.request\.header\.x-request-id\}/iu.test(caddy)) {
  failures.push("caddy/Caddyfile must overwrite rather than trust a caller-supplied request ID");
}

const securityTxt = read("public/.well-known/security.txt");
for (const failure of securityTxtContractFailures(securityTxt)) {
  failures.push(`public/.well-known/security.txt ${failure}`);
}
if (/pixelfed|shopify/iu.test(securityTxt)) {
  failures.push("public/.well-known/security.txt must remain Mochirii-only public security metadata");
}

const securityPolicy = read("SECURITY.md");
requireIncludes("SECURITY.md", securityPolicy, [
  "support@mochirii.com",
  "https://social.mochirii.com/.well-known/security.txt",
  "https://github.com/Mochirii-Wushu/Mochirii-Website/security/policy",
]);
if (/hello@pixelfed\.org/iu.test(securityPolicy)) {
  failures.push("SECURITY.md must not direct Mochirii vulnerability reports to an upstream contact");
}

const requestIdMiddleware = read("app/Http/Middleware/MochiriiRequestId.php");
requireIncludes("app/Http/Middleware/MochiriiRequestId.php", requestIdMiddleware, [
  "public const HEADER = 'X-Request-ID'",
  "Log::withContext(['request_id' => $requestId])",
  "Log::withoutContext(['request_id'])",
  "preg_match(self::UUID_PATTERN",
]);
const httpKernel = read("app/Http/Kernel.php");
if (httpKernel.indexOf("MochiriiRequestId::class") > httpKernel.indexOf("HandleCors::class")) {
  failures.push("app/Http/Kernel.php must establish request correlation before other HTTP middleware");
}

const caddyInstaller = read("scripts/install-production-caddy.sh");
requireIncludes("scripts/install-production-caddy.sh", caddyInstaller, [
  "mktemp /etc/caddy/Caddyfile.mochirii-candidate.XXXXXX",
  "mktemp /etc/caddy/Caddyfile.mochirii-backup.XXXXXX",
  'install -m 0600 -o root -g root "$target_config" "$rollback_config"',
  'mv -f "$candidate_config" "$target_config"',
  "docker exec pixelfed-app curl",
  "retired_paths=(",
  "for path in /oauth/token /oauth/authorize",
]);

const dockerCompose = read("docker-compose.yml");
requireIncludes("docker-compose.yml", dockerCompose, [
  "mariadb:11.4@sha256:a794d9eb009e20de605858a11f32f63b4075cbd197c650436f0e3b457e4caed7",
  "redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2",
  "MARIADB_DATABASE: ${DB_DATABASE}",
  "condition: service_healthy",
  'MAX_PHOTO_SIZE: "92160"',
  'MAX_AVATAR_SIZE: "92160"',
  'PHP_POST_MAX_SIZE: "100M"',
  'PHP_UPLOAD_MAX_FILE_SIZE: "95M"',
  '"http://127.0.0.1:8080/api/service/readiness-check"',
  "start_period: 60s",
]);
const dockerComposeProduction = read("docker-compose.production.yml");
requireIncludes("docker-compose.production.yml", dockerComposeProduction, [
  "mariadb:11.4@sha256:a794d9eb009e20de605858a11f32f63b4075cbd197c650436f0e3b457e4caed7",
  "redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2",
  "MARIADB_DATABASE: ${DB_DATABASE}",
  "condition: service_healthy",
  '"http://127.0.0.1:8080/api/service/readiness-check"',
  "start_period: 60s",
]);
if (dockerCompose.includes("mysql:9")) {
  failures.push("docker-compose.yml must not restore the incompatible MySQL 9 runtime");
}
if (dockerCompose.includes("./bootstrap/cache:/var/www/html/bootstrap/cache")) {
  failures.push("docker-compose.yml must keep image-owned bootstrap/cache isolated from the host");
}

const immutableImageReference = "image: ${PIXELFED_IMAGE:-mochirii-pixelfed:local}";
if (dockerCompose.split(immutableImageReference).length - 1 !== 3) {
  failures.push("docker-compose.yml must apply PIXELFED_IMAGE to all three application services");
}

const cleanDatabaseCompose = read("docker-compose.ci.yml");
requireIncludes("docker-compose.ci.yml", cleanDatabaseCompose, [
  "pixelfed-ci-database:/var/lib/mysql",
  "pixelfed-ci-storage:/var/www/html/storage",
  "PIXELFED_IMAGE",
]);

const cleanDatabaseCheck = read("scripts/check-clean-database-migrations.sh");
requireIncludes("scripts/check-clean-database-migrations.sh", cleanDatabaseCheck, [
  "php artisan migrate --force --isolated --no-interaction",
  "php artisan horizon:status",
  "php artisan schedule:list --no-ansi",
  "pulse_values",
  "pulse_entries",
  "pulse_aggregates",
]);

const dockerfile = read("Dockerfile");
requireIncludes("Dockerfile", dockerfile, [
  "serversideup/php:8.4-fpm-nginx@sha256:8eec7ce8d9d6a38bbc6f0f70ef439aab2279646bc01d74cbe538dbeada4da828",
  'org.opencontainers.image.source="https://github.com/Mochirii-Wushu/Mochirii-Website"',
  "COPY --chmod=755 ./docker/entrypoint.d/ /etc/entrypoint.d/",
  "composer install --no-ansi --no-interaction --no-dev --optimize-autoloader",
  "php scripts/check-production-composer-dependencies.php",
]);

const productionImageBuild = read("scripts/build-production-image.sh");
requireIncludes("scripts/build-production-image.sh", productionImageBuild, [
  "org.opencontainers.image.source",
  "org.opencontainers.image.revision",
  "PIXELFED_IMAGE",
  "docker buildx build",
  "BUILD_CACHE_FROM",
  "BUILD_CACHE_TO",
]);

const verifiedBuildTools = readRepository("scripts/install-verified-social-build-tools.sh");
requireIncludes("scripts/install-verified-social-build-tools.sh", verifiedBuildTools, [
  'readonly BUILDX_VERSION="v0.35.0"',
  'readonly BUILDX_SHA256="d41ece72044243b4f58b343441ae37446d9c29a7d6b5e11c61847bbcf8f7dfda"',
  'readonly BUILDX_BUNDLE_SHA256="efe9f45ff054cb8c29c74b908958277423c6f4ef57350354f452e1672f91ddcf"',
  'readonly BUILDX_CERTIFICATE_IDENTITY="https://github.com/docker/github-builder/.github/workflows/bake.yml@5f637c833aa76bc99372a1dc9a6f8bcd8056fb85"',
  'readonly SYFT_VERSION="1.49.0"',
  'readonly SYFT_SHA256="7aa2f03ee92739cf643279ba3990548b9925d4e22cae13f46831ee62821147fe"',
  'readonly SYFT_CHECKSUMS_SHA256="1870142953acd02a9de2f5ff019087cee4a6dc03e4a7c15b67de7b1dc48e0865"',
  'readonly SYFT_CERTIFICATE_IDENTITY="https://github.com/anchore/syft/.github/workflows/release.yaml@refs/heads/main"',
  "cosign verify-blob",
  "sha256sum --check --strict -",
]);

const validationWorkflow = readRepository(".github/workflows/validate-social.yml");
requireIncludes(".github/workflows/validate-social.yml", validationWorkflow, [
  "name: validate-social",
  "Detect Social changes",
  "services/social",
  "permissions:\n  contents: read",
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
  "Rebuild and verify committed Social assets",
  "tests/Feature/DisabledUpstreamServicesTest.php",
  "tests/Feature/MochiriiBrandingTest.php",
  "tests/Feature/ReadinessBoundarySourceContractTest.php",
  "tests/Feature/RetiredAccountCreationBoundaryTest.php",
  "tests/Feature/PassportSurfaceBoundaryTest.php",
  "tests/Feature/ExceptionHandlerTest.php",
  "tests/Feature/RetiredSurfaceSourceContractTest.php",
  "npm run production",
  "git diff --exit-code",
  "git ls-files --others --exclude-standard",
  "Social production assets include uncommitted generated files.",
  "shivammathur/setup-php@f3e473d116dcccaddc5834248c87452386958240 # 2.37.2",
  "tools: composer:2.10.2",
  "persist-credentials: false",
  "packages: write",
  "docker login ghcr.io",
  "docker buildx imagetools inspect",
  "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6 # v4.1.2",
  "cosign-release: v3.0.6",
  "bash scripts/install-verified-social-build-tools.sh",
  "docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c",
  "cache-binary: false",
  "image=moby/buildkit:v0.31.2@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec",
  "SYFT_CHECK_FOR_APP_UPDATE=false",
  'syft "$PIXELFED_IMAGE" -o spdx-json=pixelfed-sbom.spdx.json',
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6",
]);
if (validationWorkflow.includes("ghcr.io/anchore/syft:")) {
  failures.push("validate-social.yml must not use an unsigned Syft container image");
}

const deploymentWorkflow = readRepository(".github/workflows/deploy-social-production.yml");
requireIncludes(".github/workflows/deploy-social-production.yml", deploymentWorkflow, [
  "environment: social-production",
  "services/social/docker-compose.production.yml",
  "repository=Mochirii-Wushu/Mochirii-Website",
  "DEPLOY social.mochirii.com",
  "STAGE_PRIVATE_MEDIA_GATEWAY_UNDER_MAINTENANCE",
  "ANONYMOUS DENIAL AND CUTOVER VERIFIED",
  "gh attestation verify",
  "--source-digest",
  "--predicate-type https://spdx.dev/Document/v2.3",
  "persist-credentials: false",
]);

const productionDependencyGuard = read(
  "scripts/check-production-composer-dependencies.php",
);
requireIncludes(
  "scripts/check-production-composer-dependencies.php",
  productionDependencyGuard,
  [
    "composer.lock",
    "packages-dev",
    "vendor/composer/installed.json",
    "array_intersect_key",
  ],
);

const oauthKeyGuard = read("docker/entrypoint.d/20-secure-oauth-keys.sh");
requireIncludes(
  "docker/entrypoint.d/20-secure-oauth-keys.sh",
  oauthKeyGuard,
  [
    '"$app_dir/storage/oauth-private.key"',
    '"$app_dir/storage/oauth-public.key"',
    '[ -L "$key_path" ]',
    'chmod 600 "$key_path"',
  ],
);

const avatarPolicy = read("app/Services/AvatarUploadPolicy.php");
requireIncludes("app/Services/AvatarUploadPolicy.php", avatarPolicy, [
  "image/webp",
  "PRIMARY_SIZE = 640",
  "THUMBNAIL_SIZE = 320",
  "pixelfed.max_avatar_size",
]);

const avatarOptimizer = read("app/Jobs/AvatarPipeline/AvatarOptimize.php");
requireIncludes("app/Jobs/AvatarPipeline/AvatarOptimize.php", avatarOptimizer, [
  "PRIMARY_SIZE",
  "THUMBNAIL_SIZE",
  "deleteLocalSource",
  "uploadToCloud",
  "WebpEncoder",
]);

const avatarModal = read("resources/assets/components/partials/modal/UpdateAvatar.vue");
requireIncludes("resources/assets/components/partials/modal/UpdateAvatar.vue", avatarModal, [
  "window.App.config.account.avatar",
  "validateFile",
  "WebP",
  "optimized automatically",
]);

const routeMiddleware = read("app/Http/Middleware/AdminOrNotFound.php");
requireIncludes("app/Http/Middleware/AdminOrNotFound.php", routeMiddleware, [
  "class AdminOrNotFound",
  "abort_if(Auth::check() == false || Auth::user()->is_admin == false, 404)",
]);

const privateSocialMiddleware = read("app/Http/Middleware/MochiriiPrivateSocial.php");
requireIncludes("app/Http/Middleware/MochiriiPrivateSocial.php", privateSocialMiddleware, [
  "class MochiriiPrivateSocial",
  "auth/oidc/start",
  "auth/oidc/callback",
  "oauth/authorize",
  "oauth/token",
  "UserOidcMapping::where('user_id'",
  "MochiriiSocialSyncService $socialSync",
  "$this->socialSync->hasCurrentAccess",
  "mochirii_oidc_verified_at",
  "MochiriiLocalAccountPolicy $localAccountPolicy",
  "RefreshToken::where('access_token_id'",
  "$token->revoke()",
  "$authGuard->logout()",
  "$request->session()->invalidate()",
  "$path === '/oauth/authorize'",
]);

const localAccountPolicy = read("app/Services/MochiriiLocalAccountPolicy.php");
requireIncludes("app/Services/MochiriiLocalAccountPolicy.php", localAccountPolicy, [
  "class MochiriiLocalAccountPolicy",
  "REACTIVATABLE_STATUSES = ['disabled', 'delete']",
  "public function mayAuthenticate(User $user): bool",
  "public function mayAccess(User $user): bool",
]);

const federationBoundary = read("app/Http/Middleware/MochiriiFederationDisabled.php");
requireIncludes("app/Http/Middleware/MochiriiFederationDisabled.php", federationBoundary, [
  "class MochiriiFederationDisabled",
  "abort(404)",
]);

const federationConfig = read("config/federation.php");
for (const unsafeDefault of [
  "env('AP_OUTBOX', true)",
  "env('AP_INBOX', true)",
  "env('AP_SHAREDINBOX', true)",
  "env('ATOM_FEEDS', true)",
  "env('NODEINFO', true)",
  "env('WEBFINGER', true)",
  "env('PF_NETWORK_TIMELINE', true)",
]) {
  if (federationConfig.includes(unsafeDefault)) {
    failures.push(`config/federation.php retains unsafe federation default: ${unsafeDefault}`);
  }
}

const upstreamServices = read("app/Services/Internal/BeagleService.php");
requireIncludes("app/Services/Internal/BeagleService.php", upstreamServices, [
  "private static function enabled(): bool",
  "if (! self::enabled())",
]);
const notificationGateway = read("app/Services/NotificationAppGatewayService.php");
requireIncludes("app/Services/NotificationAppGatewayService.php", notificationGateway, [
  "if ((bool) config('instance.notifications.nag.enabled') === false)",
]);
const upstreamBoundaryTests = read("tests/Feature/DisabledUpstreamServicesTest.php");
requireIncludes("tests/Feature/DisabledUpstreamServicesTest.php", upstreamBoundaryTests, [
  "Http::preventStrayRequests()",
  "Http::assertNothingSent()",
  "upstream_discovery_and_push_services_default_to_disabled",
]);

const guestLayout = read("resources/views/layouts/app-guest.blade.php");
if (guestLayout.includes("maximum-scale=1") || guestLayout.includes("user-scalable=no")) {
  failures.push("resources/views/layouts/app-guest.blade.php must preserve browser zoom");
}

const runtimeLibrary = read("scripts/production-runtime-lib.sh");
requireIncludes("scripts/production-runtime-lib.sh", runtimeLibrary, [
  "emit_container_diagnostics",
  "Container logs can contain signed object URLs",
  "state={{.State.Status}}",
  "restart_count={{.RestartCount}}",
]);
if (runtimeLibrary.includes("docker logs")) {
  failures.push("scripts/production-runtime-lib.sh must not emit container logs into deployment diagnostics");
}

const webRoutes = read("routes/web.php");
requireIncludes("routes/web.php", webRoutes, [
  "Route::get('discover', 'DiscoverController@home')->name('discover')->middleware('admin.notfound')",
  "Route::get('discover/tags/{hashtag}', 'DiscoverController@showTags')->middleware('admin.notfound')",
  "Route::get('network', 'TimelineController@network')->name('timeline.network')->middleware('admin.notfound')",
  "Route::get('import', fn () => abort(404))->name('help.import')",
  "Route::get('discover', fn () => abort(404))->name('help.discover')",
  "Route::post('data-export/account', 'SettingsController@exportAccount')->middleware(['dangerzone', 'admin.notfound'])",
  "'oauth/clients',",
  "'oauth/personal-access-tokens',",
  "'oauth/token/refresh',",
  "'settings/developers',",
  "'settings/applications',",
  'Route::any("{$retiredPath}/{path?}", static fn () => abort(404))',
  "Route::get('labs', 'SettingsController@labs')->name('settings.labs')->middleware('admin.notfound')",
  "Route::group(['prefix' => 'import', 'middleware' => ['dangerzone', 'admin.notfound']]",
  "middleware('mochirii.federation-disabled')",
]);
for (const retiredControllerRoute of [
  "SettingsController@applications",
  "SettingsController@developers",
  "Passport\\AuthorizedAccessTokenController",
  "Passport\\ClientController",
  "Passport\\PersonalAccessTokenController",
]) {
  if (webRoutes.includes(retiredControllerRoute)) {
    failures.push(`routes/web.php restores retired account/client surface: ${retiredControllerRoute}`);
  }
}

const apiRoutes = read("routes/api.php");
requireIncludes("routes/api.php", apiRoutes, [
  "['mochirii.private:api', 'auth:api', 'validemail']",
  "Route::middleware('mochirii.federation-disabled')->group",
  "storage/m/_v2/{pid}/{mhash}/{uhash}/{f}",
  "Route::get('instance', 'Api\\ApiV1Controller@instance')->middleware($middleware)",
  "Route::get('instance', 'Api\\ApiV2Controller@instance')->middleware($middleware)",
  "Route::get('custom_emojis', 'Api\\ApiV1Controller@customEmojis')->middleware($middleware)",
  "Route::get('accounts/lookup', 'Api\\ApiV1Controller@accountLookupById')",
  "Route::post('apps', fn () => abort(404))",
]);

const instanceApiV1 = read("app/Http/Controllers/Api/ApiV1Controller.php");
const instanceApiV2 = read("app/Http/Controllers/Api/ApiV2Controller.php");
requireIncludes("app/Http/Controllers/Api/ApiV1Controller.php", instanceApiV1, [
  "3.5.3 (compatible; Mōchirīī Social)",
]);
requireIncludes("app/Http/Controllers/Api/ApiV2Controller.php", instanceApiV2, [
  "3.5.3 (compatible; Mōchirīī Social)",
  "https://github.com/Mochirii-Wushu/Mochirii-Website",
]);
for (const [file, text] of [
  ["app/Http/Controllers/Api/ApiV1Controller.php", instanceApiV1],
  ["app/Http/Controllers/Api/ApiV2Controller.php", instanceApiV2],
]) {
  if (text.includes("compatible; Pixelfed") || text.includes("compatible; Mochirii Social") || text.includes("github.com/pixelfed/pixelfed")) {
    failures.push(`${file} exposes upstream branding in member-facing instance metadata`);
  }
}

const oidcController = read("app/Http/Controllers/RemoteOidcController.php");
requireIncludes("app/Http/Controllers/RemoteOidcController.php", oidcController, [
  "Current verified guild membership is required to enter Mōchirīī Social.",
]);
if (oidcController.includes("enter Mochirii Social")) {
  failures.push("app/Http/Controllers/RemoteOidcController.php exposes the backend spelling in a member-facing error");
}

const privateBoundaryTests = read("tests/Feature/PrivateSocialBoundaryTest.php");
requireIncludes("tests/Feature/PrivateSocialBoundaryTest.php", privateBoundaryTests, [
  "signed_out_member_content_fails_closed",
  "an_oidc_verified_social_member_passes_the_private_boundary",
  "signed_out_api_profile_and_instance_surfaces_do_not_render_member_data",
  "federation_endpoints_stay_unavailable",
  "a_locally_suspended_web_member_is_logged_out_and_the_session_is_invalidated",
  "a_finalized_deleted_local_account_is_denied_before_remote_sync",
  "signed_out_authorization_and_logout_entry_points_remain_reachable",
  "denied_api_access_revokes_the_current_access_and_refresh_tokens",
  "anonymous_oauth_client_registration_is_unavailable",
]);

const websiteNavigationFiles = [
  "apps/web/lib/site-navigation.ts",
  "apps/web/components/SiteHeader.tsx",
  "apps/web/components/SiteFooter.tsx",
];
for (const file of websiteNavigationFiles) {
  const text = readRepository(file);
  for (const token of ["Pixelfed", "Fediverse", "Mastodon"]) {
    if (text.toLowerCase().includes(token.toLowerCase())) {
      failures.push(`${file} exposes upstream Social branding in Website navigation: ${token}`);
    }
  }
}

const socialLoginSmoke = readRepository("scripts/smoke-social-login.mjs");
requireIncludes("scripts/smoke-social-login.mjs", socialLoginSmoke, [
  '["Chromium", chromium]',
  '["Firefox", firefox]',
  '["WebKit", webkit]',
  '{ label: "320 portrait", width: 320, height: 568 }',
  '{ label: "320 landscape", width: 568, height: 320 }',
  '{ label: "360 portrait", width: 360, height: 800 }',
  'label: "390 portrait"',
  "width: 390",
  "height: 844",
  "safeArea: { top: 47, right: 0, bottom: 34, left: 0 }",
  "keyboardResize: true",
  "Internal guild social platform for profiles, photos & staying connected. Only verified members can access here & everything is private with no data sharing outside.",
  'APP_NAME: "Mochirii"',
  "public navigation exposes upstream branding",
  "document overflows horizontally",
  "primary control is shorter than 44px",
  "100dvh does not follow the 100vh fallback",
  "keyboard-like viewport resize",
  "physical Safari remains a separate gate",
  "verifyConsentAuthorizationIdRoundTrip",
  "browser login round trip changes the authorization id",
]);

const repositoryPackageJson = JSON.parse(readRepository("package.json"));
if (repositoryPackageJson.scripts?.["smoke:social-login"] !== "node scripts/smoke-social-login.mjs") {
  failures.push("package.json must expose the smoke:social-login browser contract");
}

const settingsSidebar = read("resources/views/settings/partial/sidebar.blade.php");
requireIncludes("resources/views/settings/partial/sidebar.blade.php", settingsSidebar, [
  "Auth::user()->is_admin",
  "settings.import",
  "settings.dataexport",
  "settings.labs",
]);
for (const retiredSetting of ["settings.applications", "settings.developers", "settings.invites"]) {
  if (settingsSidebar.includes(retiredSetting)) {
    failures.push(`resources/views/settings/partial/sidebar.blade.php exposes retired setting: ${retiredSetting}`);
  }
}

const spaRoutes = read("resources/assets/js/spa.js");
requireIncludes("resources/assets/js/spa.js", spaRoutes, [
  "function adminOnlyRoute",
  "return next('/i/web/404')",
  'path: "/i/web/discover"',
  "beforeEnter: adminOnlyRoute",
]);

const spaSidebar = read("resources/assets/components/partials/sidebar.vue");
for (const staleNav of [
  'to="/i/web/discover"',
  "force_old_ui=1",
  "backToPreviousDesign",
]) {
  if (spaSidebar.includes(staleNav)) {
    failures.push(`resources/assets/components/partials/sidebar.vue still exposes stale member nav: ${staleNav}`);
  }
}

if (failures.length > 0) {
  console.error("Mochirii ops readiness failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Mochirii ops readiness passed.");
