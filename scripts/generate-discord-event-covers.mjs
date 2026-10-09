import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("../apps/web/node_modules/sharp");
const outputSize = { width: 1600, height: 640 };
const usage = "Usage: npm run generate:discord-event-covers -- --source-dir <standalone-PNG-directory> --output-dir <separate-export-directory>";

function configuredBasenames(rootDirectory) {
  const schedule = JSON.parse(readFileSync(path.join(rootDirectory, "apps/web/public/data/guild-schedule.json"), "utf8"));
  const items = [
    ...Object.values(schedule.monthly || {}),
    ...(schedule.weekly || []).filter((item) => item.discord === true),
  ];
  const names = items.map((item) => {
    const match = String(item.discordCoverImage || "").match(/^\.?\/?assets\/img\/discord-events\/([a-z0-9-]+\.png)$/);
    if (!match) throw new Error("Every configured event cover must be a PNG in assets/img/discord-events.");
    return match[1];
  });
  if (names.length !== 8 || new Set(names).size !== 8
    || !names.includes("skyward-bond.png") || names.includes("united-resolve.png")) {
    throw new Error("Expected exactly eight distinct configured covers, including Skyward Bond.");
  }
  return names.sort();
}

function physicalPath(value) {
  let ancestor = path.resolve(value);
  const suffix = [];
  while (!existsSync(ancestor)) {
    suffix.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("Directory has no existing parent.");
    ancestor = parent;
  }
  return path.join(realpathSync(ancestor), ...suffix);
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

export async function normalizeEventCovers({ sourceDir, outputDir, rootDirectory = process.cwd() }) {
  if (!sourceDir || !outputDir) throw new Error(usage);
  const sourceStats = lstatSync(sourceDir);
  if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) throw new Error("Source must be an ordinary directory.");
  const source = physicalPath(sourceDir);
  const output = physicalPath(outputDir);
  const publicDirectory = physicalPath(path.join(rootDirectory, "apps/web/public"));
  if (contains(source, output) || contains(output, source)
    || contains(publicDirectory, output) || contains(output, publicDirectory)) {
    throw new Error("Output must be separate from the source and canonical public directory.");
  }
  if (existsSync(outputDir)) {
    const stats = lstatSync(outputDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("Output must be an ordinary directory.");
  }
  const names = configuredBasenames(rootDirectory);
  const inputs = [];
  for (const file of names) {
    const inputPath = path.join(source, file);
    const stats = lstatSync(inputPath, { throwIfNoEntry: false });
    if (!stats) throw new Error(`${file}: missing standalone PNG.`);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${file}: expected an ordinary file.`);
    if (stats.size > 8 * 1024 * 1024) throw new Error(`${file}: source exceeds 8 MiB.`);
    if (lstatSync(path.join(output, file), { throwIfNoEntry: false })) throw new Error(`${file}: output already exists; use a fresh export directory.`);
    const bytes = readFileSync(inputPath);
    const metadata = await sharp(bytes, { limitInputPixels: 64 * 1024 * 1024, failOn: "warning" }).metadata();
    if (metadata.format !== "png" || metadata.hasAlpha || (metadata.pages || 1) !== 1) {
      throw new Error(`${file}: expected an opaque, single-frame PNG.`);
    }
    if (!metadata.width || !metadata.height || Math.abs(metadata.width - metadata.height * 5 / 2) > 1) {
      throw new Error(`${file}: expected 5:2 dimensions, allowing at most one source pixel of width rounding.`);
    }
    inputs.push({ file, bytes, width: metadata.width, height: metadata.height });
  }

  // Decode and normalize all eight before creating any output. The bounded aspect
  // rounding permits a full-canvas export without cropping or padding.
  const exports = [];
  for (const input of inputs) {
    const bytes = await sharp(input.bytes, { limitInputPixels: 64 * 1024 * 1024, failOn: "warning" })
      .resize(outputSize.width, outputSize.height, { fit: "fill" })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    exports.push({
      file: input.file,
      bytes,
      source: { width: input.width, height: input.height, bytes: input.bytes.length },
      output: { ...outputSize, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
    });
  }
  mkdirSync(output, { recursive: true });
  for (const entry of exports) writeFileSync(path.join(output, entry.file), entry.bytes, { flag: "wx" });
  return { sourceDir: source, outputDir: output, covers: exports.map(({ bytes, ...entry }) => entry) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index] === "--source-dir" ? "sourceDir" : args[index] === "--output-dir" ? "outputDir" : null;
    if (!key || options[key] || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(usage);
    options[key] = args[index + 1];
  }
  console.log(JSON.stringify(await normalizeEventCovers(options), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
