import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireWeb = createRequire(path.join(root, "apps/web/package.json"));
const original = "apps/web/public/assets/bg/wuxia-bg.webp";
const originalSha256 = "043e3c355a0a62bcb09e917015201083121e4027d9dd3f8e676de30ff32d63aa";
const publicDestination = path.join(root, "apps/web/public/assets/home/background");
const destination = process.argv[2] ? path.resolve(root, process.argv[2]) : publicDestination;
const operations = path.join(root, ".artifacts/operations/homepage-preview-4");
assert.ok(destination === publicDestination || destination.startsWith(operations + path.sep), "Only a fresh owned output directory is accepted");
const evidence = path.join(operations, "revision-20261027/background-delivery-copy-22c.json");
const profiles = [
  [640, 427, 44010, "c2c5b70fb22da97b392ee7e603c4080a2a5d1235941ecb5b747a707b97c5ef02"],
  [828, 552, 66812, "7d3abfade4e3fa32e1d8c91b75d842039bc7ecd03a33aaa633d6f6c80cb62ba3"],
  [1080, 720, 100530, "f52ebe41d5e7b82c0a7e66fa5218a12e967d75182b483608446a73743189cce4"],
  [1200, 800, 115394, "a25a9ed73cea7e2d0258580249d32730f779f14cb9e412840d87203a2fd30cf2"],
  [1536, 1024, 204764, "a49978e2ad6e7b597e88983e65f6b4ca762bf378194f92e8db0f89a841165df9"],
];
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
assert.equal(requireWeb("next/package.json").version, "16.3.8");
const sharp = requireWeb("sharp");
assert.equal(sharp.versions.sharp, "0.35.5");
await assert.rejects(fs.access(destination), { code: "ENOENT" }, "Never overwrite an existing delivery directory");
await assert.rejects(fs.access(evidence), { code: "ENOENT" }, "Preserve prior copy evidence");
const source = await fs.readFile(path.join(root, original));
assert.equal(hash(source), originalSha256, "Only the approved unchanged background is accepted");
const sourceMeta = await sharp(source).metadata();
assert.equal(sourceMeta.width, 1536);
assert.equal(sourceMeta.height, 1024);
const cacheRoot = await fs.realpath(path.join(root, "apps/web/.next/cache/images"));
assert.ok(cacheRoot.startsWith(root + path.sep), "Cache must stay in the owned worktree");
const exports = [];
const seen = new Set();
// Next16.3.8 cache v4 hashes these exact URL/width/quality/format parameters.
// Read only the five computed directories, never scan or mutate the cache.
for (const [width, height, bytes, sha256] of profiles) {
  const requestedWidth = width === 1536 ? 1920 : width;
  const keyHash = createHash("sha256");
  for (const value of [4, "/assets/bg/wuxia-bg.webp", requestedWidth, 75, "image/webp"]) keyHash.update(String(value));
  const folder = path.join(cacheRoot, keyHash.digest("base64url"));
  assert.ok((await fs.realpath(folder)).startsWith(cacheRoot + path.sep));
  const names = (await fs.readdir(folder)).filter((name) => /^\d+\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.webp$/.test(name)).sort();
  assert.ok(names.length > 0 && names.length <= 4, "Bounded existing cache entries required");
  let buffer, copiedFrom;
  for (const name of names) {
    const file = path.join(folder, name), stat = await fs.lstat(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    if (stat.size !== bytes) continue;
    const candidate = await fs.readFile(file);
    if (hash(candidate) !== sha256) continue;
    buffer = candidate;
    copiedFrom = path.relative(root, file).replaceAll("\\", "/");
    break;
  }
  assert.ok(buffer, "No exact reviewed cached response for width " + width);
  assert.equal(seen.has(sha256), false, "Identical outputs must be deduplicated");
  seen.add(sha256);
  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  assert.equal(metadata.hasAlpha, false);
  exports.push({ width, height, bytes, sha256, requestedWidth, quality: 75, buffer, copiedFrom, name: `wuxia-bg-${width}.webp` });
}
assert.equal(hash(await fs.readFile(path.join(root, original))), originalSha256);
await fs.mkdir(destination);
for (const output of exports) await fs.writeFile(path.join(destination, output.name), output.buffer, { flag: "wx" });
for (const output of exports) assert.equal(hash(await fs.readFile(path.join(destination, output.name))), output.sha256);
if (destination !== publicDestination) {
  for (const output of exports) assert.equal(hash(await fs.readFile(path.join(publicDestination, output.name))), output.sha256, "Existing public bytes must equal copied cache bytes");
}
const report = {
  at: new Date().toISOString(), original, originalSha256, originalBytes: source.length,
  sourceDimensions: { width: sourceMeta.width, height: sourceMeta.height },
  nextVersion: "16.3.8", sharpVersion: "0.35.5", cacheVersion: 4,
  scope: "Five exact cached public-background responses copied only; no encoding, original/cache writes or network",
  outputDirectory: path.relative(root, destination).replaceAll("\\", "/"),
  existingPublicFilesMatch: destination !== publicDestination,
  files: exports.map(({ buffer: _buffer, name, ...output }) => ({ path: path.relative(root, path.join(destination, name)).replaceAll("\\", "/"), ...output })),
};
await fs.writeFile(evidence, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report));
