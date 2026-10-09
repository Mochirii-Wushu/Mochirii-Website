import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const schedule = JSON.parse(readFileSync(path.join(root, "apps/web/public/data/guild-schedule.json"), "utf8"));
const failures = [];

const expectedCovers = [
  "assets/img/discord-events/monthly-gathering.png",
  "assets/img/discord-events/monthly-raffle.png",
  "assets/img/discord-events/guild-party.png",
  "assets/img/discord-events/breaking-army.png",
  "assets/img/discord-events/showdown.png",
  "assets/img/discord-events/guild-wars.png",
  "assets/img/discord-events/guild-heros-realm.png",
  "assets/img/discord-events/skyward-bond.png",
];

const expectedHashes = {
  "assets/img/discord-events/breaking-army.png": "f850b1aa64c7cbaafd1fcc9bf6405eafc2fe3da03c755b9d32f93aa91d4f86cc",
  "assets/img/discord-events/guild-heros-realm.png": "cc2daeaa96ac67be56cf03bc8720f4470b582e79bcf7fe97accaf3350f750e21",
  "assets/img/discord-events/guild-party.png": "8d4842162e70e50683831d193ca620a9ef0b06d435bf02912e3f8cb57606ed8b",
  "assets/img/discord-events/guild-wars.png": "4de3f1fb017e1eb6140b0f85b330f396837d9301e404e706c0c0f5651ccad850",
  "assets/img/discord-events/monthly-gathering.png": "014652ac59a32da57be5fc90b44bad677ba1a0cef8d14805e70006f009fa2023",
  "assets/img/discord-events/monthly-raffle.png": "f249289301ab7f6fd12a7ccdbfe44091e2f49abae3803b6606a3eca0c576a45b",
  "assets/img/discord-events/showdown.png": "3854c80b3850321a78ee94e39b763d3dcb9a598421bbbfc587af7d670ebaabca",
  "assets/img/discord-events/skyward-bond.png": "46afb9f9a134af35591750686f070de714edc70c44701d9bfc8611604a9e3fe9",
};

function fail(message) {
  failures.push(message);
}

function normalizeCover(value) {
  return String(value || "").replace(/^\.?\//, "");
}

function coverValues() {
  const monthly = Object.values(schedule.monthly || {}).map((item) => normalizeCover(item.discordCoverImage));
  const weekly = (schedule.weekly || [])
    .filter((item) => item.discord === true)
    .map((item) => normalizeCover(item.discordCoverImage));
  return [...new Set([...monthly, ...weekly].filter(Boolean))].sort();
}

function pngDimensions(file) {
  const bytes = readFileSync(file);
  const signature = bytes.subarray(0, 8);
  const expectedSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(expectedSignature)) return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const configured = coverValues();
const expectedSorted = [...expectedCovers].sort();

if (configured.length !== expectedSorted.length) {
  fail(`expected ${expectedSorted.length} configured Discord event covers, received ${configured.length}.`);
}

for (const cover of expectedSorted) {
  if (!configured.includes(cover)) fail(`missing configured Discord event cover: ${cover}`);
}

for (const cover of configured) {
  if (!expectedSorted.includes(cover)) fail(`unexpected configured Discord event cover: ${cover}`);
  for (const base of ["apps/web/public/"]) {
    const file = path.join(root, base, cover);
    const label = `${base}${cover}`;
    if (!existsSync(file)) {
      fail(`${label}: missing Discord event cover asset.`);
      continue;
    }

    const dimensions = pngDimensions(file);
    if (!dimensions) {
      fail(`${label}: expected a PNG image.`);
      continue;
    }

    if (dimensions.width < 800 || dimensions.height < 320) {
      fail(`${label}: expected at least 800x320, received ${dimensions.width}x${dimensions.height}.`);
    }

    if (dimensions.width !== 1600 || dimensions.height !== 640) {
      fail(`${label}: expected 1600x640 release cover, received ${dimensions.width}x${dimensions.height}.`);
    }

    const hash = sha256(file);
    if (hash !== expectedHashes[cover]) {
      fail(`${label}: expected approved panel export hash ${expectedHashes[cover]}, received ${hash}.`);
    }
  }
}

if (failures.length) {
  console.error("Discord event cover validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Discord event cover validation OK.");
