import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { readAppCss } from "./lib/app-css.mjs";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function fail(message) {
  failures.push(message);
}

function assertIncludes(label, source, snippet) {
  if (!source.includes(snippet)) fail(`${label}: missing ${snippet}`);
}

function walkFiles(dir, extensions, results = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkFiles(fullPath, extensions, results);
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

const homeData = readJson("apps/web/public/data/home.json");
const page = read("apps/web/app/page.tsx");
const component = read("apps/web/components/HomeBirthdaySplash.tsx");
const appCss = readAppCss();

const splash = homeData.celebrationSplash;

if (splash?.title !== "Happy Birthday Sinbell!!") fail("Home celebration splash title must match approved copy.");
if (splash?.message !== "Mochi spirits love you!!") fail("Home celebration splash message must match approved copy.");
if (typeof splash?.enabled !== "boolean") fail("Home celebration splash enabled flag must be boolean.");
if (!splash?.storageKey) fail("Home celebration splash must have a storage key.");

if (page.includes('import { HomeBirthdaySplash } from "@/components/HomeBirthdaySplash";')) {
  fail("Home page must not include the disabled celebration client module in its static imports.");
}
assertIncludes("Home page", page, "async function OptionalBirthdaySplash");
assertIncludes("Home page", page, "if (config.enabled !== true) return null;");
assertIncludes("Home page", page, 'await import("@/components/HomeBirthdaySplash")');
assertIncludes("Home page", page, "<OptionalBirthdaySplash config={homeData.celebrationSplash} />");

const componentReferences = walkFiles(path.join(root, "apps", "web"), [".ts", ".tsx"])
  .map((file) => path.relative(root, file).split(path.sep).join("/"))
  .filter((file) => read(file).includes("HomeBirthdaySplash"));
const allowedReferences = new Set(["apps/web/app/page.tsx", "apps/web/components/HomeBirthdaySplash.tsx"]);
componentReferences.forEach((file) => {
  if (!allowedReferences.has(file)) fail(`HomeBirthdaySplash must stay Home-only; unexpected reference in ${file}.`);
});

[
  '"use client";',
  "startsAt",
  "endsAt",
  "setTimeout",
  "Escape",
].forEach((snippet) => assertIncludes("HomeBirthdaySplash component", component, snippet));
[
  'role="dialog"',
  'aria-modal="true"',
  'data-dismiss',
  'id="birthdaySplashTitle"',
  'id="birthdaySplashMessage"',
].forEach((snippet) => assertIncludes("Home server-rendered celebration frame", page, snippet));

if (component.includes("sessionStorage")) {
  fail("HomeBirthdaySplash must not persist dismissal in sessionStorage; refresh should show the splash again.");
}

[
  ".birthday-splash",
  ".birthday-splash__firework",
  "@keyframes birthday-firework",
  "@media (prefers-reduced-motion: reduce)",
  "animation:none!important",
].forEach((snippet) => {
  assertIncludes("Next CSS", appCss, snippet);
});

if (failures.length) {
  console.error(`Home celebration splash validation failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Home celebration splash validation OK.");
