import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const rules = [
  {
    label: "mood-filler wording",
    pattern: /\b(?:warm|warmth|calm|quiet|cozy|soft|softly|gentle|gently|whimsical|peaceful|serene|soothing|dreamy|tranquil|unhurried|lovely)\b/iu,
  },
  {
    label: "generic non-game wording",
    pattern: /\b(?:shared\s+runs?|little\s+guild|tiny\s+guild|baddie\s+smashing|off-session\s+planning|operating\s+cadence|winding\s+down|long\s+listening|wandering\s+through\s+ambient\s+sounds|late\s+hours|slower\s+tempo|feel\s+at\s+home|cheerful\s+presence|brightens\s+the\s+guild|having\s+fun\s+together)\b/iu,
  },
  {
    label: "vague mood wording",
    pattern: /\b(?:enthusiasm|presence)\s*(?:&|and)\s*spirit\b/iu,
  },
];
const brandAccents = [
  { label: "Wushu land", pattern: /\bWushu land\b/giu, minimum: 1, maximum: 3 },
  { label: "pretty", pattern: /\bpretty\b/giu, minimum: 1, maximum: 6 },
  { label: "cupcake", pattern: /\bcupcakes?\b/giu, minimum: 1, maximum: 5 },
];
const focusChecks = [
  { label: "recruitment", pattern: /\brecruit(?:ment|ing|s)?\b/giu },
  { label: "events", pattern: /\bevents?\b/giu },
  { label: "builds", pattern: /\bbuilds?\b/giu },
  { label: "guides", pattern: /\bguides?\b/giu },
  { label: "progression", pattern: /\bprogression\b/giu },
  { label: "member activity or support", pattern: /\b(?:member\s+(?:activity|support|progression|showcases?)|event\s+participation)\b/giu },
];
const exactGameName = {
  pattern: /\bWhere Winds Meet\b/giu,
  minimum: 3,
  maximum: 16,
};
const approvedHomeSubtitle = "Asia Pacific • Where Winds Meet Guild";
const approvedFooterDescription = "An Asia Pacific Where Winds Meet guild, with events scheduled in UTC+8.";
const sharedSocialCaption = "A pretty gameplay showcase from Mōchirīī.";
const approvedPublicJsonFiles = [
  "apps/web/public/data/recruitment.json",
  "apps/web/public/data/spotify.json",
  "apps/web/public/data/spotlight.json",
  "apps/web/public/data/tome.json",
  "apps/web/public/data/twills.json",
];
const sharedSocialCaptionSources = [
  "apps/web/components/member-workflow/FacebookPagePublishQueue.tsx",
  "apps/web/components/member-workflow/LeaderDashboard.tsx",
  "supabase/functions/_shared/instagram-publishing.ts",
];
const canonicalPublicCopy = [];
let exactGameNameCount = 0;

