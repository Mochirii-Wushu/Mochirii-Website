import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeEventCovers } from "./generate-discord-event-covers.mjs";

const require = createRequire(import.meta.url);
const sharp = require("../apps/web/node_modules/sharp");
const schedule = JSON.parse(readFileSync(new URL("../apps/web/public/data/guild-schedule.json", import.meta.url), "utf8"));
const names = [
  "breaking-army.png", "guild-heros-realm.png", "guild-party.png", "guild-wars.png",
  "monthly-gathering.png", "monthly-raffle.png", "showdown.png", "skyward-bond.png",
];
const script = fileURLToPath(new URL("./generate-discord-event-covers.mjs", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function image(width = 800, height = 320, alpha = false) {
  const drawing = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#234567"/><rect width="20" height="20" fill="#ff0000"/><rect x="${width - 20}" y="${height - 20}" width="20" height="20" fill="#00ff00"/></svg>`);
  const pipeline = sharp(drawing);
  return (alpha ? pipeline.ensureAlpha() : pipeline.removeAlpha()).png().toBuffer();
}

async function fixture(t, bytes) {
  const input = bytes || await image();
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "mochi-cover-normalizer-"));
  t.after(() => {
    assert.equal(path.dirname(rootDirectory), path.resolve(tmpdir()));
    assert.ok(path.basename(rootDirectory).startsWith("mochi-cover-normalizer-"));
    rmSync(rootDirectory, { recursive: true, force: true });
  });
  const sourceDir = path.join(rootDirectory, "source");
  const outputDir = path.join(rootDirectory, "output");
  const dataDir = path.join(rootDirectory, "apps/web/public/data");
  mkdirSync(sourceDir);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "guild-schedule.json"), JSON.stringify(schedule));
  for (const name of names) writeFileSync(path.join(sourceDir, name), input);
  writeFileSync(path.join(sourceDir, "unrelated.txt"), "preserve source file");
  writeFileSync(path.join(dataDir, "unrelated.json"), "preserve canonical file");
  return { rootDirectory, sourceDir, outputDir };
}

test("exports all eight configured covers with exact dimensions, hashes and uncropped corner anchors", async (t) => {
  const options = await fixture(t);
  const originals = names.map((name) => readFileSync(path.join(options.sourceDir, name)));
  mkdirSync(options.outputDir);
  writeFileSync(path.join(options.outputDir, "unrelated.txt"), "preserve output file");
  const report = await normalizeEventCovers(options);
  assert.deepEqual(report.covers.map((cover) => cover.file), names);
  assert.ok(report.covers.some((cover) => cover.file === "skyward-bond.png"));
  assert.ok(!report.covers.some((cover) => cover.file === "united-resolve.png"));
  for (const [index, cover] of report.covers.entries()) {
    const bytes = readFileSync(path.join(options.outputDir, cover.file));
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.height, 640);
    assert.equal(metadata.hasAlpha, false);
    assert.deepEqual(cover.source, { width: 800, height: 320, bytes: originals[index].length });
    assert.deepEqual(cover.output, { width: 1600, height: 640, bytes: bytes.length, sha256: digest(bytes) });
    assert.deepEqual(readFileSync(path.join(options.sourceDir, cover.file)), originals[index]);
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 3);
    assert.deepEqual([...data.subarray(0, 3)], [255, 0, 0]);
    assert.deepEqual([...data.subarray(data.length - 3)], [0, 255, 0]);
  }
  assert.equal(readFileSync(path.join(options.sourceDir, "unrelated.txt"), "utf8"), "preserve source file");
  assert.equal(readFileSync(path.join(options.outputDir, "unrelated.txt"), "utf8"), "preserve output file");
  assert.equal(readFileSync(path.join(options.rootDirectory, "apps/web/public/data/unrelated.json"), "utf8"), "preserve canonical file");
});

test("accepts the generated 1983x793 canvas with bounded source-pixel rounding", async (t) => {
  const options = await fixture(t, await image(1983, 793));
  const report = await normalizeEventCovers(options);
  assert.equal(report.covers.length, 8);
  assert.ok(report.covers.every((cover) => cover.source.width === 1983 && cover.source.height === 793));
  assert.ok(report.covers.every((cover) => cover.output.width === 1600 && cover.output.height === 640));
});

