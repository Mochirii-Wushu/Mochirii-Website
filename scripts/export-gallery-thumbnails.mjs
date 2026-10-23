import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("apps/web/package.json"));
const sharp = require("sharp");
const galleryPath = "apps/web/public/data/gallery.json";
const homePath = "apps/web/public/data/home.json";
const gallerySource = await fs.readFile(galleryPath, "utf8");
const homeSource = await fs.readFile(homePath, "utf8");
const gallery = JSON.parse(gallerySource);
const exports = [];
const replacements = new Map();
for (const item of gallery.albums.flatMap(album => album.items)) {
  const source = String(item.thumb).replace(/^\.\//, "").replace(/-720\.webp$/, ".webp");
  if (!/^assets\/img\/gallery\/thumbs\/shot-\d+\.webp$/.test(source)) throw new Error("Expected the reviewed original thumbnail inventory");
  const destination = source.replace(/\.webp$/, "-720.webp");
  const original = await fs.readFile("apps/web/public/" + source);
  let buffer;
  let quality = 76;
  for (const candidate of [76, 72, 68, 64, 60]) {
    quality = candidate;
    buffer = await sharp(original).resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 6 }).toBuffer();
    if (buffer.length <= 80 * 1024) break;
  }
  if (!buffer || buffer.length > 80 * 1024) throw new Error("Thumbnail exceeds its predeclared 80 KiB limit");
  const metadata = await sharp(buffer).metadata();
  if (metadata.exif || metadata.icc || metadata.xmp || metadata.width > 720 || metadata.height > 720) throw new Error("Derivative metadata or dimensions rejected");
  await fs.writeFile("apps/web/public/" + destination, buffer);
  replacements.set(source, destination);
  exports.push({ id: item.id, source: "/" + source, canonical: "/" + destination,
    compatibility: "Original URL and bytes retained; full-resolution viewer source unchanged.",
    sourceSha256: createHash("sha256").update(original).digest("hex"), sha256: createHash("sha256").update(buffer).digest("hex"),
    originalBytes: original.length, bytes: buffer.length, width: metadata.width, height: metadata.height,
    provenance: "Derivative of the reviewed static guild screenshot thumbnail; no generative edit.",
    recipe: { format: "webp", maxEdge: 720, quality, effort: 6, crop: "none", metadata: "stripped" } });
}
function update(source) {
  for (const [oldPath, newPath] of replacements) source = source.replaceAll(oldPath, newPath);
  return source.replaceAll("\r\n", "\n");
}
await fs.writeFile(galleryPath, update(gallerySource));
await fs.writeFile(homePath, update(homeSource));
const worst24 = exports.map(item => item.bytes).sort((a, b) => b - a).slice(0, 24).reduce((sum, bytes) => sum + bytes, 0);
if (worst24 >= 2 * 1024 * 1024) throw new Error("Worst 24-thumbnail transfer exceeds the existing guard");
await fs.writeFile(".artifacts/operations/homepage-preview-3/gallery-derivatives.json", JSON.stringify({
  generatedAt: new Date().toISOString(), exports, worst24Bytes: worst24,
  originalTotalBytes: exports.reduce((sum, item) => sum + item.originalBytes, 0),
  totalBytes: exports.reduce((sum, item) => sum + item.bytes, 0),
}, null, 2));
console.log(JSON.stringify({ count: exports.length, worst24Bytes: worst24, bytes: exports.reduce((sum, item) => sum + item.bytes, 0) }));
