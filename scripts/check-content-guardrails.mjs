import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const webPublicRoot = path.join(root, "apps", "web", "public");
const dataDir = path.join(root, "apps", "web", "public", "data");
const nextConfig = readFileSync(path.join(root, "apps", "web", "next.config.ts"), "utf8");

const topLevelManifest = {
  "announcements.json": ["meta", "items"],
  "tome.json": ["hero", "intro", "tenets", "etiquette", "rhythm", "recognition"],
  "events.json": ["meta", "featured", "upcoming", "recurring", "participation"],
  "gallery.json": ["meta", "categories", "albums"],
  "guild-schedule.json": ["timezone", "discordCoverVersion", "monthly", "spotlight", "weekly"],
  "home.json": ["copy", "celebrationSplash", "hero", "seal", "bulletins", "tiles", "spotlight", "gallery"],
  "join.json": ["hero", "steps", "quickStart", "checklist", "culture", "notes"],
  "leaders.json": ["hero", "panel", "council", "leaders", "responsibilities"],
  "raffles.json": [
    "schemaVersion",
    "programName",
    "meta",
    "publicView",
    "entryModel",
    "rewards",
    "eligibility",
    "standingPrinciples",
    "results",
    "rules",
  ],
  "ranks.json": ["hero", "progression", "tiers"],
  "recruitment.json": ["hero", "meta", "audio", "content"],
  "spotify.json": ["intro", "items"],
  "spotlight.json": ["hero", "spotlight"],
  "twills.json": ["hero", "profile"],
};

const protectedPaths = new Set([
  "apps/web/public/data/home.json.seal.verse",
  "apps/web/public/data/recruitment.json.content.paragraphs",
  "apps/web/public/data/recruitment.json.content.conclusion",
  "apps/web/public/data/twills.json.profile.bio",
]);

const requiredGalleryItemKeys = ["id", "src", "alt", "caption", "category", "tags", "full", "thumb", "galleryAddedAt"];
const allowedGalleryItemKeys = new Set(requiredGalleryItemKeys);
const spotifyTypes = new Set(["album", "artist", "track"]);
const failures = [];
const warnings = [];

function rel(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function addFailure(message) {
  failures.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isKebab(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || ""));
}

function isDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time);
}

function isYearMonth(value) {
  return /^\d{4}-\d{2}$/.test(String(value || ""));
}

function isIsoUtc(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)) return false;
  return Number.isFinite(Date.parse(text));
}

