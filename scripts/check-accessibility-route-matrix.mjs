import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { readAppCss } from "./lib/app-css.mjs";
import { readPublicPageExport } from "./lib/public-page-source.mjs";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const writeReport = args.has("--write") || process.env.ACCESSIBILITY_ROUTE_MATRIX_WRITE === "true";
const reportJsonPath = resolve(root, "reports/accessibility-route-matrix.json");
const reportMdPath = resolve(root, "reports/accessibility-route-matrix.md");
const checkedAt = new Date().toISOString();
const failures = [];
const warnings = [];

const routes = [
  { route: "/", label: "Home", file: "apps/web/app/page.tsx", type: "public", workflow: "guild overview", expectsLiveRegion: true },
  { route: "/join", label: "Join", file: "apps/web/app/join/page.tsx", type: "public", workflow: "website to Discord funnel", componentFiles: ["apps/web/components/public-pages/DiscordServerPreview.tsx"] },
  { route: "/events", label: "Events", file: "apps/web/app/events/page.tsx", type: "public", workflow: "community schedule", componentFiles: ["apps/web/components/public-pages/EventsBoard.tsx"], expectsLiveRegion: true },
  { route: "/gallery", label: "Gallery", file: "apps/web/app/gallery/page.tsx", type: "public", workflow: "media browsing", componentFiles: ["apps/web/components/public-pages/GalleryBrowser.tsx"], expectsLiveRegion: true },
  { route: "/ranks", label: "Ranks", file: "apps/web/app/ranks/page.tsx", type: "public", workflow: "progression reference" },
  { route: "/leaders", label: "Leaders", file: "apps/web/app/leaders/page.tsx", type: "public", workflow: "stewardship reference" },
  { route: "/tome", label: "Tome", file: "apps/web/app/tome/page.tsx", type: "public", workflow: "conduct reference" },
  { route: "/recruitment", label: "Recruitment", file: "apps/web/app/recruitment/page.tsx", type: "public", workflow: "recruiting copy", expectsDescribedBy: true },
  { route: "/announcements", label: "Announcements", file: "apps/web/app/announcements/page.tsx", type: "public", workflow: "updates" },
  { route: "/raffle", label: "Raffle", file: "apps/web/app/raffle/page.tsx", type: "public", workflow: "monthly raffle program and inactive drawing status", componentFiles: ["apps/web/components/public-pages/route-pages/RafflePage.tsx"] },
  { route: "/raffle/rules", label: "Raffle Rules", file: "apps/web/app/raffle/rules/page.tsx", type: "public", workflow: "standing, current, and archived raffle rules" },
  { route: "/spotify", label: "Spotify", file: "apps/web/app/spotify/page.tsx", type: "public", workflow: "embedded playlists", componentFiles: ["apps/web/components/public-pages/SpotifyBrowser.tsx"], expectsIframe: true },
  { route: "/spotlight", label: "Spotlight", file: "apps/web/app/spotlight/page.tsx", type: "public", workflow: "member spotlight" },
  { route: "/twills", label: "Twills", file: "apps/web/app/twills/page.tsx", type: "public", workflow: "profile reference", componentFiles: ["apps/web/components/public-pages/ProfileDisplay.tsx"] },
  { route: "/privacy", label: "Privacy", file: "apps/web/app/privacy/page.tsx", type: "public", workflow: "privacy notice", componentFiles: ["apps/web/components/public-pages/common.tsx"], expectsHeading: true },
  { route: "/meta-data-deletion", label: "Meta Data Deletion", file: "apps/web/app/meta-data-deletion/page.tsx", type: "public", workflow: "data deletion instructions", componentFiles: ["apps/web/components/public-pages/common.tsx"], expectsHeading: true },
  { route: "/auth", label: "Auth", file: "apps/web/app/auth/page.tsx", type: "protected-entry", workflow: "Discord OAuth", componentFiles: ["apps/web/components/member-workflow/AuthPanel.tsx"], expectsForm: false, expectsLiveRegion: true, expectsAlert: true, protectedNoindex: true },
  { route: "/account", label: "Account", file: "apps/web/app/account/page.tsx", type: "member", workflow: "profile and verification", componentFiles: ["apps/web/components/member-workflow/AccountPanel.tsx"], expectsForm: true, expectsLiveRegion: true, expectsAlert: true, protectedNoindex: true },
  { route: "/social", label: "Social", file: "apps/web/app/social/page.tsx", type: "member", workflow: "guild social doorway", componentFiles: ["apps/web/components/member-workflow/SocialHubPanel.tsx"], expectsLiveRegion: true, expectsAlert: true, protectedNoindex: true },
  { route: "/oauth/consent", label: "OAuth Consent", file: "apps/web/app/oauth/consent/page.tsx", type: "protected-entry", workflow: "Supabase OAuth consent", componentFiles: ["apps/web/components/member-workflow/OAuthConsentPanel.tsx"], expectsForm: true, expectsLiveRegion: true, expectsAlert: true, protectedNoindex: true },
  { route: "/gallery-submit", label: "Gallery Submit", file: "apps/web/app/gallery-submit/page.tsx", type: "member", workflow: "member upload", componentFiles: ["apps/web/components/member-workflow/GallerySubmitForm.tsx"], expectsForm: true, expectsLiveRegion: true, expectsAlert: true, protectedNoindex: true },
  { route: "/leader-dashboard", label: "Leader Dashboard", file: "apps/web/app/leader-dashboard/page.tsx", type: "moderator", workflow: "moderation queues", componentFiles: ["apps/web/components/member-workflow/LeaderDashboard.tsx"], expectsForm: true, expectsLiveRegion: true, expectsAlert: true, protectedNoindex: true },
  { route: "/games/mochi-pets", label: "Mochi Pets", file: "apps/web/app/games/mochi-pets/page.tsx", type: "public-with-protected-entry", workflow: "public concept and private tester doorway", componentFiles: ["apps/web/components/mochi-pets/MochiPetsPublicConcept.tsx", "apps/web/components/mochi-pets/MochiPetsPrivateDoorway.tsx", "apps/web/components/mochi-pets/MochiPetsTesterPasswordGate.tsx", "apps/web/components/mochi-pets/MochiPetsTesterWaitingRoom.tsx"], expectsForm: true, expectsLiveRegion: true, expectsAlert: true },
  { route: "/__mochirii-unknown-route__", label: "Not Found", file: "apps/web/app/not-found.tsx", type: "public", workflow: "unknown-route recovery", expectsHeading: true },
];