function filesUnder(relativeDirectory, extensions) {
  const directory = path.join(root, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path.relative(root, absolute), extensions);
    return extensions.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

function exactGameNameIsApproved(relative, location, value) {
  if (relative === "apps/web/public/data/home.json") {
    return location === "$.hero.subtitle" && value === approvedHomeSubtitle;
  }
  if (relative === "apps/web/components/public-pages/metadata.ts") return true;
  if (relative === "apps/web/lib/site-metadata.ts") return true;
  if (relative === "apps/web/components/SiteHeader.tsx" || relative.startsWith("apps/web/components/site-header/")) return true;
  if (relative === "apps/web/components/SiteFooter.tsx") {
    return value.includes(approvedFooterDescription);
  }
  return false;
}

function checkText(relative, location, value, { canonical = false } = {}) {
  if (canonical) canonicalPublicCopy.push(value);
  for (const { label, pattern } of rules) {
    const match = value.match(pattern);
    if (match) failures.push(`${relative}:${location}: ${label}: ${JSON.stringify(match[0])}`);
  }

  const gameNameMatches = value.match(exactGameName.pattern);
  if (gameNameMatches) {
    exactGameNameCount += gameNameMatches.length;
    if (!exactGameNameIsApproved(relative, location, value)) {
      failures.push(`${relative}:${location}: exact game name is outside an approved title, metadata, Home subtitle, header, or primary footer lane.`);
    }
  }
}

function checkJsonValue(relative, value, pointer = "$") {
  if (typeof value === "string") {
    checkText(relative, pointer, value, { canonical: true });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => checkJsonValue(relative, entry, `${pointer}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => checkJsonValue(relative, entry, `${pointer}.${key}`));
  }
}

for (const relativePath of approvedPublicJsonFiles) {
  const absolute = path.join(root, relativePath);
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  checkJsonValue(relative, JSON.parse(readFileSync(absolute, "utf8")));
}

const directSourceFiles = [
  "apps/web/components/SiteFooter.tsx",
  "apps/web/components/member-workflow/FacebookPagePublishQueue.tsx",
  "apps/web/components/member-workflow/GallerySubmitForm.tsx",
  "apps/web/components/member-workflow/LeaderDashboard.tsx",
  "apps/web/components/public-pages/metadata.ts",
  "supabase/functions/_shared/facebook-page-publishing.ts",
  "supabase/functions/_shared/instagram-publishing.ts",
];

const sourceFiles = directSourceFiles.map((relative) => path.join(root, relative));
const sourceText = new Map();

for (const absolute of sourceFiles) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const source = readFileSync(absolute, "utf8");
  sourceText.set(relative, source);
  source.split(/\r?\n/u).forEach((line, index) => {
    const withoutStylingTokens = line
      .replace(/className\s*=\s*"[^"]*"/gu, "")
      .replace(/className\s*=\s*'[^']*'/gu, "")
      .replace(/className\s*=\s*\{[^}]*\}/gu, "");
    checkText(relative, index + 1, withoutStylingTokens);
  });
}

for (const relative of sharedSocialCaptionSources) {
  if (!sourceText.get(relative)?.includes(sharedSocialCaption)) {
    failures.push(`${relative}: missing the reviewed shared social caption ${JSON.stringify(sharedSocialCaption)}.`);
  }
}

const reviewedPublicCopyText = [
  ...canonicalPublicCopy,
  ...sourceText.values(),
].join("\n");
if (/https?:\/\/(?:www\.)?mochirii\.com\b|\bwww\.mochirii\.com\b/iu.test(reviewedPublicCopyText)) {
  failures.push("public website display must be exactly mochirii.com without a scheme or www prefix.");
}
if (!reviewedPublicCopyText.includes("mochirii.com")) {
  failures.push("reviewed public copy must display the website exactly as mochirii.com.");
}

const instagramPublicationSources = [
  sourceText.get("supabase/functions/_shared/instagram-publishing.ts") || "",
  sourceText.get("apps/web/components/member-workflow/LeaderDashboard.tsx") || "",
].join("\n");
if (/mochirii\.com/iu.test(instagramPublicationSources)) {
  failures.push("Instagram captions and publication UI must not contain or link mochirii.com.");
}

const canonicalPublicCopyText = [...canonicalPublicCopy, sharedSocialCaption].join("\n");
const accentCounts = new Map();
for (const { label, pattern, minimum, maximum } of brandAccents) {
  const count = canonicalPublicCopyText.match(pattern)?.length ?? 0;
  accentCounts.set(label, count);
  if (count < minimum || count > maximum) {
    failures.push(`brand accent ${JSON.stringify(label)} must appear ${minimum}-${maximum} times across canonical public data and the shared social caption; found ${count}.`);
  }
}

for (const { label, pattern } of focusChecks) {
  const count = canonicalPublicCopyText.match(pattern)?.length ?? 0;
  if (count < 1) failures.push(`canonical public copy must include concrete ${label} language.`);
}

if (exactGameNameCount < exactGameName.minimum || exactGameNameCount > exactGameName.maximum) {
  failures.push(`exact game name must appear ${exactGameName.minimum}-${exactGameName.maximum} times across approved lanes; found ${exactGameNameCount}.`);
}

if (failures.length) {
  console.error("Public guild copy contract failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Public guild copy contract OK.");
console.log("- Public copy avoids mood filler and generic non-game phrasing.");
console.log(`- Wushu land (${accentCounts.get("Wushu land")}), pretty (${accentCounts.get("pretty")}) and cupcake (${accentCounts.get("cupcake")}) remain sparse protected brand accents.`);
console.log("- Canonical public copy includes recruitment, events, builds, guides, progression and member activity or support.");
console.log(`- Where Winds Meet remains limited to ${exactGameNameCount} approved title, metadata, Home subtitle and primary footer occurrences.`);
console.log("- Facebook and Instagram publication surfaces retain the reviewed shared social caption.");
console.log("- Public website display is exactly mochirii.com; Instagram publication copy contains no site link.");
