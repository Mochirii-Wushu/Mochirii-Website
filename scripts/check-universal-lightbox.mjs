import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { appCssFiles } from "./lib/app-css.mjs";

const sharedCssPath = "apps/web/app/styles/shell-lightbox.css";
const galleryCssPath = "apps/web/app/styles/public-gallery.css";
const homePagePath = "apps/web/app/page.tsx";
const galleryPagePath = "apps/web/app/gallery/page.tsx";
const galleryRouteComponentPath = "apps/web/components/public-pages/route-pages/GalleryPage.tsx";
const homeLightboxPath = "apps/web/components/HomeGalleryLightbox.tsx";
const galleryBrowserPath = "apps/web/components/public-pages/GalleryBrowser.tsx";
const universalLightboxPath = "apps/web/components/UniversalImageLightbox.tsx";
const lightboxImagePath = "apps/web/components/LightboxImage.tsx";
const lightboxOverlayPath = "apps/web/components/useLightboxOverlay.ts";
const layoutPath = "apps/web/app/layout.tsx";
const tokensPath = "apps/web/app/styles/tokens-base.css";
const headerCssPath = "apps/web/app/styles/shell-header-nav.css";
const footerCssPath = "apps/web/app/styles/shell-footer.css";
const mobileCssPath = "apps/web/app/styles/shell-mobile-menu.css";
const homeVisualCssPath = "apps/web/app/styles/public-home-visual.css";

const sharedCss = readFileSync(sharedCssPath, "utf8").replace(/\r\n/g, "\n");
const galleryCss = readFileSync(galleryCssPath, "utf8").replace(/\r\n/g, "\n");
const homePage = readFileSync(homePagePath, "utf8").replace(/\r\n/g, "\n");
const galleryPage = readFileSync(galleryPagePath, "utf8").replace(/\r\n/g, "\n");
const galleryRouteComponent = readFileSync(galleryRouteComponentPath, "utf8").replace(/\r\n/g, "\n");
const homeLightbox = readFileSync(homeLightboxPath, "utf8").replace(/\r\n/g, "\n");
const galleryBrowser = readFileSync(galleryBrowserPath, "utf8").replace(/\r\n/g, "\n");
const universalLightbox = readFileSync(universalLightboxPath, "utf8").replace(/\r\n/g, "\n");
const lightboxImage = readFileSync(lightboxImagePath, "utf8").replace(/\r\n/g, "\n");
const lightboxOverlay = readFileSync(lightboxOverlayPath, "utf8").replace(/\r\n/g, "\n");
const layout = readFileSync(layoutPath, "utf8").replace(/\r\n/g, "\n");
const tokens = readFileSync(tokensPath, "utf8").replace(/\r\n/g, "\n");
const headerCss = readFileSync(headerCssPath, "utf8").replace(/\r\n/g, "\n");
const footerCss = readFileSync(footerCssPath, "utf8").replace(/\r\n/g, "\n");
const mobileCss = readFileSync(mobileCssPath, "utf8").replace(/\r\n/g, "\n");
const homeVisualCss = readFileSync(homeVisualCssPath, "utf8").replace(/\r\n/g, "\n");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function expectIncludes(label, source, snippet, sourcePath) {
  if (!source.includes(snippet)) fail(`${label} is missing from ${sourcePath}.`);
}

function normalizeSelector(selector) {
  return selector
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .trim();
}

function normalizeValue(value) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function declarationEntries(body) {
  return body
    .split(";")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator === -1) return null;
      return {
        property: line.slice(0, separator).trim().toLowerCase(),
        value: normalizeValue(line.slice(separator + 1)),
      };
    })
    .filter(Boolean);
}

function declarationMap(body) {
  return new Map(declarationEntries(body).map(({ property, value }) => [property, value]));
}

function parseRules(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: normalizeSelector(match[1]),
    body: match[2],
  }));
}

function discoverCssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return discoverCssFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".css")
      ? [entryPath.replace(/\\/g, "/")]
      : [];
  });
}

const discoveredAppCssFiles = discoverCssFiles("apps/web/app").sort();
const missingCssFiles = discoveredAppCssFiles.filter((file) => !appCssFiles.includes(file));
const duplicateCssFiles = appCssFiles.filter((file, index) => appCssFiles.indexOf(file) !== index);
if (missingCssFiles.length) fail(`Application CSS inventory is missing: ${missingCssFiles.join(", ")}.`);
if (duplicateCssFiles.length) fail(`Application CSS inventory contains duplicates: ${duplicateCssFiles.join(", ")}.`);

const sharedRules = parseRules(sharedCss);
const stylesheetRules = new Map(
  appCssFiles.map((file) => [
    file,
    parseRules(readFileSync(file, "utf8").replace(/\r\n/g, "\n")),
  ]),
);

