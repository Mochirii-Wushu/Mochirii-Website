import { readFileSync } from "node:fs";
import path from "node:path";

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
  requireText(label, source, 'dateTime="2026-07-29"');
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
  "Mochirii data deletion request",
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