function pathExists(localPath) {
  const cleaned = String(localPath || "").replace(/^\.\//, "").split(/[?#]/)[0];
  return cleaned && existsSync(path.join(webPublicRoot, cleaned));
}

function validateTopLevel(fileName, data) {
  const expected = topLevelManifest[fileName];
  if (!expected) {
    addFailure(`data/${fileName}: unsupported data file; add it to the content guardrail manifest when a renderer supports it.`);
    return;
  }

  const actual = Object.keys(data).sort();
  const expectedSorted = [...expected].sort();
  const extra = actual.filter((key) => !expectedSorted.includes(key));
  const missing = expectedSorted.filter((key) => !actual.includes(key));

  extra.forEach((key) => addFailure(`data/${fileName}: unsupported top-level key "${key}".`));
  missing.forEach((key) => addFailure(`data/${fileName}: missing required top-level key "${key}".`));
}

function checkLocalAsset(filePath, valuePath, value, { allowEmpty = false, requireThumb = false, rejectThumb = false } = {}) {
  if (value === "" && allowEmpty) return;
  if (!isNonEmptyString(value)) {
    addFailure(`${filePath}.${valuePath}: expected a non-empty asset path.`);
    return;
  }

  if (!String(value).startsWith("./assets/")) {
    addFailure(`${filePath}.${valuePath}: expected a local ./assets/ path.`);
    return;
  }

  if (requireThumb && !String(value).includes("/thumbs/")) {
    addFailure(`${filePath}.${valuePath}: expected a thumbnail path.`);
  }

  if (rejectThumb && String(value).includes("/thumbs/")) {
    addFailure(`${filePath}.${valuePath}: expected a full image path, not a thumbnail.`);
  }

  if (!pathExists(value)) {
    addFailure(`${filePath}.${valuePath}: missing asset ${value}.`);
  }
}

function validateHref(filePath, valuePath, value) {
  if (!isNonEmptyString(value)) {
    addFailure(`${filePath}.${valuePath}: href must be non-empty.`);
    return;
  }

  const text = String(value);
  if (/^https?:\/\//.test(text)) {
    try {
      new URL(text);
    } catch {
      addFailure(`${filePath}.${valuePath}: invalid URL.`);
    }
    return;
  }

  if (/^\/[A-Za-z0-9_/-]+(?:[?#].*)?$/.test(text)) {
    const route = text.split(/[?#]/)[0];
    const routeFile = path.join(root, "apps", "web", "app", route.slice(1), "page.tsx");
    if (!existsSync(routeFile)) addFailure(`${filePath}.${valuePath}: missing Next route for ${text}.`);
    return;
  }

  if (!/^\.[/][A-Za-z0-9_-]+\.html(?:[?#].*)?$/.test(text)) {
    addFailure(`${filePath}.${valuePath}: internal href should be a root-relative Next route or relative ./*.html compatibility link.`);
    return;
  }

  const target = text.replace(/^\.\//, "").split(/[?#]/)[0];
  if (!nextConfig.includes(`["/${target}",`)) {
    addFailure(`${filePath}.${valuePath}: missing Next redirect for ${text}.`);
  }
}

function validateGenericValue(filePath, valuePath, key, value, parent) {
  const fullPath = `${filePath}.${valuePath}`;
  if (protectedPaths.has(fullPath) || [...protectedPaths].some((protectedPath) => fullPath.startsWith(`${protectedPath}.`))) return;

  if (typeof value === "string") {
    if (value !== value.trim()) addFailure(`${fullPath}: string has leading or trailing whitespace.`);
    if (/ {2,}/.test(value)) addFailure(`${fullPath}: string contains repeated spaces.`);
    if (/\b(TODO|TBD|Lorem ipsum|Coming soon)\b/i.test(value)) addFailure(`${fullPath}: placeholder copy is not allowed in committed data.`);
    if (/<[A-Za-z][^>]*>/.test(value)) addFailure(`${fullPath}: inline HTML is not supported in JSON text fields.`);

    const keyName = String(key || "");
    const isAllowedGameNamePath =
      keyName === "title" ||
      valuePath.includes(".meta.") ||
      fullPath === "apps/web/public/data/home.json.hero.subtitle";
    if (/Where Winds Meet/i.test(value) && !isAllowedGameNamePath) {
      addFailure(`${fullPath}: visible body copy should not contain the exact game name outside allowed title/metadata contexts.`);
    }
  }

  if (key === "href") {
    validateHref(filePath, valuePath, value);
    if (parent && !["label", "linkLabel", "title"].some((labelKey) => isNonEmptyString(parent[labelKey]))) {
      addFailure(`${filePath}.${valuePath}: href entries need label, linkLabel, or title text.`);
    }
  }

  if (["image", "src"].includes(key)) checkLocalAsset(filePath, valuePath, value);
  if (["full"].includes(key)) checkLocalAsset(filePath, valuePath, value, { rejectThumb: true });
  if (["thumb"].includes(key)) checkLocalAsset(filePath, valuePath, value, { requireThumb: true });
  if (["atmosphereImage", "atmosphere"].includes(key)) checkLocalAsset(filePath, valuePath, value, { allowEmpty: true });
  if (key === "audio" && typeof value === "string") checkLocalAsset(filePath, valuePath, value);

  if (key === "date" && !isDateOnly(value)) addFailure(`${filePath}.${valuePath}: date must use YYYY-MM-DD.`);
  if (key === "updated" && !(isDateOnly(value) || isYearMonth(value))) {
    addFailure(`${filePath}.${valuePath}: updated must use YYYY-MM-DD or YYYY-MM.`);
  }
}

function walkData(filePath, value, trail = [], parent = null) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkData(filePath, item, [...trail, String(index)], value));
    return;
  }

  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, item]) => {
      validateGenericValue(filePath, [...trail, key].join("."), key, item, value);
      walkData(filePath, item, [...trail, key], value);
    });
  }
}

function validateGallery(data) {
  const filePath = "apps/web/public/data/gallery.json";
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const categorySlugs = new Set();
  const itemIds = new Set();
  const fullPaths = new Set();

  if (!categories.length) addFailure(`${filePath}.categories: expected at least one category.`);
  categories.forEach((category, index) => {
    const slug = category?.slug;
    if (!isKebab(slug)) addFailure(`${filePath}.categories.${index}.slug: category slug must be lowercase kebab-case.`);
    if (!isNonEmptyString(category?.label)) addFailure(`${filePath}.categories.${index}.label: category label is required.`);
    if (categorySlugs.has(slug)) addFailure(`${filePath}.categories.${index}.slug: duplicate category "${slug}".`);
    categorySlugs.add(slug);
  });

  const albums = Array.isArray(data.albums) ? data.albums : [];
  if (!albums.length) addFailure(`${filePath}.albums: expected at least one album.`);

  albums.forEach((album, albumIndex) => {
    if (!isNonEmptyString(album?.id)) addFailure(`${filePath}.albums.${albumIndex}.id: album id is required.`);
    if (!isNonEmptyString(album?.label)) addFailure(`${filePath}.albums.${albumIndex}.label: album label is required.`);
    const items = Array.isArray(album?.items) ? album.items : [];
    if (!items.length) addFailure(`${filePath}.albums.${albumIndex}.items: expected at least one Gallery item.`);

    items.forEach((item, itemIndex) => {
      const base = `${filePath}.albums.${albumIndex}.items.${itemIndex}`;
      const keys = Object.keys(item || {});

      requiredGalleryItemKeys.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(item, key)) addFailure(`${base}: missing required key "${key}".`);
      });
      keys
        .filter((key) => !allowedGalleryItemKeys.has(key))
        .forEach((key) => addFailure(`${base}: unsupported Gallery item key "${key}".`));

      if (!isNonEmptyString(item?.id)) addFailure(`${base}.id: id is required.`);
      if (itemIds.has(item?.id)) addFailure(`${base}.id: duplicate Gallery id "${item.id}".`);
      itemIds.add(item?.id);

      if (!categorySlugs.has(item?.category)) addFailure(`${base}.category: unsupported category "${item?.category}".`);
      if (!isNonEmptyString(item?.alt)) addFailure(`${base}.alt: alt text is required.`);
      if (!isNonEmptyString(item?.caption)) addFailure(`${base}.caption: caption is required.`);
      if (!isIsoUtc(item?.galleryAddedAt)) addFailure(`${base}.galleryAddedAt: timestamp must be ISO UTC with milliseconds.`);

      const tags = Array.isArray(item?.tags) ? item.tags : [];
      if (!tags.length) addFailure(`${base}.tags: expected at least one tag.`);
      const seenTags = new Set();
      tags.forEach((tag, tagIndex) => {
        if (!isKebab(tag)) addFailure(`${base}.tags.${tagIndex}: tag must be lowercase kebab-case.`);
        if (seenTags.has(tag)) addFailure(`${base}.tags.${tagIndex}: duplicate tag "${tag}".`);
        seenTags.add(tag);
      });

      if (fullPaths.has(item?.full)) addFailure(`${base}.full: duplicate Gallery full path "${item?.full}".`);
      fullPaths.add(item?.full);
    });
  });
}

