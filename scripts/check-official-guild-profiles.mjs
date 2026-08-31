import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  FOOTER_GUILD_PROFILES,
  HEADER_GUILD_PROFILES,
  OFFICIAL_GUILD_PROFILES,
} from "./lib/public-urls.mjs";
import {
  PROFILE_PROVIDER_HOST_SUFFIXES,
  isProfileProviderHost,
} from "./lib/profile-provider-boundary.mjs";

const root = process.cwd();
const failures = [];
const requirePublicNameApproval = process.argv.includes("--require-public-name-approval");
const requireMetaMarks = process.argv.includes("--require-meta-marks");
const requireAllMarks = process.argv.includes("--require-all-marks");

const expected = [
  {
    id: "facebook-page",
    label: "Facebook",
    accountLabel: "mochiriiguild",
    href: "https://www.facebook.com/mochiriiguild/",
    surfaces: ["header", "footer"],
  },
  {
    id: "instagram",
    label: "Instagram",
    accountLabel: "@mochirii_guild",
    href: "https://www.instagram.com/mochirii_guild/",
    surfaces: ["header", "footer"],
  },
  {
    id: "tiktok",
    label: "TikTok",
    accountLabel: "@mochiriiguild",
    href: "https://www.tiktok.com/@mochiriiguild",
    surfaces: ["header", "footer"],
  },
  {
    id: "twitch",
    label: "Twitch",
    accountLabel: "mochiriiguild",
    href: "https://www.twitch.tv/mochiriiguild",
    surfaces: ["header", "footer"],
  },
  {
    id: "youtube",
    label: "YouTube",
    accountLabel: "@MochiriiGuild",
    href: "https://www.youtube.com/@MochiriiGuild",
    surfaces: ["header", "footer"],
  },
];

const expectedMarkAssets = new Map([
  ["facebook-page", null],
  ["instagram", null],
  ["tiktok", null],
  ["twitch", null],
  ["youtube", null],
]);

const approvedAssetHashes = new Map([
  [
    "/assets/social-profiles/facebook-logo-secondary.png",
    "EED4F69A017B533E7115397E47B6BA75077D0AF5FB13369C0C5E819694CEEF57",
  ],
  [
    "/assets/social-profiles/instagram-glyph-white.svg",
    "3347813E9E8F082CDF48495818BD370CCFF94B687EFB8AA1C8A7B36CFCFB8291",
  ],
]);

const component = read("apps/web/components/OfficialGuildProfiles.tsx");
const header = read("apps/web/components/SiteHeader.tsx");
const footer = read("apps/web/components/SiteFooter.tsx");
const routeShell = read("apps/web/components/SiteRouteShell.tsx");
const layout = read("apps/web/app/layout.tsx");
const legacyGlobalCss = read("apps/web/app/mochirii.css");
const footerCss = read("apps/web/app/styles/shell-footer.css");
const css = read("apps/web/app/styles/shell-official-guild-profiles.css");
const smoke = read("scripts/smoke-official-guild-profiles.mjs");
const provenance = read("docs/integrations/official-guild-profile-assets.md");
const approvedPublicNameDecision = '- Public-name decision: `APPROVED_USER_2026-08-11`';
const blockedMetaMarkDecision = '- Meta mark decision: `BLOCKED_APPROVAL`';
const blockedTikTokMarkDecision = '- TikTok mark decision: `BLOCKED_EXTERNAL`';
const blockedTwitchMarkDecision = '- Twitch mark decision: `BLOCKED_APPROVAL`';
const blockedYouTubeMarkDecision = '- YouTube mark decision: `BLOCKED_APPROVAL`';