const shell = inspectShell();
const matrix = routes.map(inspectRoute);
const summary = {
  totalRoutes: matrix.length,
  publicRoutes: matrix.filter((route) => route.type === "public").length,
  protectedRoutes: matrix.filter((route) => route.protectedNoindex).length,
  routesWithLiveRegions: matrix.filter((route) => route.liveRegions > 0).length,
  routesWithAlerts: matrix.filter((route) => route.alerts > 0).length,
  routesWithForms: matrix.filter((route) => route.forms > 0).length,
  routesWithIframes: matrix.filter((route) => route.iframes > 0).length,
};

const report = {
  ok: failures.length === 0,
  checkedAt,
  scope:
    "WCAG 2.2 AA-oriented accessibility route matrix for the Mochirii Vercel/Next app. This is a no-secret static pass that guards shell foundations, route workflow coverage, status messaging, forms, iframes, reduced motion, focus visibility, and protected noindex boundaries.",
  shell,
  summary,
  routes: matrix,
  manualBrowserMatrix: [
    "Keyboard tab order and Escape behavior for header dropdowns and mobile menu at 360x800, 375x812, 390x844, 414x896, 430x932, 1280x720, 1366x768, 1440x900, 1536x864, and 1920x1080.",
    "Visible focus rings for nav, buttons, gallery thumbnails, forms, queue tabs, Spotify chips, and project-page links.",
    "Color contrast for muted text, status pills, form errors, badges, and glass panels in light and dark image areas.",
    "Reduced motion behavior for hover transforms, glints, gallery/home image motion, and scroll behavior.",
    "Screen reader status updates for auth, account verification, gallery submit, gallery filters/share, events filters, and leader queues.",
    "Mochi Pets member-check status, passcode error announcement, signed-out guidance, and unlocked waiting-room facts.",
    "Iframe keyboard reachability and titles for the user-activated Discord preview and deferred Spotify embeds.",
  ],
  warnings,
  failures,
};