function validateHome(data) {
  const splash = data?.celebrationSplash;
  if (!splash || typeof splash !== "object" || Array.isArray(splash)) {
    addFailure("data/home.json.celebrationSplash: expected object.");
  } else {
    if (typeof splash.enabled !== "boolean") addFailure("data/home.json.celebrationSplash.enabled: expected boolean.");
    if (splash.title !== "Happy Birthday Sinbell!!") addFailure("data/home.json.celebrationSplash.title: expected approved birthday title.");
    if (splash.message !== "Mochi spirits love you!!") addFailure("data/home.json.celebrationSplash.message: expected approved birthday message.");
    if (!isNonEmptyString(splash.storageKey)) addFailure("data/home.json.celebrationSplash.storageKey: expected non-empty storage key.");
    ["startsAt", "endsAt"].forEach((key) => {
      if (typeof splash[key] !== "string") addFailure(`data/home.json.celebrationSplash.${key}: expected string.`);
      if (typeof splash[key] === "string" && splash[key].trim() && Number.isNaN(Date.parse(splash[key]))) {
        addFailure(`data/home.json.celebrationSplash.${key}: expected a parseable date or empty string.`);
      }
    });
  }

  const items = Array.isArray(data.gallery) ? data.gallery : [];
  if (items.length !== 4) addFailure(`data/home.json.gallery: expected 4 fallback Gallery items, got ${items.length}.`);
  items.forEach((item, index) => {
    const base = `data/home.json.gallery.${index}`;
    checkLocalAsset("data/home.json", `gallery.${index}.image`, item?.image, { requireThumb: true });
    checkLocalAsset("data/home.json", `gallery.${index}.full`, item?.full, { rejectThumb: true });
    if (!isNonEmptyString(item?.alt)) addFailure(`${base}.alt: fallback Gallery alt text is required.`);
  });
}

function validateEvents(data) {
  if (data?.featured?.date && !isDateOnly(data.featured.date)) addFailure("data/events.json.featured.date: date must use YYYY-MM-DD.");
  const upcoming = Array.isArray(data?.upcoming) ? data.upcoming : [];
  upcoming.forEach((item, index) => {
    if (!isDateOnly(item?.date)) addFailure(`data/events.json.upcoming.${index}.date: date must use YYYY-MM-DD.`);
  });
}

