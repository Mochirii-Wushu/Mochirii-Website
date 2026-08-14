import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const scanRoots = [
  "apps/web/app",
  "apps/web/components",
  "apps/web/lib",
  "apps/web/public/data",
  "apps/shopify-theme/layout",
  "apps/shopify-theme/locales",
  "apps/shopify-theme/sections",
  "apps/shopify-theme/snippets",
  "apps/shopify-theme/templates",
];

const textExtensions = new Set([".css", ".html", ".js", ".json", ".liquid", ".php", ".tsx", ".ts"]);
const formerShopBrand = ["vele", "sari"].join("");
const formerManufacturingPartner = ["self", "named"].join("");
const formerManufacturerBrand = ["ma", "dara"].join("");
const blocked = [
  { label: "legacy shop brand", pattern: new RegExp(`\\b${formerShopBrand}\\b|shop\\.${formerShopBrand}\\.trade|${formerShopBrand}\\.trade`, "i") },
  { label: "supplier or third-party cosmetics brand", pattern: new RegExp(`\\b(?:${formerManufacturingPartner}|${formerManufacturerBrand})\\b`, "i") },
  { label: "supplier-facing commerce phrase", pattern: /\bprivate label\b|\bdropshipping\b|\boffer your customers\b|\bprofessional skincare offerings\b/i },
];

const failures = [];

function isTextFile(filePath) {
  return textExtensions.has(path.extname(filePath).toLowerCase());
}

function walk(filePath) {
  if (!existsSync(filePath)) return [];
  const stats = statSync(filePath);
  if (stats.isDirectory()) {
    return readdirSync(filePath).flatMap((entry) => walk(path.join(filePath, entry)));
  }
  return [filePath];
}

for (const scanRoot of scanRoots) {
  const absolute = path.join(root, scanRoot);
  for (const file of walk(absolute).filter(isTextFile)) {
    const relativePath = path.relative(root, file).split(path.sep).join("/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      blocked.forEach((rule) => {
        if (rule.pattern.test(line)) {
          failures.push(`${relativePath}:${index + 1} ${rule.label}: ${line.trim()}`);
        }
      });
    });
  }
}

if (failures.length) {
  console.error("Shop brand guardrails failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Shop brand guardrails OK.");
