import { readdirSync } from "node:fs";
import path from "node:path";

export const APPROVED_HOME_SUBTITLE = "Asia Pacific • Where Winds Meet Guild";
export const APPROVED_FOOTER_DESCRIPTION = "An Asia Pacific Where Winds Meet guild, with events scheduled in UTC+8.";
export const EXPECTED_EXACT_GAME_NAME_COUNT = 16;
export const EXPECTED_PUBLIC_JSON_FILES = Object.freeze([
  "apps/web/public/data/announcements.json",
  "apps/web/public/data/event-social-assets.json",
  "apps/web/public/data/event-social-content.json",
  "apps/web/public/data/events.json",
  "apps/web/public/data/gallery.json",
  "apps/web/public/data/guild-schedule.json",
  "apps/web/public/data/home.json",
  "apps/web/public/data/join.json",
  "apps/web/public/data/leaders.json",
  "apps/web/public/data/raffles.json",
  "apps/web/public/data/ranks.json",
  "apps/web/public/data/recruitment.json",
  "apps/web/public/data/spotify.json",
  "apps/web/public/data/spotlight.json",
  "apps/web/public/data/tome.json",
  "apps/web/public/data/twills.json",
]);
export const TARGETED_PUBLIC_PAGE_SHELL_FILES = Object.freeze([
  "apps/web/components/public-pages/route-pages/GalleryPage.tsx",
]);

export const PROTECTED_EDITORIAL_FIELDS = Object.freeze(new Set([
  "apps/web/public/data/recruitment.json:$.content.paragraphs[0]",
  "apps/web/public/data/recruitment.json:$.content.paragraphs[1]",
  "apps/web/public/data/recruitment.json:$.content.paragraphs[2]",
  "apps/web/public/data/recruitment.json:$.content.paragraphs[3]",
  "apps/web/public/data/recruitment.json:$.content.paragraphs[4]",
  "apps/web/public/data/recruitment.json:$.content.paragraphs[5]",
  "apps/web/public/data/recruitment.json:$.content.paragraphs[6]",
  "apps/web/public/data/recruitment.json:$.content.conclusion[0]",
]));

export const EDITORIAL_RULES = Object.freeze([
  {
    category: "mood-filler-wording",
    pattern: /\b(?:warm|warmth|calm|quiet|cozy|soft|softly|gentle|gently|whimsical|peaceful|serene|soothing|dreamy|tranquil|unhurried|lovely)\b/iu,
  },
  {
    category: "generic-non-game-wording",
    pattern: /\b(?:shared\s+runs?|little\s+guild|tiny\s+guild|baddie\s+smashing|off-session\s+planning|operating\s+cadence|winding\s+down|long\s+listening|wandering\s+through\s+ambient\s+sounds|late\s+hours|slower\s+tempo|feel\s+at\s+home|cheerful\s+presence|brightens\s+the\s+guild|having\s+fun\s+together)\b/iu,
  },
  {
    category: "vague-mood-wording",
    pattern: /\b(?:enthusiasm|presence)\s*(?:&|and)\s*spirit\b/iu,
  },
]);

const exactGameNamePattern = /\bWhere Winds Meet\b/giu;

function filesUnder(root, relativeDirectory, extensions) {
  const directory = path.join(root, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return filesUnder(root, path.relative(root, absolute), extensions);
    }
    return extensions.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

export function discoverPublicJsonFiles(root) {
  return filesUnder(root, "apps/web/public/data", new Set([".json"]))
    .map((absolute) => path.relative(root, absolute).replaceAll("\\", "/"))
    .sort();
}

export function exactGameNameIsApproved(relative, location, value) {
  if (relative === "apps/web/public/data/event-social-content.json") {
    return location === "$.events[2].platforms.facebook.captionTemplate";
  }
  if (relative === "apps/web/public/data/home.json") {
    return location === "$.hero.subtitle" && value === APPROVED_HOME_SUBTITLE;
  }
  if (relative === "apps/web/components/public-pages/metadata.ts") return true;
  if (relative === "apps/web/lib/site-metadata.ts") return true;
  if (relative === "apps/web/components/SiteHeader.tsx" || relative.startsWith("apps/web/components/site-header/")) return true;
  if (relative === "apps/web/components/SiteFooter.tsx") {
    return value.includes(APPROVED_FOOTER_DESCRIPTION);
  }
  return false;
}

export function scanExactGameName(relative, location, value) {
  const count = value.match(exactGameNamePattern)?.length ?? 0;
  const issues = count > 0 && !exactGameNameIsApproved(relative, location, value)
    ? [{ path: relative, location, category: "exact-game-name-outside-approved-lane" }]
    : [];
  return { count, issues };
}

export function walkJsonStrings(value, visit, pointer = "$") {
  if (typeof value === "string") {
    visit(value, pointer);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkJsonStrings(entry, visit, `${pointer}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => walkJsonStrings(entry, visit, `${pointer}.${key}`));
  }
}

export function scanJsonExactGameName(relative, value) {
  let count = 0;
  const issues = [];
  walkJsonStrings(value, (text, pointer) => {
    const result = scanExactGameName(relative, pointer, text);
    count += result.count;
    issues.push(...result.issues);
  });
  return { count, issues };
}

export function scanEditorialText(relative, location, value) {
  if (PROTECTED_EDITORIAL_FIELDS.has(`${relative}:${location}`)) return [];
  return EDITORIAL_RULES
    .filter(({ pattern }) => pattern.test(value))
    .map(({ category }) => ({ path: relative, location, category }));
}

export function stripStylingTokens(value) {
  return value
    .replace(/className\s*=\s*"[^"]*"/gu, "")
    .replace(/className\s*=\s*'[^']*'/gu, "")
    .replace(/className\s*=\s*\{[^}]*\}/gu, "");
}

export function formatPolicyIssue(issue) {
  return `${issue.path}:${issue.location}: ${issue.category}`;
}