function validateSpotify(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) addFailure("data/spotify.json.items: expected at least one Spotify item.");

  items.forEach((item, index) => {
    const base = `data/spotify.json.items.${index}`;
    if (!spotifyTypes.has(item?.type)) addFailure(`${base}.type: unsupported Spotify type "${item?.type}".`);
    if (!isNonEmptyString(item?.title)) addFailure(`${base}.title: title is required.`);
    if (!Array.isArray(item?.tags) || !item.tags.length) addFailure(`${base}.tags: expected at least one tag.`);
    if (!Number.isFinite(item?.height) || item.height < 100 || item.height > 500) {
      addFailure(`${base}.height: expected a numeric iframe height between 100 and 500.`);
    }

    const embed = String(item?.embed || "");
    if (!/^https:\/\/open\.spotify\.com\/embed\/(?:album|artist|track)\/[A-Za-z0-9]+(?:\?.*)?$/.test(embed)) {
      addFailure(`${base}.embed: expected a supported open.spotify.com embed URL.`);
    }
  });
}

function isTime24(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function validateGuildSchedule(data) {
  const filePath = "apps/web/public/data/guild-schedule.json";
  if (data?.timezone?.label !== "UTC+8") addFailure(`${filePath}.timezone.label: expected UTC+8.`);
  if (data?.timezone?.displayLabel !== "Singapore Time (UTC+8)") {
    addFailure(`${filePath}.timezone.displayLabel: expected Singapore Time (UTC+8).`);
  }
  if (data?.timezone?.ianaZone !== "Asia/Singapore") {
    addFailure(`${filePath}.timezone.ianaZone: expected Asia/Singapore.`);
  }
  if (data?.timezone?.offsetMinutes !== 480) addFailure(`${filePath}.timezone.offsetMinutes: expected 480.`);

  ["gathering", "raffle"].forEach((key) => {
    const item = data?.monthly?.[key];
    if (!item) {
      addFailure(`${filePath}.monthly.${key}: expected monthly schedule item.`);
      return;
    }
    if (!isKebab(item.id)) addFailure(`${filePath}.monthly.${key}.id: expected kebab-case id.`);
    if (item.rule !== "next-first-saturday") addFailure(`${filePath}.monthly.${key}.rule: expected next-first-saturday.`);
    if (!isTime24(item.startTime)) addFailure(`${filePath}.monthly.${key}.startTime: expected HH:MM.`);
    if (!isTime24(item.endTime)) addFailure(`${filePath}.monthly.${key}.endTime: expected HH:MM.`);
  });

  if (data?.spotlight?.rule !== "first-day-current-month") {
    addFailure(`${filePath}.spotlight.rule: expected first-day-current-month.`);
  }

  const weekly = Array.isArray(data?.weekly) ? data.weekly : [];
  if (weekly.length < 5) addFailure(`${filePath}.weekly: expected weekly schedule items.`);
  weekly.forEach((item, index) => {
    const base = `${filePath}.weekly.${index}`;
    if (!isKebab(item?.id)) addFailure(`${base}.id: expected kebab-case id.`);
    if (!isNonEmptyString(item?.title)) addFailure(`${base}.title: title is required.`);
    if (!Array.isArray(item?.days) || !item.days.length) addFailure(`${base}.days: expected one or more weekday numbers.`);
    (Array.isArray(item?.days) ? item.days : []).forEach((day, dayIndex) => {
      if (!Number.isInteger(day) || day < 0 || day > 6) addFailure(`${base}.days.${dayIndex}: weekday must be 0-6.`);
    });
    if (!isTime24(item?.startTime)) addFailure(`${base}.startTime: expected HH:MM.`);
    if (!isTime24(item?.endTime)) addFailure(`${base}.endTime: expected HH:MM.`);
    if (!isNonEmptyString(item?.timeText)) addFailure(`${base}.timeText: time text is required.`);
  });
}

function validateAllData() {
  const files = readdirSync(dataDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  files.forEach((fileName) => {
    const filePath = `apps/web/public/data/${fileName}`;
    const data = readJson(filePath);

    validateTopLevel(fileName, data);
    walkData(filePath, data);

    if (fileName === "gallery.json") validateGallery(data);
    if (fileName === "home.json") validateHome(data);
    if (fileName === "events.json") validateEvents(data);
    if (fileName === "guild-schedule.json") validateGuildSchedule(data);
    if (fileName === "spotify.json") validateSpotify(data);
  });

  Object.keys(topLevelManifest)
    .filter((fileName) => !files.includes(fileName))
    .forEach((fileName) => addFailure(`data/${fileName}: expected data file is missing.`));
}

validateAllData();

if (failures.length) {
  console.error(`Content guardrails failed (${failures.length} issues).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

warnings.forEach((warning) => console.warn(`WARN ${warning}`));
console.log(`Content guardrails OK (${Object.keys(topLevelManifest).length} data files${warnings.length ? `, ${warnings.length} warnings` : ""}).`);
