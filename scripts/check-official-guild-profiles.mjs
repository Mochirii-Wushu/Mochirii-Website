import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  FOOTER_GUILD_PROFILES,
  HEADER_GUILD_PROFILES,
  OFFICIAL_GUILD_PROFILES,
  ORGANIZATION_PROFILE_URLS,
} from "./lib/public-urls.mjs";

const root = process.cwd();
const failures = [];
const requireMetaMarks = process.argv.includes("--require-meta-marks");
const requireAllMarks = process.argv.includes("--require-all-marks");

const expected = [
  {
    id: "facebook-page",
    label: "Facebook",
    accountLabel: "Mōchirīī Guild Page",
    href: "https://www.facebook.com/mochiriiguildpage",
    surfaces: ["header", "footer"],
    organizationIdentity: true,
  },
  {
    id: "instagram",
    label: "Instagram",
    accountLabel: "@mochirii_guild",
    href: "https://www.instagram.com/mochirii_guild",
    surfaces: ["header", "footer"],
    organizationIdentity: true,
  },
  {
    id: "tiktok",
    label: "TikTok",
    accountLabel: "@mochiriiguild",
    href: "https://www.tiktok.com/@mochiriiguild",
    surfaces: ["header", "footer"],
    organizationIdentity: true,
  },
  {
    id: "facebook-group",
    label: "Facebook Group",
    accountLabel: "Mōchirīī Guild",
    href: "https://www.facebook.com/groups/mochiriiguild",
    surfaces: ["footer"],
    organizationIdentity: false,
  },
  {
    id: "twitch",
    label: "Twitch",
    accountLabel: "@mochiriiguild",
    href: "https://www.twitch.tv/mochiriiguild",
    surfaces: ["footer"],
    organizationIdentity: true,
  },
];

const expectedMarkAssets = new Map([
  ["facebook-page", "/assets/social-profiles/facebook-logo-secondary.png"],
  ["instagram", "/assets/social-profiles/instagram-glyph-white.svg"],
  ["tiktok", null],
  ["facebook-group", "/assets/social-profiles/facebook-logo-secondary.png"],
  ["twitch", null],
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
const home = read("apps/web/app/page.tsx");
const css = read("apps/web/app/styles/shell-official-guild-profiles.css");
const provenance = read("docs/integrations/official-guild-profile-assets.md");

if (JSON.stringify(OFFICIAL_GUILD_PROFILES.map(withoutMark)) !== JSON.stringify(expected)) {
  failures.push("official profile configuration does not match the approved ordered contract");
}

const ids = OFFICIAL_GUILD_PROFILES.map((profile) => profile.id);
const hrefs = OFFICIAL_GUILD_PROFILES.map((profile) => profile.href);
if (new Set(ids).size !== ids.length) failures.push("official profile IDs must be unique");
if (new Set(hrefs).size !== hrefs.length) failures.push("official profile URLs must be unique");

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

assertIds("header", HEADER_GUILD_PROFILES, ["facebook-page", "instagram", "tiktok"]);
assertIds("footer", FOOTER_GUILD_PROFILES, ["facebook-page", "instagram", "tiktok", "facebook-group", "twitch"]);
assertIds(
  "organization identity",
  ORGANIZATION_PROFILE_URLS.map((href) => OFFICIAL_GUILD_PROFILES.find((profile) => profile.href === href)),
  ["facebook-page", "instagram", "tiktok", "twitch"],
);

for (const snippet of [
  'placement="header"',
  'placement="mobile"',
  'group.id === "guild"',
]) assertIncludes("SiteHeader", header, snippet);
assertIncludes("SiteFooter", footer, '<OfficialGuildProfiles placement="footer" />');
assertIncludes("Home Organization JSON-LD", home, "...ORGANIZATION_PROFILE_URLS");
assertIncludes("profile component", component, 'role="group"');
assertIncludes("profile component", component, 'aria-label={placementLabels[placement]}');
assertIncludes("profile component", component, 'Official Mōchirīī profiles in the Guild menu');
assertIncludes("profile component", component, 'Official Mōchirīī profiles in the mobile menu');
assertIncludes("profile component", component, 'Official Mōchirīī profiles in the footer');
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

for (const forbidden of ["platform.twitter.com", "connect.facebook.net", "instagram.com/embed", "tiktok.com/embed", "preconnect"]) {
  if ([component, header, footer].some((source) => source.includes(forbidden))) {
    failures.push(`profile shell must not load widgets or preconnect to providers: ${forbidden}`);
  }
}

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
if (requireMetaMarks) {
  for (const id of ["facebook-page", "instagram"]) {
    if (!byId.get(id)?.markAsset) failures.push(`${id}: official Meta mark is required for this release gate`);
  }
}
if (requireAllMarks) {
  for (const id of ["facebook-page", "instagram", "tiktok"]) {
    if (!byId.get(id)?.markAsset) failures.push(`${id}: official permitted mark is required for this release gate`);
  }
  if (/No permission evidence is recorded/iu.test(provenance)) {
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
console.log(`- Local reviewed marks: ${configuredAssets.length}; provider requests before click: 0.`);

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
