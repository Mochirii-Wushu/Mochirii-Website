import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const buildRoot = path.resolve(".next", "static");
const homeHtmlPath = path.resolve(".next", "server", "app", "index.html");
const homeFontManifestPath = path.resolve(
  ".next",
  "server",
  "app",
  "page",
  "next-font-manifest.json",
);
const homeFontManifestKey = "[project]/apps/web/app/page";
const layoutPath = path.resolve("app", "layout.tsx");
const fontRoot = path.resolve("app", "fonts");
const fontCssLimit = 12 * 1024;
const expectedFonts = [
  {
    source: "zhi-mang-xing-latin.woff2",
    emittedPrefix: "zhi_mang_xing_latin",
    bytes: 13_068,
    family: "displayFont",
    weight: "400",
  },
  {
    source: "noto-serif-sc-latin.woff2",
    emittedPrefix: "noto_serif_sc_latin",
    bytes: 32_876,
    family: "bodyFont",
    weight: "400 600",
  },
];
const expectedFallbacks = [
  {
    family: "Zhi Mang Xing Fallback",
    source: "local(Arial)",
    ascent: "126.14%",
    descent: "17.2%",
    lineGap: "0%",
    sizeAdjust: "69.76%",
  },
  {
    family: "Noto Serif SC Fallback",
    source: "local(Times New Roman)",
    ascent: "95.04%",
    descent: "23.62%",
    lineGap: "0%",
    sizeAdjust: "121.11%",
  },
];
const failures = [];

function filesBelow(root, extension) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return filesBelow(target, extension);
    return entry.isFile() && target.endsWith(extension) ? [target] : [];
  });
}

function descriptorMap(block) {
  return new Map(
    block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"))
      .split(";")
      .map((descriptor) => descriptor.trim())
      .filter(Boolean)
      .map((descriptor) => {
        const separator = descriptor.indexOf(":");
        return [descriptor.slice(0, separator), descriptor.slice(separator + 1)];
      }),
  );
}

