import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

// Only the new, reviewed master is trimmed/resized. Published artwork is untouched.
const root = process.cwd();
const master = process.argv[2];
const evidence = process.argv[3];
if (!master || !evidence) throw new Error("Supply a reviewed PNG master and ignored operations evidence directory.");
const artifactRoot = path.resolve(root, ".artifacts/operations");
const outputEvidence = path.resolve(evidence);
if (!outputEvidence.startsWith(artifactRoot + path.sep)) throw new Error("Evidence must stay in ignored operations artifacts.");
const sharp = createRequire(path.join(root, "apps/web/package.json"))("sharp");
const input = await fs.readFile(master);
const metadata = await sharp(input).metadata();
if (metadata.format !== "png" || !metadata.hasAlpha || metadata.width * metadata.height > 8_500_000) {
  throw new Error("Expected a bounded, genuine-alpha PNG master.");
}
let delivered, quality;
for (quality of [80, 74, 68]) {
  delivered = await sharp(input).trim().resize({ width: 1024, withoutEnlargement: true }).webp({ quality, alphaQuality: 100, effort: 6 }).toBuffer();
  if (delivered.length <= 80 * 1024) break;
}
if (delivered.length > 80 * 1024) throw new Error("Sword exceeds the fixed 80 KiB delivery ceiling.");
const deliveredMetadata = await sharp(delivered).metadata();
const alpha = (await sharp(delivered).stats()).channels[3];
if (!alpha || alpha.min !== 0 || alpha.max !== 255 || alpha.mean >= 230) {
  throw new Error("Sword must be a genuine transparent cutout, not an opaque RGBA rectangle.");
}
const asset = "apps/web/public/assets/home/transitions/sword-duel/forged-jian-1024.webp";
await fs.mkdir(outputEvidence, { recursive: true });
const manifest = {
  asset, bytes: delivered.length, quality, width: deliveredMetadata.width, height: deliveredMetadata.height,
  alpha: deliveredMetadata.hasAlpha, alphaRange: { min: alpha.min, max: alpha.max, mean: alpha.mean },
  metadataStripped: !deliveredMetadata.exif && !deliveredMetadata.icc && !deliveredMetadata.xmp,
  sha256: createHash("sha256").update(delivered).digest("hex"),
  recipe: "Transparent-margin trim; proportional maximum width 1024; WebP quality 80/74/68 bounded trials; alpha quality 100; effort 6; no enlargement or semantic alteration.",
  reuse: "One requested asset, reused for two opposed pairs in the background gutters; no duplicate files.",
};
if (!manifest.alpha || !manifest.metadataStripped) throw new Error("Delivered sword must retain alpha and omit metadata.");
await fs.writeFile(path.join(root, asset), delivered);
await fs.writeFile(path.join(outputEvidence, "sword-export.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest));