function findRule(rules, selector) {
  const normalized = normalizeSelector(selector);
  return rules.find((rule) => rule.selector === normalized);
}

function expectRuleContractIn(rules, sourcePath, selector, expectedProperties) {
  const rule = findRule(rules, selector);
  if (!rule) {
    fail(`Required selector ${selector} is missing from ${sourcePath}.`);
    return;
  }

  const actual = declarationMap(rule.body);
  for (const [property, expectedValue] of Object.entries(expectedProperties)) {
    const normalizedExpected = normalizeValue(expectedValue);
    if (actual.get(property) !== normalizedExpected) {
      fail(
        `${selector} must set ${property}:${expectedValue}; in ${sourcePath}.`,
      );
    }
  }
}

function expectRuleContract(selector, expectedProperties) {
  expectRuleContractIn(sharedRules, sharedCssPath, selector, expectedProperties);
}

function expectPropertySequenceIn(rules, sourcePath, selector, property, expectedValues) {
  const rule = findRule(rules, selector);
  if (!rule) {
    fail(`Required selector ${selector} is missing from ${sourcePath}.`);
    return;
  }

  const actual = declarationEntries(rule.body)
    .filter((entry) => entry.property === property)
    .map((entry) => entry.value);
  const expected = expectedValues.map(normalizeValue);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${selector} must set ${property} in fallback order in ${sourcePath}: ${expectedValues.join(" then ")}.`);
  }
}

function expectPropertySequence(selector, property, expectedValues) {
  expectPropertySequenceIn(sharedRules, sharedCssPath, selector, property, expectedValues);
}

expectIncludes("Home shared lightbox import", homePage, 'import "./styles/shell-lightbox.css";', homePagePath);
expectIncludes("Gallery shared lightbox import", galleryPage, 'import "../styles/shell-lightbox.css";', galleryPagePath);
expectIncludes("Gallery visual treatment import", galleryPage, 'import "../styles/public-gallery.css";', galleryPagePath);
expectIncludes("Home universal viewer", homeLightbox, "<UniversalImageLightbox", homeLightboxPath);
expectIncludes("Gallery universal viewer", galleryBrowser, "<UniversalImageLightbox", galleryBrowserPath);
expectIncludes("Universal keyboard-scrollable lightbox card", universalLightbox, '<figure className="lightbox-card" tabIndex={0}>', universalLightboxPath);
expectIncludes("Home prepared body portal", homeLightbox, "const portalRoot = useBodyPortalRoot();", homeLightboxPath);
expectIncludes("Gallery server-rendered style scope", galleryRouteComponent, 'className="gallery-page"', galleryRouteComponentPath);
expectIncludes("Gallery portal appearance", galleryBrowser, 'appearance="gallery"', galleryBrowserPath);
expectIncludes("Gallery server-rendered CSS scope", galleryCss, ".gallery-page .gallery-toolbar", galleryCssPath);
expectIncludes("Gallery portal CSS scope", galleryCss, ".lightbox--gallery .lightbox-card", galleryCssPath);
if (galleryCss.includes('body[data-page="gallery"]')) fail(`${galleryCssPath} must not depend on a post-hydration body marker.`);
if (homeLightbox.includes("lazy(") || homeLightbox.includes("HomeGalleryLightboxFallback")) {
  fail(`${homeLightboxPath} must render the shared viewer directly without a second fallback dialog.`);
}
expectIncludes("Universal shared full-image loader", universalLightbox, "<LightboxImage", universalLightboxPath);
expectIncludes("Universal thumbnail placeholder", universalLightbox, "previewSrc={item.previewSrc}", universalLightboxPath);
expectIncludes("Universal initial close focus", universalLightbox, "closeRef.current?.focus({ preventScroll: true })", universalLightboxPath);
expectIncludes("Universal Escape handling", universalLightbox, 'if (event.key === "Escape") onClose();', universalLightboxPath);
expectIncludes("Universal focus containment", universalLightbox, 'if (event.key !== "Tab") return;', universalLightboxPath);
expectIncludes("Universal modal background inertness", universalLightbox, "state.element.inert = true;", universalLightboxPath);
expectIncludes("Universal modal background accessibility", universalLightbox, 'state.element.setAttribute("aria-hidden", "true")', universalLightboxPath);
expectIncludes("Universal modal background restoration", universalLightbox, "state.element.inert = state.inert;", universalLightboxPath);
expectIncludes("Universal backdrop closing", universalLightbox, "onClick={onClose}", universalLightboxPath);
expectIncludes("Decode-aware image state", lightboxImage, "data-image-state={imageState}", lightboxImagePath);
expectIncludes("User-requested full-image priority", lightboxImage, 'fetchPriority="high"', lightboxImagePath);
expectIncludes("Accessible full-image status", lightboxImage, 'role="status" aria-live="polite"', lightboxImagePath);
expectIncludes("Abortable full-image resolver", lightboxImage, "requestControllerRef.current?.abort();", lightboxImagePath);
expectIncludes("Disposable full-image object URL", lightboxImage, "URL.createObjectURL(resolved)", lightboxImagePath);
expectIncludes("Full-image object URL cleanup", lightboxImage, "URL.revokeObjectURL(objectUrlRef.current);", lightboxImagePath);
expectIncludes("Stale full-image generation guard", lightboxImage, "generation !== requestGenerationRef.current", lightboxImagePath);
[
  "const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth);",
  "const currentPaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;",
  "body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;",
  "body.style.paddingRight = previousPaddingRight;",
].forEach((snippet) => expectIncludes("Shared scrollbar compensation", lightboxOverlay, snippet, lightboxOverlayPath));
expectIncludes("Next viewport safe-area opt-in", layout, 'viewportFit: "cover"', layoutPath);
const tokensRules = stylesheetRules.get(tokensPath);
const headerRules = stylesheetRules.get(headerCssPath);
const footerRules = stylesheetRules.get(footerCssPath);
const mobileRules = stylesheetRules.get(mobileCssPath);
const homeVisualRules = stylesheetRules.get(homeVisualCssPath);

expectRuleContractIn(tokensRules, tokensPath, ":root", {
  "--safe-area-top": "env(safe-area-inset-top, 0px)",
  "--safe-area-right": "env(safe-area-inset-right, 0px)",
  "--safe-area-bottom": "env(safe-area-inset-bottom, 0px)",
  "--safe-area-left": "env(safe-area-inset-left, 0px)",
  "--page-inset-right": "max(16px, var(--safe-area-right))",
  "--page-inset-left": "max(16px, var(--safe-area-left))",
});
expectRuleContractIn(tokensRules, tokensPath, "html", { height: "100%" });
expectRuleContractIn(tokensRules, tokensPath, "body", { "min-height": "100%" });
expectRuleContractIn(tokensRules, tokensPath, ".container", {
  "padding-right": "var(--page-inset-right)",
  "padding-left": "var(--page-inset-left)",
});
expectRuleContractIn(tokensRules, tokensPath, ".skip-link", {
  top: "max(12px, var(--safe-area-top))",
  left: "var(--page-inset-left)",
});
expectRuleContractIn(headerRules, headerCssPath, ".site-header", {
  padding: "max(14px, var(--safe-area-top)) var(--page-inset-right) 14px var(--page-inset-left)",
});
expectRuleContractIn(footerRules, footerCssPath, ".site-footer", {
  padding: "44px var(--page-inset-right) max(34px, var(--safe-area-bottom)) var(--page-inset-left)",
});
expectRuleContractIn(mobileRules, mobileCssPath, ".mobile-sheet", {
  padding: "max(14px, var(--safe-area-top)) max(14px, var(--safe-area-right)) max(16px, var(--safe-area-bottom)) max(14px, var(--safe-area-left))",
});
expectPropertySequenceIn(mobileRules, mobileCssPath, ".mobile-sheet", "height", ["100vh", "100dvh"]);
expectRuleContractIn(homeVisualRules, homeVisualCssPath, 'body[data-page="home"] .birthday-splash', {
  padding: "max(clamp(18px, 4vw, 44px), var(--safe-area-top)) max(clamp(18px, 4vw, 44px), var(--safe-area-right)) max(clamp(18px, 4vw, 44px), var(--safe-area-bottom)) max(clamp(18px, 4vw, 44px), var(--safe-area-left))",
});

expectRuleContract("#lightbox,#modalRoot", {
  "--lightbox-shell-gap": "clamp(12px, 4vw, 24px)",
  "--lightbox-close-size": "44px",
  "--lightbox-control-gap": "8px",
  "--lightbox-card-copy-reserve": "70px",
  "--lightbox-inset-top": "max(var(--lightbox-shell-gap), var(--safe-area-top))",
  "--lightbox-inset-right": "max(var(--lightbox-shell-gap), var(--safe-area-right))",
  "--lightbox-inset-bottom": "max(var(--lightbox-shell-gap), var(--safe-area-bottom))",
  "--lightbox-inset-left": "max(var(--lightbox-shell-gap), var(--safe-area-left))",
  position: "fixed",
  inset: "0",
  "overscroll-behavior": "contain",
});
expectPropertySequence("#lightbox,#modalRoot", "height", ["100vh", "100dvh"]);

expectRuleContract("#lightbox .lightbox-shell,#modalRoot .lightbox-shell", {
  display: "grid",
  "grid-template-columns": "minmax(0, 1160px)",
  "grid-template-rows": "var(--lightbox-close-size) minmax(0, auto)",
  "align-content": "center",
  "justify-content": "center",
  "justify-items": "center",
  "row-gap": "var(--lightbox-control-gap)",
  "overflow": "hidden",
});
expectPropertySequence("#lightbox .lightbox-shell,#modalRoot .lightbox-shell", "padding", [
  "clamp(12px, 4vw, 24px)",
  "var(--lightbox-inset-top) var(--lightbox-inset-right) var(--lightbox-inset-bottom) var(--lightbox-inset-left)",
]);

expectRuleContract(".lightbox-card", {
  "grid-row": "2",
  width: "min(100%, 1160px)",
  "max-width": "100%",
  "overflow-x": "hidden",
  "overflow-y": "auto",
  "overscroll-behavior": "contain",
});
expectPropertySequence(".lightbox-card", "max-height", [
  "calc(100vh - 48px - var(--lightbox-close-size) - var(--lightbox-control-gap))",
  "calc(100dvh - var(--lightbox-inset-top) - var(--lightbox-inset-bottom) - var(--lightbox-close-size) - var(--lightbox-control-gap))",
]);
expectRuleContract(".lightbox-img", {
  width: "auto",
  height: "auto",
  "max-width": "100%",
  "object-fit": "contain",
  flex: "0 0 auto",
});
expectRuleContract(".lightbox-media", {
  display: "grid",
  "place-items": "center",
  width: "100%",
  "max-width": "100%",
  "min-width": "0",
  flex: "0 0 auto",
});
expectRuleContract(".lightbox-media .lightbox-img", {
  "grid-area": "1 / 1",
});
expectRuleContract(".lightbox-image-status", {
  "grid-area": "1 / 1",
  "pointer-events": "none",
  "overflow-wrap": "anywhere",
});
expectPropertySequence(".lightbox-img", "max-height", [
  "min(82vh, calc(100vh - 48px - var(--lightbox-close-size) - var(--lightbox-control-gap) - var(--lightbox-card-copy-reserve)))",
  "min(82dvh, calc(100dvh - var(--lightbox-inset-top) - var(--lightbox-inset-bottom) - var(--lightbox-close-size) - var(--lightbox-control-gap) - var(--lightbox-card-copy-reserve)))",
]);
expectRuleContract(".lightbox-caption", {
  "box-sizing": "border-box",
  width: "100%",
  "max-width": "100%",
  "min-width": "0",
  "font-size": ".875rem",
  "overflow-wrap": "anywhere",
});
expectRuleContract(".lightbox-close", {
  position: "static",
  "grid-row": "1",
  "justify-self": "end",
  "align-self": "center",
  width: "var(--lightbox-close-size)",
  height: "var(--lightbox-close-size)",
});

const galleryVisualProperties = {
  card: new Set(["background", "border-color", "box-shadow"]),
  img: new Set(),
  caption: new Set(["color"]),
  close: new Set(["background", "border-color", "box-shadow", "transition"]),
  backdrop: new Set(["background", "backdrop-filter", "-webkit-backdrop-filter"]),
  root: new Set(),
  shell: new Set(),
};

function lightboxRuleKind(selector) {
  if (/(?:#lightboxBackdrop\b|#modalBackdrop\b|\.lightbox-backdrop\b)/.test(selector)) return "backdrop";
  if (/\.lightbox-card\b/.test(selector)) return "card";
  if (/(?:#lightboxImg\b|#modalImage\b|\.lightbox-img\b)/.test(selector)) return "img";
  if (/\.lightbox-caption\b/.test(selector)) return "caption";
  if (/(?:#lightboxClose\b|#modalClose\b|\.lightbox-close\b)/.test(selector)) return "close";
  if (/\.lightbox-shell\b/.test(selector)) return "shell";
  if (/(?:#lightbox\b|#modalRoot\b)/.test(selector)) return "root";
  return null;
}

for (const [file, rules] of stylesheetRules) {
  if (file === sharedCssPath) continue;

  for (const rule of rules) {
    const { selector } = rule;
    const kind = lightboxRuleKind(selector);
    if (!kind) continue;

    const allowed = file === galleryCssPath ? galleryVisualProperties[kind] : null;
    for (const { property, value } of declarationEntries(rule.body)) {
      const approvedHoverTransform = file === galleryCssPath
        && kind === "close"
        && property === "transform"
        && /\.lightbox-close:(?:hover|focus-visible)\b/.test(selector)
        && value === "translatey(-1px)";

      if (!allowed?.has(property) && !approvedHoverTransform) {
        fail(`Competing lightbox declaration outside ${sharedCssPath}: ${file} ${selector} sets ${property}.`);
      }
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);

console.log("Universal lightbox validation OK.");