function normalizedFamily(value = "") {
  return value.replaceAll('"', "").replaceAll("'", "").trim();
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function homeFontPreloads() {
  if (existsSync(homeHtmlPath)) {
    const homeHtml = readFileSync(homeHtmlPath, "utf8");
    return (homeHtml.match(/<link\b[^>]*>/g) || [])
      .filter((tag) => tag.includes('rel="preload"') && tag.includes('as="font"'))
      .map((tag) => tag.match(/href="([^"]+)"/)?.[1])
      .filter(Boolean);
  }

  try {
    const manifest = JSON.parse(readFileSync(homeFontManifestPath, "utf8"));
    const routeFonts = manifest?.app?.[homeFontManifestKey];
    if (
      !Array.isArray(routeFonts) ||
      routeFonts.some((value) =>
        typeof value !== "string" ||
        !/^static\/media\/[a-z0-9_.-]+\.woff2$/u.test(value)
      )
    ) {
      failures.push("dynamic Home has no exact font preload manifest");
      return [];
    }
    return routeFonts;
  } catch {
    failures.push("Home font preload evidence is unavailable");
    return [];
  }
}

const layout = readFileSync(layoutPath, "utf8");
if (layout.includes("next/font/google")) failures.push("root layout must not use the Google-font loader");
if (!layout.includes('import localFont from "next/font/local"')) failures.push("root layout must use next/font/local");
for (const font of expectedFonts) {
  if (!layout.includes(`./fonts/${font.source}`)) failures.push(`root layout is missing ${font.source}`);
  const sourcePath = path.join(fontRoot, font.source);
  const source = readFileSync(sourcePath);
  if (source.subarray(0, 4).toString("ascii") !== "wOF2") failures.push(`${font.source} is not a WOFF2 file`);
  if (source.length !== font.bytes) failures.push(`${font.source} is ${source.length} bytes; expected ${font.bytes}`);
}

for (const license of ["OFL-Zhi-Mang-Xing.txt", "OFL-Noto-Serif-SC.txt"]) {
  const contents = readFileSync(path.join(fontRoot, license), "utf8");
  if (!contents.includes("SIL OPEN FONT LICENSE Version 1.1")) failures.push(`${license} does not contain the expected OFL 1.1 notice`);
}

let cssFiles;
try {
  cssFiles = filesBelow(buildRoot, ".css");
} catch (error) {
  console.error(`Font bundle guard could not read the production build: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const fontCssFiles = cssFiles
  .map((file) => ({ file, source: readFileSync(file, "utf8") }))
  .filter(({ source }) => source.includes("@font-face"));
const fontCss = fontCssFiles.map(({ source }) => source).join("\n");
const blocks = (fontCss.match(/@font-face\s*\{[^}]*\}/g) || []).map(descriptorMap);
const fontCssBrotli = fontCssFiles.reduce((total, { source }) => total + brotliCompressSync(source, {
  params: {
    [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
    [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
  },
}).length, 0);

if (fontCssBrotli > fontCssLimit) {
  failures.push(`font-bearing CSS is ${formatKiB(fontCssBrotli)}; limit is ${formatKiB(fontCssLimit)}`);
}
if (fontCss.includes("unicode-range:")) failures.push("font CSS must not emit Unicode-range slices");
if (blocks.length !== 4) failures.push(`font CSS contains ${blocks.length} font faces; expected 4`);

const emittedFonts = new Set();
for (const expected of expectedFonts) {
  const face = blocks.find((block) => normalizedFamily(block.get("font-family")) === expected.family);
  if (!face) {
    failures.push(`font CSS is missing ${expected.family}`);
    continue;
  }
  if (face.get("font-weight") !== expected.weight) failures.push(`${expected.family} weight is ${face.get("font-weight")}; expected ${expected.weight}`);
  if (face.get("font-style") !== "normal") failures.push(`${expected.family} must use normal style`);
  if (face.get("font-display") !== "swap") failures.push(`${expected.family} must use font-display: swap`);
  const emittedName = face.get("src")?.match(/url\(([^)]+)\)/)?.[1];
  if (!emittedName) {
    failures.push(`${expected.family} has no emitted font URL`);
    continue;
  }
  const emittedFile = path.basename(emittedName);
  emittedFonts.add(emittedFile);
  if (!emittedFile.startsWith(expected.emittedPrefix)) failures.push(`${expected.family} emitted unexpected file ${emittedFile}`);
  const emitted = readFileSync(path.join(buildRoot, "media", emittedFile));
  const source = readFileSync(path.join(fontRoot, expected.source));
  if (!emitted.equals(source)) failures.push(`${expected.family} emitted asset differs from ${expected.source}`);
}

for (const expected of expectedFallbacks) {
  const face = blocks.find((block) => normalizedFamily(block.get("font-family")) === expected.family);
  if (!face) {
    failures.push(`font CSS is missing ${expected.family}`);
    continue;
  }
  const checks = [
    ["src", expected.source],
    ["ascent-override", expected.ascent],
    ["descent-override", expected.descent],
    ["line-gap-override", expected.lineGap],
    ["size-adjust", expected.sizeAdjust],
  ];
  for (const [descriptor, value] of checks) {
    if (face.get(descriptor) !== value) failures.push(`${expected.family} ${descriptor} is ${face.get(descriptor)}; expected ${value}`);
  }
}

if (!/--font-zhi-mang:"displayFont",\s*Zhi Mang Xing Fallback/.test(fontCss)) failures.push("display font variable lost its preserved fallback");
if (!/--font-noto-serif-sc:"bodyFont",\s*Noto Serif SC Fallback/.test(fontCss)) failures.push("body font variable lost its preserved fallback");
if (emittedFonts.size !== 2) failures.push(`font bundle emits ${emittedFonts.size} font files; expected 2`);

const fontPreloads = homeFontPreloads();
if (fontPreloads.length !== 2) failures.push(`Home emits ${fontPreloads.length} font preloads; expected 2`);
for (const emitted of emittedFonts) {
  if (!fontPreloads.some((href) => href.endsWith(`/${emitted}`))) failures.push(`Home does not preload ${emitted}`);
}

if (failures.length) {
  console.error("Font bundle guard failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

const fontBytes = [...emittedFonts].reduce((total, file) => total + statSync(path.join(buildRoot, "media", file)).size, 0);
console.log("Font bundle guard passed.");
console.log(`- Font-bearing CSS: ${formatKiB(fontCssBrotli)} Brotli across ${fontCssFiles.length} chunk(s).`);
console.log(`- Font payload: ${formatKiB(fontBytes)} across ${emittedFonts.size} Latin WOFF2 file(s).`);
console.log(`- Home preloads exactly ${fontPreloads.length} font file(s).`);
console.log("- Existing CSS variables, weights, swap behavior, and metric-adjusted fallbacks are preserved.");