test("validates every source before writing when the last configured image is missing", async (t) => {
  const options = await fixture(t);
  rmSync(path.join(options.sourceDir, "skyward-bond.png"));
  await assert.rejects(normalizeEventCovers(options), /skyward-bond\.png: missing standalone PNG/);
  assert.equal(existsSync(options.outputDir), false);
});

test("rejects dimensions beyond one source pixel of aspect rounding without partial exports", async (t) => {
  const options = await fixture(t);
  writeFileSync(path.join(options.sourceDir, "skyward-bond.png"), await image(1984, 793));
  await assert.rejects(normalizeEventCovers(options), /at most one source pixel/);
  assert.equal(existsSync(options.outputDir), false);
});

test("rejects alpha-channel artwork without partial exports", async (t) => {
  const options = await fixture(t);
  writeFileSync(path.join(options.sourceDir, "skyward-bond.png"), await image(800, 320, true));
  await assert.rejects(normalizeEventCovers(options), /opaque, single-frame PNG/);
  assert.equal(existsSync(options.outputDir), false);
});

test("rejects nonregular source entries without partial exports", async (t) => {
  const options = await fixture(t);
  rmSync(path.join(options.sourceDir, "skyward-bond.png"));
  mkdirSync(path.join(options.sourceDir, "skyward-bond.png"));
  await assert.rejects(normalizeEventCovers(options), /expected an ordinary file/);
  assert.equal(existsSync(options.outputDir), false);
});

test("decodes all eight images before exporting when a late PNG is truncated", async (t) => {
  const options = await fixture(t);
  const bytes = await image(1983, 793);
  writeFileSync(path.join(options.sourceDir, "skyward-bond.png"), bytes.subarray(0, bytes.length - 32));
  await assert.rejects(normalizeEventCovers(options));
  assert.equal(existsSync(options.outputDir), false);
});

test("preserves unknown existing exports and writes no earlier covers", async (t) => {
  const options = await fixture(t);
  mkdirSync(options.outputDir);
  writeFileSync(path.join(options.outputDir, "skyward-bond.png"), "unknown existing export");
  await assert.rejects(normalizeEventCovers(options), /output already exists/);
  assert.deepEqual(readdirSync(options.outputDir), ["skyward-bond.png"]);
  assert.equal(readFileSync(path.join(options.outputDir, "skyward-bond.png"), "utf8"), "unknown existing export");
});

test("rejects source/output overlap and canonical public exports", async (t) => {
  const options = await fixture(t);
  for (const outputDir of [options.sourceDir, path.join(options.sourceDir, "nested"), options.rootDirectory,
    path.join(options.rootDirectory, "apps/web/public/assets/img/discord-events")]) {
    await assert.rejects(normalizeEventCovers({ ...options, outputDir }), /Output must be separate/);
  }
  assert.equal(existsSync(options.outputDir), false);
});

test("rejects malformed configured basenames and retired or duplicate cover identities", async (t) => {
  const options = await fixture(t);
  const schedulePath = path.join(options.rootDirectory, "apps/web/public/data/guild-schedule.json");
  for (const cover of ["../escape.png", "./assets/img/discord-events/united-resolve.png", "./assets/img/discord-events/guild-party.png"]) {
    const changed = structuredClone(schedule);
    changed.weekly.find((item) => item.id === "united-resolve").discordCoverImage = cover;
    writeFileSync(schedulePath, JSON.stringify(changed));
    await assert.rejects(normalizeEventCovers(options), /configured event cover|eight distinct configured covers/);
    assert.equal(existsSync(options.outputDir), false);
  }
});

test("CLI requires explicit source/output arguments and reports complete export metadata", async (t) => {
  const options = await fixture(t);
  for (const args of [[], ["--source-dir", options.sourceDir], ["--unknown", "value"],
    ["constructor", "value", "--source-dir", options.sourceDir, "--output-dir", options.outputDir],
    ["--source-dir", options.sourceDir, "--source-dir", options.sourceDir, "--output-dir", options.outputDir]]) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: options.rootDirectory, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: npm run generate:discord-event-covers/);
    assert.equal(existsSync(options.outputDir), false);
  }
  const result = spawnSync(process.execPath, [script, "--source-dir", options.sourceDir, "--output-dir", options.outputDir],
    { cwd: options.rootDirectory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.covers.length, 8);
  assert.ok(report.covers.every((cover) => /^[a-f0-9]{64}$/.test(cover.output.sha256)));
});
