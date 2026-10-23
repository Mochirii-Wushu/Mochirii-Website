import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const sourceDirectory = process.argv[2];
if (!sourceDirectory) throw new Error("Supply the reviewed, ignored master directory.");
const require = createRequire(path.resolve("apps/web/package.json"));
const sharp = require("sharp");
const destination = "apps/web/public/assets/home/hero/cherry-valley-dawn";
const evidence = ".artifacts/operations/homepage-preview-3";
await fs.mkdir(destination, { recursive: true });
const clean = await fs.readFile(path.join(sourceDirectory, "cherry-valley-dawn-clean-plate.png"));
const branch = await fs.readFile(path.join(sourceDirectory, "cherry-valley-branch-generated.png"));
const cleanMetadata = await sharp(clean).metadata();
const branchMetadata = await sharp(branch).metadata();
if (cleanMetadata.width !== 1536 || cleanMetadata.height !== 1024 || !branchMetadata.hasAlpha) {
  throw new Error("Reviewed artboard or genuine-alpha contract failed.");
}
// Register the generated isolated branch to the right-edge attachment on the
// 1536x1024 clean plate. The static poster uses this exact same registered layer.
const branchRegistered = await sharp({ create: { width: 1536, height: 1024, channels: 4, background: "#00000000" } })
  .composite([{ input: await sharp(branch).resize(1000, 667).png().toBuffer(), left: 536, top: 0 }]).png().toBuffer();
const poster = await sharp(clean).composite([{ input: branchRegistered }]).png().toBuffer();
const exports = [];
async function write(name, pipeline, maximumBytes, description) {
  const buffer = await pipeline.toBuffer();
  if (buffer.length > maximumBytes) throw new Error(name + " exceeds its reviewed delivery budget: " + buffer.length);
  await fs.writeFile(path.join(destination, name), buffer);
  const m = await sharp(buffer).metadata();
  exports.push({ id: "home.cherry-valley-dawn." + name.replace(/\.webp$/, ""), path: destination + "/" + name, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), format: m.format, width: m.width, height: m.height, hasAlpha: m.hasAlpha, description, maximumBytes });
}
await write("cherry-valley-panorama-1344.webp", sharp(poster).extract({ left: 0, top: 215, width: 1536, height: 560 }).resize(1344, 490).webp({ quality: 60, effort: 6 }), 80 * 1024, "Single responsive poster; desktop crop x0,y215,w1536,h560; mobile CSS crop x640,y215,w896,h560; quality 60, effort 6. Compression supported by the retained LCP image-delivery trace.");
for (const width of [1280]) {
  await write("clean-plate-" + width + ".webp", sharp(clean).resize(width).webp({ quality: 78, effort: 6 }), width === 720 ? 95 * 1024 : 210 * 1024, "Registered backdrop; no stationary branch beneath moving layer.");
  await write("branch-alpha-" + width + ".webp", sharp(branchRegistered).resize(width).webp({ quality: 86, alphaQuality: 100, effort: 6 }), width === 720 ? 55 * 1024 : 115 * 1024, "Genuine-alpha branch; anchor x1536,y100 on master artboard.");
}
const sceneryDirectory = "apps/web/public/assets/home/scenery";
await fs.mkdir(sceneryDirectory, { recursive: true });
await sharp("apps/web/public/assets/bg/wuxia-bg.webp").resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 65, effort: 6 }).toFile(sceneryDirectory + "/bamboo-valley-1280.webp");
await fs.writeFile(path.join(evidence, "hero-asset-exports.json"), JSON.stringify({ generatedAt: new Date().toISOString(), provenance: "Built-in image_gen; original promotional illustration, not a member screenshot. Masters retained ignored.", artboard: { width: 1536, height: 1024 }, desktopCrop: { left: 0, top: 215, width: 1536, height: 560 }, mobileCrop: { left: 640, top: 215, width: 896, height: 560 }, branchRegistration: { sourceWidth: branchMetadata.width, sourceHeight: branchMetadata.height, resizedWidth: 1000, resizedHeight: 667, left: 536, top: 0, anchor: [1536, 100] }, cleanMasterHash: createHash("sha256").update(clean).digest("hex"), branchMasterHash: createHash("sha256").update(branch).digest("hex"), exports }, null, 2));
console.log(JSON.stringify(exports.map(({ path, bytes, width, height, hasAlpha }) => ({ path, bytes, width, height, hasAlpha }))));
