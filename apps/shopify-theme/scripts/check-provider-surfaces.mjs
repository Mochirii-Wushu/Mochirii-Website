import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  EXPECTED_THEME_BINDINGS,
  PROVIDER_SURFACE_PUBLIC_ROOT_KEYS,
  summarizeProviderSurfaceIssues,
  validateProviderSurfaceReadback,
  validateProviderSurfaceSourceBindings,
  validateProviderSurfacesContract,
} from "./lib/provider-surfaces-contract.mjs";
import { resolveContainedRegularFile, safePrivateOperationsPath } from "./lib/local-read-boundary.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const contractPath = path.join(appRoot, "content/provider-surfaces.v1.json");
const schemaPath = path.join(appRoot, "content/provider-surfaces.v1.schema.json");
const HELP = `Usage:
  npm run gate:provider-surfaces -- --private-readback <ignored-provider-readback.json> --candidate-theme-id <theme-id> --package-sha256 <sha256>

The readback must be a regular ignored, untracked JSON file under .artifacts/operations.
This command reads local evidence only. It does not access or mutate Shopify.\n`;
const readKnownText = (relativePath) => {
  const absolute = resolveContainedRegularFile(appRoot, relativePath);
  if (!absolute) throw new Error("unsafe-source-path");
  return readFileSync(absolute, "utf8");
};

function parseArguments(argv) {
  if (argv.includes("--help")) return { help: true };
  if (argv.length === 0) return { requireProviderReady: false };
  if (argv[0] !== "--require-provider-ready") return null;
  const result = { requireProviderReady: true };
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0) return null;
    if (flag === "--private-readback") result.privateReadback = path.resolve(value);
    else if (flag === "--candidate-theme-id") result.candidateThemeId = value;
    else if (flag === "--package-sha256") result.packageSha256 = value;
    else return null;
  }
  return result.privateReadback && result.candidateThemeId && result.packageSha256 ? result : null;
}

function output(surface, category, count = 1) {
  const stream = category === "pass" ? process.stdout : process.stderr;
  stream.write(`surface=${surface} category=${category} count=${count}\n`);
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function privateReadbackPathIsSafe(candidate) {
  try {
    const namedRelative = path.relative(repositoryRoot, path.resolve(candidate)).split(path.sep).join("/");
    if (!safePrivateOperationsPath(namedRelative)) return false;
    const real = realpathSync(candidate);
    const stats = lstatSync(candidate);
    if (!stats.isFile() || stats.isSymbolicLink() || !isInside(real, repositoryRoot)) return false;
    const relative = path.relative(repositoryRoot, real).split(path.sep).join("/");
    if (!safePrivateOperationsPath(relative)) return false;
    const ignored = spawnSync("git", ["check-ignore", "--quiet", "--no-index", "--", relative], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", relative], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    return ignored.status === 0 && tracked.status !== 0;
  } catch {
    return false;
  }
}

const args = parseArguments(process.argv.slice(2));
if (args?.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (!args) {
  output("provider-surfaces", "arguments");
  process.exit(2);
}

let contract;
let schema;
try {
  contract = JSON.parse(readFileSync(contractPath, "utf8"));
  schema = JSON.parse(readFileSync(schemaPath, "utf8"));
} catch {
  output("provider-surfaces", "public-json-parse");
  process.exit(1);
}

const issues = validateProviderSurfacesContract(contract).issues;
let packageBoundaryValid = false;
try {
  packageBoundaryValid = schema.$schema === "https://json-schema.org/draft/2020-12/schema" &&
    schema.$id === "https://mochirii.com/contracts/provider-surfaces.v1.schema.json" &&
    JSON.stringify(schema.required?.slice().sort()) === JSON.stringify([...PROVIDER_SURFACE_PUBLIC_ROOT_KEYS].sort()) &&
    !JSON.stringify(schema).includes('"readback"') &&
    readKnownText(".shopifyignore").split(/\r?\n/u).includes("content/**");
} catch {
  packageBoundaryValid = false;
}
if (!packageBoundaryValid) issues.push({ surface: "provider-surfaces", category: "schema-or-package-boundary" });
if (issues.length > 0) {
  for (const issue of summarizeProviderSurfaceIssues(issues)) output(issue.surface, issue.category, issue.count);
  process.exit(1);
}

const sourceFilePaths = new Set([
  ...EXPECTED_THEME_BINDINGS.map((item) => item.source_path),
  "sections/header.liquid",
  "snippets/primary-navigation-links.liquid",
  "snippets/seo-meta.liquid",
  "sections/footer.liquid",
  "sections/main-index.liquid",
  "sections/main-list-collections.liquid",
  "sections/main-page.liquid",
  "sections/main-collection.liquid",
  "sections/main-cart.liquid",
  "sections/main-404.liquid",
  "sections/main-search.liquid",
  "layout/theme.liquid",
  "config/settings_data.json",
  "config/settings_schema.json",
  "content/approved-customer-copy.json",
  "content/launch-pages.v1.json",
  "content/mandatory-name-exceptions.v1.json",
  "content/product-facts.v3.json",
]);
const storefrontEmblemPath = resolveContainedRegularFile(repositoryRoot, "apps/shopify-theme/assets/mochirii-emblem.webp");
const canonicalEmblemPath = resolveContainedRegularFile(repositoryRoot, "apps/web/public/assets/img/brand/emblem.webp");
const homepageHeroPath = resolveContainedRegularFile(appRoot, "assets/mochirii-page-password.webp");
let sourceIssues;
let mandatoryNameExceptions;
try {
  if (!storefrontEmblemPath || !canonicalEmblemPath || !homepageHeroPath) throw new Error("unsafe-asset-path");
  const sourceFiles = new Map([...sourceFilePaths].map((relativePath) => [relativePath, readKnownText(relativePath)]));
  mandatoryNameExceptions = JSON.parse(sourceFiles.get("content/mandatory-name-exceptions.v1.json"));
  sourceIssues = validateProviderSurfaceSourceBindings(contract, {
    files: sourceFiles,
    canonical_emblem_bytes: readFileSync(canonicalEmblemPath),
    storefront_emblem_bytes: readFileSync(storefrontEmblemPath),
    emblem_metadata: await sharp(storefrontEmblemPath).metadata(),
    homepage_hero_bytes: readFileSync(homepageHeroPath),
  }).issues;
} catch {
  sourceIssues = [{ surface: "provider-surfaces", category: "source-read" }];
}

issues.push(...sourceIssues);

if (issues.length > 0) {
  for (const issue of summarizeProviderSurfaceIssues(issues)) output(issue.surface, issue.category, issue.count);
  process.exit(1);
}

if (!args.requireProviderReady) {
  output("provider-surfaces", "pass");
  process.exit(0);
}

if (!privateReadbackPathIsSafe(args.privateReadback)) {
  output("provider-surfaces", "private-readback-boundary");
  process.exit(1);
}

let privateReadback;
try {
  privateReadback = JSON.parse(readFileSync(args.privateReadback, "utf8"));
} catch {
  output("provider-surfaces", "private-readback-parse");
  process.exit(1);
}
const readyIssues = validateProviderSurfaceReadback(contract, privateReadback, {
  expectedCandidateThemeId: args.candidateThemeId,
  expectedPackageSha256: args.packageSha256,
  mandatoryNameExceptions,
}).issues;
if (readyIssues.length > 0) {
  for (const issue of summarizeProviderSurfaceIssues(readyIssues)) output(issue.surface, issue.category, issue.count);
  process.exit(1);
}
output("provider-surfaces", "pass");
