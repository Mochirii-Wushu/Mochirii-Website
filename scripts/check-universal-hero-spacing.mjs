import { readFileSync } from "node:fs";
import { readAppCss } from "./lib/app-css.mjs";

const cssPath = "apps/web/app/styles/*.css";
const css = readAppCss().replace(/\r\n/g, "\n");
const homePagePath = "apps/web/app/page.tsx";
const homePage = readFileSync(homePagePath, "utf8").replace(/\r\n/g, "\n");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function assertIncludes(label, snippet) {
  if (!css.includes(snippet)) fail(`${label} is missing from ${cssPath}.`);
}

assertIncludes("Shared hero shell padding token", "--hero-shell-pad-top:");
assertIncludes("Shared hero image aspect token", "--hero-image-aspect:3 / 2;");
assertIncludes("Shared hero frame width token", "--hero-frame-max-width:var(--container);");
assertIncludes("Shared hero image gap token", "--hero-image-to-card-gap:");
assertIncludes("Shared hero bottom gap token", "--hero-stack-bottom-gap:");
assertIncludes("Shared hero shell padding", ".page-hero-shell{position:relative; z-index:10; padding-top:var(--hero-shell-pad-top);}");
assertIncludes("Shared hero frame width", ".page-hero-shell > .container{max-width:var(--hero-frame-max-width);}");
assertIncludes("Shared hero aspect ratio", "aspect-ratio:var(--hero-image-aspect);");
assertIncludes("Shared hero radius", "border-radius:var(--hero-image-radius);");
assertIncludes("Shared hero image fit", "object-fit:contain;");
assertIncludes("Shared hero image position", "object-position:center;");
assertIncludes("Shared hero card gap", ".hero-overlap{margin-top:var(--hero-image-to-card-gap); padding-bottom:var(--hero-stack-bottom-gap);}");
assertIncludes("Home intro row", ".home-hero-row{");
assertIncludes("Home single-column intro", "grid-template-columns:minmax(0, 1fr);");
assertIncludes("Surface hero shell token", "--surface-hero-shell:var(--bg-1);");
assertIncludes("Surface primary card token", "--surface-primary-card:var(--bg-0);");
assertIncludes("Surface quiet card token", "--surface-quiet-card:var(--bg-2);");
assertIncludes("Tool panel surface token", "--surface-tool-panel:rgba(7,10,13,.74);");
assertIncludes("Admin panel surface token", "--surface-admin-panel:rgba(7,10,13,.86);");

const bannedHeroGeometry = new Set([
  "aspect-ratio",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border-radius",
  "overflow",
  "isolation",
  "object-fit",
  "object-position",
  "transform",
  "transform-origin",
  "filter",
]);

const bannedHeroImageGeometry = new Set([
  "aspect-ratio",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "object-fit",
  "object-position",
  "transform",
  "transform-origin",
  "filter",
  "background",
]);

const bannedHeroShellSpacing = new Set([
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
]);

const bannedPageHeroTokens = new Set([
  "--hero-frame-max-width",
  "--hero-image-to-card-gap",
  "--hero-stack-bottom-gap",
]);

function declarations(body) {
  return body
    .split(";")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(":");
      if (colon === -1) return null;
      return {
        prop: line.slice(0, colon).trim().toLowerCase(),
        value: line.slice(colon + 1).trim().toLowerCase(),
      };
    })
    .filter(Boolean);
}

for (const match of css.matchAll(/--hero-image-to-card-gap\s*:\s*([^;]+);/g)) {
  const value = match[1].trim();
  if (value.includes("-")) {
    fail(`Negative hero image/card spacing is not allowed: --hero-image-to-card-gap:${value};`);
  }
}

if (!/<div className="container hero-overlap">\s*<div className="home-hero-row">/.test(homePage)) {
  fail(`Home intro row must live directly inside the hero-overlap container in ${homePagePath}.`);
}

const homeHeroStart = homePage.indexOf('<section className="page-hero');
const homeOverlapStart = homePage.indexOf('<div className="container hero-overlap">');
const homeHeaderEnd = homePage.indexOf("</header>", homeOverlapStart);
if (homeHeroStart === -1 || homeOverlapStart === -1 || homeOverlapStart < homeHeroStart) {
  fail(`Home hero image section must appear before the hero-overlap row in ${homePagePath}.`);
} else {
  const homeImageFrame = homePage.slice(homeHeroStart, homeOverlapStart);
  if (homeImageFrame.includes("home-guild-seal")) {
    fail(`Home Guild Standards card must not be inside the page-hero image frame in ${homePagePath}.`);
  }
  if (homeHeaderEnd === -1 || homePage.slice(homeOverlapStart, homeHeaderEnd).includes("home-guild-seal")) {
    fail(`Home Guild Standards card must remain outside the complete hero header in ${homePagePath}.`);
  }
}

for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = match[1].trim();
  if (!selector.includes("body[data-page=")) continue;

  const props = declarations(match[2]);

  for (const { prop } of props) {
    if (bannedPageHeroTokens.has(prop)) {
      fail(`Page-scoped hero sizing/spacing token is not allowed: ${selector} sets ${prop}.`);
    }
  }

  if (selector.includes(".hero-overlap")) {
    fail(`Page-scoped hero-overlap spacing is not allowed: ${selector}`);
    continue;
  }

  if (selector.includes(".page-hero-shell")) {
    for (const { prop } of props) {
      if (bannedHeroShellSpacing.has(prop)) {
        fail(`Page-scoped hero shell spacing is not allowed: ${selector} sets ${prop}.`);
      }
    }
  }

  if (selector.includes(".page-hero__img")) {
    for (const { prop, value } of props) {
      if (prop === "transform" && value === "none") continue;
      if (bannedHeroImageGeometry.has(prop)) {
        fail(`Page-scoped hero image geometry is not allowed: ${selector} sets ${prop}.`);
      }
    }
  }

  if (selector.includes(".page-hero") && !selector.includes(".page-hero__img") && !selector.includes(".page-hero-shell")) {
    for (const { prop, value } of props) {
      if (prop === "transform" && value === "none") continue;
      if (bannedHeroGeometry.has(prop)) {
        fail(`Page-scoped hero geometry is not allowed: ${selector} sets ${prop}.`);
      }
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);

console.log("Universal hero spacing validation OK.");