for (const decision of [
  approvedPublicNameDecision,
  blockedMetaMarkDecision,
  blockedTikTokMarkDecision,
  blockedTwitchMarkDecision,
  blockedYouTubeMarkDecision,
]) {
  if (provenance.split(/\r?\n/u).filter((line) => line === decision).length !== 1) {
    failures.push(`profile provenance must contain exactly one current decision marker: ${decision}`);
  }
}
if (/^- (?:Meta mark|TikTok mark|Twitch mark|YouTube mark) decision: `(?!BLOCKED_APPROVAL|BLOCKED_EXTERNAL)[^`]+`$/gmu.test(provenance)) {
  failures.push("profile provenance contains an unreviewed release decision value");
}

if (JSON.stringify(OFFICIAL_GUILD_PROFILES.map(withoutMark)) !== JSON.stringify(expected)) {
  failures.push("official profile configuration does not match the reviewed source contract");
}

const ids = OFFICIAL_GUILD_PROFILES.map((profile) => profile.id);
const hrefs = OFFICIAL_GUILD_PROFILES.map((profile) => profile.href);
if (new Set(ids).size !== ids.length) failures.push("official profile IDs must be unique");
if (new Set(hrefs).size !== hrefs.length) failures.push("official profile URLs must be unique");
for (const staleDestination of [
  "https://www.facebook.com/mochiriiguildpage",
  "https://www.facebook.com/groups/mochiriiguild",
]) {
  if (hrefs.includes(staleDestination)) failures.push(`retired profile destination remains configured: ${staleDestination}`);
}

for (const profile of OFFICIAL_GUILD_PROFILES) {
  let url;
  try {
    url = new URL(profile.href);
  } catch {
    failures.push(`${profile.id}: invalid profile URL`);
    continue;
  }
  if (url.protocol !== "https:") failures.push(`${profile.id}: profile URL must use HTTPS`);
  if (url.username || url.password || url.search || url.hash) {
    failures.push(`${profile.id}: credentials, tracking parameters, queries, and fragments are forbidden`);
  }
  if (!Array.isArray(profile.surfaces) || !profile.surfaces.length) {
    failures.push(`${profile.id}: at least one display surface is required`);
  }
  for (const surface of profile.surfaces) {
    if (!new Set(["header", "footer"]).has(surface)) failures.push(`${profile.id}: unsupported surface ${surface}`);
  }
}

const expectedProfileIds = ["facebook-page", "instagram", "tiktok", "twitch", "youtube"];
assertIds("header", HEADER_GUILD_PROFILES, expectedProfileIds);
assertIds("footer", FOOTER_GUILD_PROFILES, expectedProfileIds);

for (const snippet of [
  'placement="header"',
  'placement="mobile"',
  'group.id === "guild"',
]) assertIncludes("SiteHeader", header, snippet);
assertIncludes("SiteFooter", footer, '<OfficialGuildProfiles placement="footer" />');
for (const snippet of [
  'pathname === "/spinner"',
  'pathname.startsWith("/spinner/")',
  "if (isIsolatedSpinnerPath(pathname)) return children;",
  "<SiteHeader {...auth} />",
  "<SiteFooter authState={auth.authState}",
]) assertIncludes("SiteRouteShell", routeShell, snippet);
assertNotIncludes("SiteRouteShell", routeShell, "OfficialGuildProfiles");
assertIncludes("profile component", component, 'role="group"');
assertIncludes("profile component", component, 'aria-label={placementLabels[placement]}');
assertIncludes("profile component", component, 'Official Mōchirīī social profiles in the Guild menu');
assertIncludes("profile component", component, 'Official Mōchirīī social profiles in the mobile menu');
assertIncludes("profile component", component, 'Official Mōchirīī social profiles in the footer');
assertNotIncludes("profile component", component, "<section");
assertIncludes("profile component", component, 'className="sr-only"> external profile');
assertIncludes("profile component", component, '<span className="sr-only">{profile.label}</span>');
assertIncludes("profile component", component, 'data-official-profile={profile.id}');
assertIncludes("profile component", component, 'referrerPolicy="no-referrer"');
assertNotIncludes("profile component", component, "target=");
assertNotIncludes("profile component", component, "rel=");
assertNotIncludes("profile component", component, "https://");
assertIncludes("profile CSS", css, "min-height:44px");
assertIncludes("profile CSS", css, "gap:12px");
assertIncludes("profile CSS", css, "width:36px");
assertIncludes("profile CSS", css, ".official-profile-link:focus-visible");
assertIncludes("profile CSS", css, "overflow-wrap:anywhere");

const shellSources = [component, header, footer, routeShell, layout, legacyGlobalCss, footerCss, css];
for (const suffix of PROFILE_PROVIDER_HOST_SUFFIXES) {
  if (shellSources.some((source) => source.toLowerCase().includes(suffix))) {
    failures.push(`profile shell source must not name provider resource hosts: ${suffix}`);
  }
}
const forbiddenPreActivationPatterns = [
  /\b(?:preconnect|dns[-_]?prefetch|prefetchdns)\b/iu,
  /<link\b/u,
  /\bcreateElement(?:NS)?\b/iu,
  /<(?:iframe|script)\b/iu,
  /\bfetch\s*\(/iu,
  /\bnavigator\.sendBeacon\s*\(/iu,
  /\bnew\s+WebSocket\s*\(/iu,
  /\burl\(\s*["']?https?:/iu,
];
for (const source of shellSources) {
  const pattern = forbiddenPreActivationPatterns.find((candidate) => candidate.test(source));
  if (pattern) failures.push(`profile shell contains a forbidden pre-activation resource primitive: ${pattern}`);
}
for (const hostileSource of [
  '<link rel={"dns-prefetch"} href={new URL(profile.href).origin} />',
  "ReactDOM.preconnect(profile.href)",
  "ReactDOM.prefetchDNS(profile.href)",
  'const link = document.createElement("link"); link.rel = ["pre", "connect"].join("");',
  'const link = document.createElement(`link`); link.rel = ["dns", "prefetch"].join("-");',
  'const link = document.createElementNS("http://www.w3.org/1999/xhtml", ["li", "nk"].join(""));',
  'document.createElement.call(document, "link")',
  'document.createElement.bind(document)("link")',
  'document["createElement"]("link")',
]) {
  if (!forbiddenPreActivationPatterns.some((pattern) => pattern.test(hostileSource))) {
    failures.push(`pre-activation primitive canary was not detected: ${hostileSource}`);
  }
}

const expectedProviderSuffixes = [
  "byteimg.com", "byteimg.eu", "byteoversea.com", "cdninstagram.com", "facebook.com",
  "facebook.net", "fb.com", "fbcdn.net", "fbsbx.com", "ibytedtos.com", "instagram.com",
  "meta.com", "muscdn.com", "musical.ly", "tiktok.com", "tiktokcdn.com",
  "tiktokcdn-eu.com", "tiktokcdn-us.com", "tiktokrow-cdn.com", "tiktokv.com",
  "tiktokv.us", "ttlivecdn.com", "ttwstatic.com",
  "twitch.tv", "twitchcdn.net", "ttvnw.net", "youtube.com",
  "youtube-nocookie.com", "youtu.be", "ytimg.com", "googlevideo.com", "ggpht.com",
];
if (JSON.stringify(PROFILE_PROVIDER_HOST_SUFFIXES) !== JSON.stringify(expectedProviderSuffixes)) {
  failures.push("profile provider host-family inventory drifted");
}
for (const hostname of [
  "connect.facebook.net", "static.xx.fbcdn.net", "scontent.cdninstagram.com",
  "api.meta.com", "www.tiktokcdn.com", "analytics.tiktokv.com",
  "sf16-website-login.neutral.ttwstatic.com", "p16-sign.tiktokcdn-us.com",
  "mssdk-va.byteoversea.com", "api.ibytedtos.com", "www.musical.ly",
  "player.twitch.tv", "static.twitchcdn.net", "video-edge.ttvnw.net",
  "www.youtube.com", "i.ytimg.com", "redirector.googlevideo.com", "yt3.ggpht.com",
]) {
  if (!isProfileProviderHost(hostname)) failures.push(`provider host-family canary was not detected: ${hostname}`);
}
for (const hostname of [
  "facebook.com.example", "notfacebook.com", "tiktok.com.example", "twitch.tv.example",
  "youtube.com.example", "notyoutube.com", "mochirii.com",
]) {
  if (isProfileProviderHost(hostname)) failures.push(`provider host-family lookalike was accepted: ${hostname}`);
}
for (const hostname of [
  "twitchcdn.net.example", "notttvnw.net", "youtube-nocookie.com.example",
  "notyoutu.be", "ytimg.com.example", "notgooglevideo.com", "ggpht.com.example",
]) {
  if (isProfileProviderHost(hostname)) failures.push(`provider host-family lookalike was accepted: ${hostname}`);
}
for (const snippet of [
  "isProfileProviderHost(url.hostname)",
  "unexpectedExternalRequests",
  "permittedPreActivationOrigins.has(url.origin)",
]) assertIncludes("profile browser smoke", smoke, snippet);

const assetDirectory = resolve(root, "apps/web/public/assets/social-profiles");
const assetFiles = existsSync(assetDirectory)
  ? readdirSync(assetDirectory)
  : [];
const configuredAssets = [...new Set(
  OFFICIAL_GUILD_PROFILES
    .map((profile) => profile.markAsset)
    .filter((asset) => typeof asset === "string"),
)];

for (const profile of OFFICIAL_GUILD_PROFILES) {
  if (profile.markAsset !== expectedMarkAssets.get(profile.id)) {
    failures.push(`${profile.id}: configured mark does not match the reviewed asset contract`);
  }
}

for (const asset of configuredAssets) {
  if (!asset.startsWith("/assets/social-profiles/")) {
    failures.push(`${asset}: profile marks must stay in the canonical local asset boundary`);
    continue;
  }
  const full = resolve(root, "apps/web/public", asset.slice(1));
  const relativeAssetPath = relative(assetDirectory, full);
  if (
    !relativeAssetPath
    || relativeAssetPath === ".."
    || relativeAssetPath.startsWith(`..${sep}`)
    || isAbsolute(relativeAssetPath)
  ) {
    failures.push(`${asset}: resolved profile mark escapes the canonical local asset boundary`);
    continue;
  }
  if (!existsSync(full)) {
    failures.push(`${asset}: configured profile mark is missing`);
    continue;
  }
  const bytes = readFileSync(full);
  const extension = extname(full).toLowerCase();
  if (extension === ".svg") validateSvgAsset(asset, bytes.toString("utf8"));
  else if (extension === ".png") validatePngAsset(asset, bytes);
  else failures.push(`${asset}: reviewed profile marks must be SVG or PNG`);

  const hash = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (hash !== approvedAssetHashes.get(asset)) failures.push(`${asset}: SHA-256 does not match the reviewed asset contract`);
  if (!provenance.includes(hash)) failures.push(`${asset}: SHA-256 is not recorded in the provenance registry`);
}

for (const file of assetFiles) {
  const publicPath = `/assets/social-profiles/${file}`;
  if (!configuredAssets.includes(publicPath)) failures.push(`${publicPath}: unreferenced profile asset`);
}

const byId = new Map(OFFICIAL_GUILD_PROFILES.map((profile) => [profile.id, profile]));
if (requirePublicNameApproval && !provenance.includes(approvedPublicNameDecision)) {
  failures.push("the exact five-profile public-name approval is required before publication");
}
if (requireMetaMarks) {
  if (provenance.includes(blockedMetaMarkDecision)) {
    failures.push("exact Meta mark approval is required before Meta artwork may be published");
  }
  for (const id of ["facebook-page", "instagram"]) {
    if (!byId.get(id)?.markAsset) failures.push(`${id}: official Meta mark is required for this release gate`);
  }
}
if (requireAllMarks) {
  if ([blockedMetaMarkDecision, blockedTikTokMarkDecision, blockedTwitchMarkDecision, blockedYouTubeMarkDecision]
    .some((decision) => provenance.includes(decision))) {
    failures.push("approved mark decisions are required before all provider artwork may be published");
  }
  for (const id of expectedProfileIds) {
    if (!byId.get(id)?.markAsset) failures.push(`${id}: official permitted mark is required for this release gate`);
  }
  if (/No permission evidence is recorded|No authoritative record currently proves/iu.test(provenance)) {
    failures.push("TikTok written-permission evidence is required before the all-marks release gate can pass");
  }
}

if (failures.length) {
  console.error("Official guild profile contract failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Official guild profile contract passed.");
console.log(`- Header/mobile profiles: ${HEADER_GUILD_PROFILES.map((profile) => profile.label).join(", ")}.`);
console.log(`- Footer destinations: ${FOOTER_GUILD_PROFILES.map((profile) => profile.label).join(", ")}.`);
console.log(`- Local reviewed marks: ${configuredAssets.length}; runtime request evidence requires the browser smoke.`);

function withoutMark(profile) {
  const { markAsset: _markAsset, ...rest } = profile;
  return rest;
}

function assertIds(label, profiles, expectedIds) {
  const actual = profiles.map((profile) => profile?.id || "missing");
  if (JSON.stringify(actual) !== JSON.stringify(expectedIds)) {
    failures.push(`${label}: expected ${expectedIds.join(", ")}; received ${actual.join(", ")}`);
  }
}

function read(relativePath) {
  const full = resolve(root, relativePath);
  if (!existsSync(full)) {
    failures.push(`${relativePath}: missing required file`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function assertIncludes(label, source, snippet) {
  if (!source.includes(snippet)) failures.push(`${label}: missing ${snippet}`);
}

function assertNotIncludes(label, source, snippet) {
  if (source.includes(snippet)) failures.push(`${label}: unexpected ${snippet}`);
}

function validateSvgAsset(asset, source) {
  for (const pattern of [
    /<!DOCTYPE\b/iu,
    /<!ENTITY\b/iu,
    /<script\b/iu,
    /<foreignObject\b/iu,
    /<(?:animate|animateMotion|animateTransform|set)\b/iu,
    /<image\b/iu,
    /\bon[a-z]+\s*=/iu,
    /\bxml:base\s*=/iu,
    /@import\b/iu,
  ]) {
    if (pattern.test(source)) failures.push(`${asset}: unsafe or active SVG content`);
  }
  for (const match of source.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/giu)) {
    if (!match[1].startsWith("#")) failures.push(`${asset}: SVG references must remain same-document fragments`);
  }
  for (const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/giu)) {
    if (!match[2].startsWith("#")) failures.push(`${asset}: CSS URL references must remain same-document fragments`);
  }
}

function validatePngAsset(asset, bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) {
    failures.push(`${asset}: invalid PNG signature or truncated header`);
    return;
  }

  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  const permittedChunks = new Set(["IHDR", "pHYs", "IDAT", "IEND"]);

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const nextOffset = offset + 12 + length;
    if (nextOffset > bytes.length) {
      failures.push(`${asset}: truncated PNG chunk ${type || "unknown"}`);
      return;
    }
    if (!permittedChunks.has(type)) failures.push(`${asset}: unreviewed PNG chunk ${type}`);
    if (type === "IHDR") {
      if (sawHeader || offset !== 8 || length !== 13) failures.push(`${asset}: malformed PNG IHDR`);
      sawHeader = true;
      const width = bytes.readUInt32BE(offset + 8);
      const height = bytes.readUInt32BE(offset + 12);
      const bitDepth = bytes[offset + 16];
      const colorType = bytes[offset + 17];
      if (width !== 2084 || height !== 2084 || bitDepth !== 8 || colorType !== 6) {
        failures.push(`${asset}: PNG geometry or RGBA format drifted from the reviewed source`);
      }
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      if (length !== 0 || nextOffset !== bytes.length) failures.push(`${asset}: malformed PNG end marker or trailing data`);
      sawEnd = true;
      break;
    }
    offset = nextOffset;
  }

  if (!sawHeader || !sawImageData || !sawEnd) failures.push(`${asset}: incomplete PNG structure`);
}