const markdown = renderMarkdown(report);
scanRenderedReport("json", JSON.stringify(report));
scanRenderedReport("markdown", markdown);
report.ok = failures.length === 0;

if (writeReport) {
  mkdirSync(dirname(reportJsonPath), { recursive: true });
  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(reportMdPath, renderMarkdown(report), "utf8");
}

if (!report.ok) {
  console.error("Accessibility route matrix failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Accessibility route matrix OK.");
console.log(`- Routes: ${summary.totalRoutes}`);
console.log(`- Protected/noindex routes: ${summary.protectedRoutes}`);
console.log(`- Routes with live regions: ${summary.routesWithLiveRegions}`);
console.log(`- Routes with forms: ${summary.routesWithForms}`);
console.log(`- Routes with iframes: ${summary.routesWithIframes}`);
if (writeReport) {
  console.log(`- JSON report: ${pathForReport(reportJsonPath)}`);
  console.log(`- Markdown report: ${pathForReport(reportMdPath)}`);
}

function inspectShell() {
  const layout = readRequired("apps/web/app/layout.tsx");
  const header = readRequired("apps/web/components/SiteHeader.tsx");
  const mobileMenuFocus = readRequired("apps/web/components/site-header/use-mobile-menu-focus-trap.ts");
  const footer = readOptional("apps/web/components/SiteFooter.tsx");
  const siteMetadata = readOptional("apps/web/lib/site-metadata.ts");
  const css = readAppCss();

  const literalHtmlLanguage = /<html\s+lang=["']en(?:-SG)?["']/.test(layout);
  const configuredHtmlLanguage =
    /<html\s+lang=\{SITE_LANGUAGE\}/.test(layout) &&
    /SITE_LANGUAGE\s*=\s*["']en-SG["']/.test(siteMetadata);

  const shellChecks = {
    htmlLang: literalHtmlLanguage || configuredHtmlLanguage,
    mainTargetCoverage: routes.every((route) => routeHasMainTarget(route)),
    skipLink: /className=["']skip-link["'][\s\S]*href=["']#main["']/.test(header),
    primaryNavLabel: /<nav\s+className=["']nav["']\s+aria-label=["']Primary["']/.test(header),
    mobileMenuControls: /aria-controls=["']mobile-menu["']/.test(header) && /aria-expanded=\{mobileOpen\}/.test(header),
    mobileFocusTrap: /trapMobileTab/.test(header) && /event\.key\s*!==\s*"Tab"|event\.key\s*===\s*"Tab"/.test(mobileMenuFocus),
    escapeClosesMenu: /event\.key === "Escape"/.test(mobileMenuFocus),
    focusReturn: /returnFocus/.test(mobileMenuFocus) && /focusTarget\?\.focus/.test(mobileMenuFocus),
    srOnlyClass: /\.sr-only\s*\{/.test(css),
    focusVisible: /:focus-visible\s*\{/.test(css),
    reducedMotion: /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css),
    footerNavLabel: /aria-label=/.test(footer),
  };

  for (const [name, passed] of Object.entries(shellChecks)) {
    if (!passed) failures.push(`accessibility shell: ${name} is missing or not statically verifiable.`);
  }

  return shellChecks;
}

function inspectRoute(route) {
  const sourceEntries = routeSourceEntries(route);
  const files = [...new Set(sourceEntries.map((entry) => entry.file))];
  const combined = sourceEntries.map((entry) => entry.text).join("\n");
  const routeResult = {
    route: route.route,
    label: route.label,
    type: route.type,
    workflow: route.workflow,
    files,
    mainTarget: combined.includes('id="main"'),
    headings1: countMatches(combined, /<h1\b/g),
    protectedNoindex: route.protectedNoindex ? /robots:\s*\{[\s\S]*index:\s*false/.test(readRouteText(route)) : false,
    liveRegions: countMatches(combined, /aria-live=/g),
    statusRoles: countMatches(combined, /role=["']status["']/g),
    alerts: countMatches(combined, /role=["']alert["']/g),
    forms: countMatches(combined, /<form\b/g),
    labels: countMatches(combined, /<label\b/g),
    inputs: countMatches(combined, /<(?:input|textarea|select)\b/g),
    interactiveControls: countMatches(combined, /<(?:button|input|textarea|select)\b/g),
    ariaLabels: countMatches(combined, /aria-label=/g),
    ariaDescribedBy: countMatches(combined, /aria-describedby=/g),
    iframes: countMatches(combined, /<iframe\b/g),
    iframeTitles: countMatches(combined, /<iframe[\s\S]*?title=/g),
    hiddenDecorativeImages: countMatches(combined, /aria-hidden=["']true["'][\s\S]{0,160}alt=["']["']|alt=["']["'][\s\S]{0,160}aria-hidden=["']true["']/g),
  };

  if (!routeResult.mainTarget) failures.push(`${route.route}: page must expose id="main" for skip-link target.`);
  if (route.expectsHeading && routeResult.headings1 !== 1) failures.push(`${route.route}: expected exactly one h1, found ${routeResult.headings1}.`);
  if (route.protectedNoindex && !routeResult.protectedNoindex) failures.push(`${route.route}: protected/member route must be noindex.`);
  if (route.expectsLiveRegion && routeResult.liveRegions === 0) failures.push(`${route.route}: expected an aria-live status/update region.`);
  if (route.expectsAlert && routeResult.alerts === 0) failures.push(`${route.route}: expected role="alert" for error feedback.`);
  if (route.expectsForm && routeResult.forms === 0 && routeResult.interactiveControls === 0) failures.push(`${route.route}: expected a form or form-like workflow surface.`);
  if (route.expectsForm && routeResult.inputs > 0 && routeResult.labels === 0) failures.push(`${route.route}: form inputs must have labels.`);
  if (route.expectsDescribedBy && routeResult.ariaDescribedBy === 0) failures.push(`${route.route}: expected aria-describedby for contextual form/media guidance.`);
  if (route.expectsIframe && routeResult.iframes === 0) failures.push(`${route.route}: expected iframe coverage.`);
  if (routeResult.iframes !== routeResult.iframeTitles) failures.push(`${route.route}: every iframe must have a title.`);

  if (!route.expectsLiveRegion && routeResult.liveRegions === 0 && ["public", "alpha"].includes(route.type)) {
    warnings.push(`${route.route}: no route-specific live region found; confirm static-only page status remains intentional.`);
  }

  return routeResult;
}

function readRouteText(route) {
  return readRequired(route.file);
}

function routeHasMainTarget(route) {
  return routeSourceEntries(route).some((entry) => entry.text.includes('id="main"'));
}

function routeSourceEntries(route) {
  const routeText = readRouteText(route);
  const entries = [{ file: route.file, text: routeText }];
  const directPageMatch = routeText.match(
    /import\s+\{\s*([A-Za-z0-9_]+)\s*\}\s+from\s+["']@\/components\/public-pages\/route-pages\/([^"']+)["']/,
  );
  if (directPageMatch) {
    const moduleFile = `apps/web/components/public-pages/route-pages/${directPageMatch[2]}.tsx`;
    entries.push({ file: moduleFile, text: readRequired(moduleFile) });
  }
  const publicPageMatch = routeText.match(/import\s+\{\s*([A-Za-z0-9_]+)\s*\}\s+from\s+["']@\/components\/public-pages\/pages["']/);
  if (publicPageMatch) {
    entries.push(readPublicPageExport(root, publicPageMatch[1], failures));
  }
  for (const file of route.componentFiles || []) entries.push({ file, text: readRequired(file) });
  return entries;
}

function renderMarkdown(report) {
  const shellRows = Object.entries(report.shell)
    .map(([name, passed]) => `| ${name} | ${passed ? "pass" : "fail"} |`)
    .join("\n");
  const routeRows = report.routes
    .map(
      (route) =>
        `| ${route.route} | ${route.type} | ${route.workflow} | ${route.liveRegions} | ${route.alerts} | ${route.forms} | ${route.iframes}/${route.iframeTitles} | ${route.protectedNoindex ? "yes" : "n/a"} |`,
    )
    .join("\n");
  const manual = report.manualBrowserMatrix.map((item) => `- ${item}`).join("\n");
  const warningsText = report.warnings.length ? report.warnings.map((warning) => `- ${warning}`).join("\n") : "- None";
  const failuresText = report.failures.length ? report.failures.map((failure) => `- ${failure}`).join("\n") : "- None";

  return `# Accessibility Route Matrix

Generated: ${report.checkedAt}

This file is intentionally no-secret. It records WCAG 2.2 AA-oriented accessibility coverage for Mochirii route workflows and names the browser checks that still require manual or Playwright evidence.

## Result

- OK: ${report.ok ? "yes" : "no"}
- Routes: ${report.summary.totalRoutes}
- Protected/noindex routes: ${report.summary.protectedRoutes}
- Routes with live regions: ${report.summary.routesWithLiveRegions}
- Routes with alerts: ${report.summary.routesWithAlerts}
- Routes with forms: ${report.summary.routesWithForms}
- Routes with iframes: ${report.summary.routesWithIframes}

## Shell Foundations

| Check | Result |
| --- | --- |
${shellRows}

## Route Matrix

| Route | Type | Workflow | Live regions | Alerts | Forms | Iframes titled | Noindex |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
${routeRows}

## Manual Browser Matrix

${manual}

## Warnings

${warningsText}

## Failures

${failuresText}
`;
}

function collectFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const full = resolve(root, dir, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(relative(root, full)));
    else if ([".ts", ".tsx", ".css"].includes(extname(entry.name))) files.push(pathForReport(full));
  }
  return files;
}

function readRequired(file) {
  const full = resolve(root, file);
  if (!existsSync(full)) {
    failures.push(`${file}: missing required accessibility source file.`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function readOptional(file) {
  const full = resolve(root, file);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function countMatches(text, pattern) {
  return [...String(text || "").matchAll(pattern)].length;
}

function scanRenderedReport(label, text) {
  const forbiddenPatterns = [
    { label: "GitHub token", pattern: /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/ },
    { label: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{12,}\b/ },
    { label: "JWT-like token", pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
    { label: "Discord bot token", pattern: /\b[A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}\b/ },
    {
      label: "Discord webhook URL",
      pattern: /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/,
    },
    { label: "Private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/ },
    { label: "raw cookie header", pattern: /\bCookie:\s*[^;\s]+=/i },
  ];
  String(text || "")
    .split(/\r?\n/)
    .forEach((line, index) => {
      for (const { label: patternLabel, pattern } of forbiddenPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) failures.push(`rendered ${label} report line ${index + 1}: ${patternLabel}`);
      }
    });
}

function pathForReport(file) {
  return relative(root, resolve(root, file)).replace(/\\/g, "/");
}
