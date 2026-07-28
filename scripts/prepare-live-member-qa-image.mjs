import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

const root = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const selfTest = args.includes("--self-test");
const width = 96;
const height = 96;
const maxBytes = 8 * 1024 * 1024;

function argValue(name) {
  const match = args.find((value) => value.startsWith(`${name}=`));
  return match ? match.split("=").slice(1).join("=") : "";
}

const outArg = argValue("--out") || process.env.QA_TEST_IMAGE_PATH_LOCAL || "";

function fail(message) {
  throw new Error(message);
}

function insideRepo(absolutePath) {
  const relative = path.relative(root, absolutePath);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateTarget(value) {
  if (!value) fail("Provide --out=/absolute/private/mochirii-qa-test.png or QA_TEST_IMAGE_PATH_LOCAL.");
  if (!path.isAbsolute(value)) fail("QA image path must be absolute and outside the repository.");

  const absolute = path.resolve(value);
  if (insideRepo(absolute) || absolute === root) fail("QA image path must stay outside the repository.");
  if (path.extname(absolute).toLowerCase() !== ".png") fail("QA image helper writes PNG files; use a .png target.");
  if (existsSync(absolute) && !force) fail("QA image target already exists. Use --force only after reviewing local-only QA state.");

  return absolute;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));

  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function qaImagePng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0; // no filter
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const diagonal = Math.abs(x - y) < 6;
      const border = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
      const checker = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0;

      row[offset] = border ? 43 : diagonal ? 180 : checker ? 235 : 245;
      row[offset + 1] = border ? 74 : diagonal ? 92 : checker ? 205 : 224;
      row[offset + 2] = border ? 88 : diagonal ? 118 : checker ? 154 : 180;
      row[offset + 3] = 255;
    }
    rows.push(row);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function prepare(target) {
  const png = qaImagePng();
  if (png.length <= 0 || png.length > maxBytes) fail("Generated QA image size is invalid.");

  if (!dryRun) writeFileSync(target, png, { mode: 0o600 });
  return png.length;
}

function runSelfTest() {
  const temp = mkdtempSync(path.join(os.tmpdir(), "mochirii-live-member-qa-image-"));
  try {
    const target = path.join(temp, "mochirii-qa-test.png");
    const size = prepare(target);
    const stats = statSync(target);
    if (!stats.isFile()) fail("Self-test expected a file.");
    if (stats.size !== size) fail("Self-test expected generated size to match written size.");

    let refusedOverwrite = false;
    try {
      validateTarget(target);
    } catch {
      refusedOverwrite = true;
    }
    if (!refusedOverwrite) fail("Self-test expected overwrite refusal.");

    let refusedRepoPath = false;
    try {
      validateTarget(path.join(root, "mochirii-qa-test.png"));
    } catch {
      refusedRepoPath = true;
    }
    if (!refusedRepoPath) fail("Self-test expected repo-local output refusal.");

    console.log("Live member QA image preparation self-test OK (paths redacted).");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

try {
  if (selfTest) {
    runSelfTest();
    process.exit(0);
  }

  const target = validateTarget(outArg);
  const size = dryRun ? qaImagePng().length : prepare(target);

  console.log("Live member QA image preparation OK (path redacted).");
  console.log(dryRun ? "Mode: dry run; no image written." : "Mode: PNG image written outside the repository.");
  console.log(`Generated PNG size: ${size} bytes.`);
  console.log("Set QA_TEST_IMAGE_PATH_LOCAL privately before strict D03 preflight. This helper does not authorize upload or moderation.");
} catch (error) {
  console.error(`Live member QA image preparation failed: ${error?.message || error}`);
  console.error("No absolute paths, credentials, account names, or private packet values were printed.");
  process.exit(1);
}
