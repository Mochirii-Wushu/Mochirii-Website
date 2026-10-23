import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(path.resolve("apps/web/package.json"));
const sharp = require("sharp");
// Authored SVG geometry is rasterized because the retained public-format and
// document contracts exclude SVG delivery. No script or external resource is used.
const sources = [
  [
    "cherry-valley-mist-near",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1536\" height=\"560\" viewBox=\"0 215 1536 560\"><defs><linearGradient id=\"fade\"><stop stop-color=\"#f6dce0\" stop-opacity=\"0\"/><stop offset=\".5\" stop-color=\"#f6dce0\" stop-opacity=\".16\"/><stop offset=\"1\" stop-color=\"#f6dce0\" stop-opacity=\"0\"/></linearGradient></defs><path fill=\"url(#fade)\" d=\"M180 670Q430 610 720 640T1040 655Q760 680 520 670T180 700Z\"/></svg>\n"
  ],
  [
    "cherry-valley-mist-far",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1536\" height=\"560\" viewBox=\"0 215 1536 560\"><defs><linearGradient id=\"fade\"><stop stop-color=\"#f6dce0\" stop-opacity=\"0\"/><stop offset=\".5\" stop-color=\"#f6dce0\" stop-opacity=\".16\"/><stop offset=\"1\" stop-color=\"#f6dce0\" stop-opacity=\"0\"/></linearGradient></defs><path fill=\"url(#fade)\" d=\"M240 685Q460 610 690 645T900 655Q650 690 460 675T240 705Z\"/></svg>\n"
  ],
  [
    "event-ink",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1000\" height=\"48\" viewBox=\"0 0 1000 48\"><g fill=\"none\" stroke=\"#a0c7b1\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M4 33C150 2 240 46 388 22S660 8 996 19\"/><path d=\"M170 39C340 17 518 47 800 26\"/></g></svg>\n"
  ],
  [
    "event-ink-grain",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1000\" height=\"48\" viewBox=\"0 0 1000 48\"><defs><pattern id=\"grain\" width=\"11\" height=\"5\" patternUnits=\"userSpaceOnUse\"><path d=\"M0 .5H8\" stroke=\"#bf9fab\"/><path d=\"M3 3.5H10\" stroke=\"#a0c7b1\"/></pattern></defs><path d=\"M0 16H1000V28H0Z\" fill=\"url(#grain)\"/></svg>\n"
  ],
  [
    "event-edge",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1000\" height=\"400\" viewBox=\"0 0 1000 400\" preserveAspectRatio=\"none\"><path d=\"M2 398V2H998V398Z\" fill=\"none\" stroke=\"#ffe5a4\" stroke-width=\"2\" vector-effect=\"non-scaling-stroke\"/></svg>\n"
  ],
  [
    "event-lantern-glow",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1600\" height=\"640\" viewBox=\"0 0 1600 640\"><defs><radialGradient id=\"glow\"><stop stop-color=\"#ffd77b\" stop-opacity=\".5\"/><stop offset=\"1\" stop-color=\"#ffd77b\" stop-opacity=\"0\"/></radialGradient></defs><g fill=\"url(#glow)\"><circle cx=\"992\" cy=\"88\" r=\"30\"/><circle cx=\"1234\" cy=\"178\" r=\"22\"/><circle cx=\"1458\" cy=\"127\" r=\"28\"/></g></svg>\n"
  ],
  [
    "event-lantern-flame",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1600\" height=\"640\" viewBox=\"0 0 1600 640\"><path d=\"M992 88Q985 82 993 74Q999 82 992 88Z\" fill=\"#ffe9ad\"/></svg>\n"
  ]
];
const destination = "apps/web/public/assets/home/decor";
await fs.mkdir(destination, { recursive: true });
const exports = [];
for (const [name, source] of sources) {
  if (/<(?:script|foreignObject|image|use)\b|\b(?:href|on[a-z]+)\s*=/i.test(source)) throw new Error("Active SVG rejected");
  const buffer = await sharp(Buffer.from(source)).webp({ lossless: true, effort: 6 }).toBuffer();
  if (buffer.length > 32 * 1024) throw new Error("Decorative mask exceeds its predeclared 32 KiB ceiling");
  const metadata = await sharp(buffer).metadata();
  if (!metadata.hasAlpha || metadata.exif || metadata.icc || metadata.xmp) throw new Error("Mask alpha or metadata rejected");
  const filename = destination + "/" + name + ".webp";
  await fs.writeFile(filename, buffer);
  exports.push({ path: filename, bytes: buffer.length, width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha, sha256: createHash("sha256").update(buffer).digest("hex"), sourceSha256: createHash("sha256").update(source).digest("hex"), provenance: "Authored SVG geometry in this exporter; lossless raster alpha mask, no external resource.", recipe: { format: "webp", lossless: true, effort: 6, maximumBytes: 32768, crop: "none" } });
}
await fs.writeFile(".artifacts/operations/homepage-preview-3/decoration-exports.json", JSON.stringify(exports, null, 2));
console.log(JSON.stringify(exports.map(({ path, bytes, width, height }) => ({ path, bytes, width, height }))));
