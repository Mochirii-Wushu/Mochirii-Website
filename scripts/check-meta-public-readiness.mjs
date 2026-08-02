import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { validateWebp } from "./lib/asset-format-validation.mjs";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function requireText(label, source, value) {
  if (!source.includes(value)) failures.push(`${label}: missing ${value}`);
}

function forbidText(label, source, pattern, description) {
  if (pattern.test(source)) failures.push(`${label}: contains forbidden ${description}`);
}

const privacyRoute = read("apps/web/app/privacy/page.tsx");
const deletionRoute = read("apps/web/app/meta-data-deletion/page.tsx");
const privacy = read("apps/web/components/public-pages/route-pages/PrivacyPage.tsx");
const deletion = read("apps/web/components/public-pages/route-pages/MetaDataDeletionPage.tsx");
const metadata = read("apps/web/components/public-pages/metadata.ts");
const footer = read("apps/web/components/SiteFooter.tsx");
const sitemap = read("apps/web/public/sitemap.xml");

const LEGAL_HERO_MAX_BYTES = 300 * 1024;
const legalHeroes = [
  {
    label: "privacy hero",
    publicPath: "/assets/img/privacy/hero.webp",
    relativePath: "apps/web/public/assets/img/privacy/hero.webp",
    page: privacy,
    metadataKey: "privacy",
  },
  {
    label: "data deletion hero",
    publicPath: "/assets/img/data-deletion/hero.webp",
    relativePath: "apps/web/public/assets/img/data-deletion/hero.webp",
    page: deletion,
    metadataKey: "metaDataDeletion",
  },
];

const legalHeroHashes = new Set();
for (const hero of legalHeroes) {
  requireText(hero.label, hero.page, `image="${hero.publicPath}"`);
  const metadataEntry = metadata.slice(metadata.indexOf(`${hero.metadataKey}:`));
  requireText(hero.label, metadataEntry, `image: "${hero.publicPath}"`);

  const absolutePath = path.join(root, hero.relativePath);
  const buffer = readFileSync(absolutePath);
  const { width, height } = validateWebp(buffer);
  if (width !== 1536 || height !== 1024) {
    failures.push(`${hero.label}: expected 1536x1024, received ${width}x${height}`);
  }
  if (statSync(absolutePath).size > LEGAL_HERO_MAX_BYTES) {
    failures.push(`${hero.label}: exceeds ${LEGAL_HERO_MAX_BYTES} bytes`);
  }
  legalHeroHashes.add(createHash("sha256").update(buffer).digest("hex"));
}

if (legalHeroHashes.size !== legalHeroes.length) {
  failures.push("legal heroes: Privacy and Data Deletion must use distinct image bytes");
}

const heroRoot = path.join(root, "apps/web/public/assets/img");
const existingHeroHashes = new Set();
const legalHeroPaths = new Set(legalHeroes.map((hero) => path.join(root, hero.relativePath)));

function collectExistingHeroHashes(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectExistingHeroHashes(entryPath);
    } else if (entry.name === "hero.webp" && !legalHeroPaths.has(entryPath)) {
      existingHeroHashes.add(createHash("sha256").update(readFileSync(entryPath)).digest("hex"));
    }
  }
}

collectExistingHeroHashes(heroRoot);

for (const hash of legalHeroHashes) {
  if (existingHeroHashes.has(hash)) failures.push("legal heroes: generated artwork must not duplicate an existing hero");
}

for (const source of [privacy, deletion]) {
  forbidText("legal page hero", source, /\/assets\/img\/(?:gallery|hero)\/hero\.webp/u, "shared Gallery or Home hero");
}

for (const [label, source, key] of [
  ["privacy route", privacyRoute, "privacy"],
  ["Meta data deletion route", deletionRoute, "metaDataDeletion"],
]) {
  requireText(label, source, `metadataFor("${key}")`);
  requireText(label, source, "public-content-shared.css");
  requireText(label, source, "public-legal.css");
}

for (const [label, source] of [
  ["privacy page", privacy],
  ["Meta data deletion page", deletion],
]) {
  requireText(label, source, 'id="main"');
  requireText(label, source, 'dateTime="2026-07-31"');
  requireText(label, source, "support@mochirii.com");
  forbidText(label, source, /\b(?:warm|calm|quiet|shared runs?)\b/i, "mood filler or shared-runs wording");
  forbidText(label, source, /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}\b|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/, "credential-like value");
}

for (const phrase of [
  "not currently",
  "When enabled, Facebook Page and Instagram choices will be separate and off by default",
  "When destination publishing is enabled",
  "server-recorded consent",
  "moderator separately approves publication",
  "time-limited URLs",
  "fixed automatic deletion schedule",
  "automatically removed",
]) {
  requireText("privacy page", privacy, phrase);
}

for (const phrase of [
  "does not delete your Facebook account, Instagram account",
  "intends to use a business-owned publisher",
  "not currently",
  "applies when the hardened destination workflow is enabled",
  "Mōchirīī data deletion request",
  "Do not send a password, access token, recovery code, signed media URL, or identity document",
  "Queued, failed, or ineligible",
  "Publishing or uncertain",
  "Already published",
  "manual Guild-group shares",
]) {
  requireText("Meta data deletion page", deletion, phrase);
}

for (const [key, route] of [
  ["privacy", "/privacy"],
  ["metaDataDeletion", "/meta-data-deletion"],
]) {
  requireText("public metadata", metadata, `${key}:`);
  requireText("public metadata", metadata, `path: "${route}"`);
  requireText("sitemap", sitemap, `<loc>https://mochirii.com${route}</loc>`);
}

for (const value of [
  'aria-label="Privacy and support"',
  'href="/privacy"',
  'href="/meta-data-deletion"',
  'href="mailto:support@mochirii.com"',
]) {
  requireText("site footer", footer, value);
}

if (failures.length) {
  console.error(`Meta public readiness validation failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Meta public readiness validation OK.");
console.log("- Privacy and data-deletion routes expose canonical metadata and sitemap entries.");
console.log("- Public contact, consent choices, manual request handling, and external-copy limits are present.");
console.log("- Footer discovery and copy guardrails are present.");
