import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const historyBaseline = JSON.parse(readFileSync(
  path.join(repoRoot, "scripts/repository-boundary-history-baseline.json"),
  "utf8",
));
const mib = 1024 * 1024;
const defaultFileBudget = 10 * mib;
const hardFileBudget = 50 * mib;
const repositoryBudget = 900 * mib;
const reviewedFileBudgets = new Map([
  ["apps/web/server-assets/spinner-fonts/NotoColorEmoji-Regular.ttf", 26 * mib],
  ["apps/web/server-assets/spinner-fonts/NotoSerifSC-Variable.ttf", 26 * mib],
  ["services/social/storage/app/cities.json", 15 * mib],
]);
const formerTokens = [
  { label: "former company brand", value: ["vele", "sari"].join("") },
  { label: "former repository owner", value: ["anthy", "phera"].join("") },
  { label: "supplier identity", value: ["self", "named"].join("") },
  { label: "manufacturer identity", value: ["ma", "dara"].join("") },
];
const infrastructureNames = [
  "Vercel",
  "Supabase",
  "Shopify",
  "DigitalOcean",
  "Cloudflare",
  "Fly.io",
];
const generatedArchivePattern = /\.(?:7z|bak|bundle|dump|gz|rar|tar|tgz|zip)$/i;
const databaseArtifactPattern = /\.(?:sql|sqlite|sqlite3)$/i;
const reviewedDatabaseTestPaths = new Set([
  "supabase/tests/member_social_links_test.sql",
  "supabase/tests/fixtures/reviewed_sya_spinner_classification.sql",
  "supabase/operations/validate_gallery_submission_thumbnails.sql",
  "supabase/operations/validate_gallery_submission_categories.sql",
  "supabase/operations/reconcile_gallery_public_feed_v2.sql",
  "supabase/operations/validate_reviewed_sya_spinner_classification.sql",
  "supabase/tests/gallery_public_feed_v2_test.sql",
  "supabase/tests/gallery_submission_thumbnails_test.sql",
  "supabase/tests/private_live_spinner_test.sql",
  "supabase/tests/spinner_media_jobs_test.sql",
  "supabase/tests/official_raffle_publication_test.sql",
]);
const credentialPathPattern = /(^|\/)(?:Mochi Creds|private-evidence|Repository Backups)(\/|$)/i;
const privateKeyPathPattern = /\.(?:key|p12|pfx|pem)$/i;
const realEnvPattern = /(^|\/)\.env(?:\.[^/]+)?$/i;
const allowedEnvFiles = new Set([
  ".env.example",
  "apps/web/.env.example",
  "supabase/functions/.env.example",
  "services/social/.env.example",
  "services/social/.env.docker.example",
  "services/social/.env.testing",
]);
const textExtensions = new Set([
  ".css", ".html", ".js", ".json", ".jsx", ".liquid", ".md", ".mjs",
  ".php", ".scss", ".svg", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);
const highConfidenceSecretPatterns = [
  { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { label: "GitHub token", pattern: new RegExp(["gh", "p_"].join("") + "[A-Za-z0-9]{30,}") },
  { label: "GitHub fine-grained token", pattern: new RegExp(["github", "_pat_"].join("") + "[A-Za-z0-9_]{30,}") },
  { label: "Stripe live secret", pattern: new RegExp(["sk", "_live_"].join("") + "[A-Za-z0-9]{20,}") },
];
const renderedRoots = [
  "apps/web/app/",
  "apps/web/components/",
  "apps/shopify-theme/layout/",
  "apps/shopify-theme/locales/",
  "apps/shopify-theme/sections/",
  "apps/shopify-theme/snippets/",
  "apps/shopify-theme/templates/",
  "services/social/resources/lang/",
  "services/social/resources/views/",
];
const formerWebsiteRepository = ["Mochirii-Wushu", "Mochirii"].join("/");
const formerWebsiteRepositoryPattern = new RegExp(
  `${formerWebsiteRepository.replaceAll("/", "\\/")}(?![-A-Za-z0-9_])`,
  "i",
);
const formerWebsiteRepositoryAllowedRoots = [
  "docs/operations/evidence/",
  "docs/operations/history/",
  "reports/",
];
const formerWebsiteRepositoryAllowedFiles = new Set([
  "apps/shopify-theme/MIGRATION-MANIFEST.json",
  "apps/shopify-theme/content/approved-customer-copy.json",
]);
const failures = [];

function git(args, options = {}) {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * mib,
    ...options,
  });
}

function normalized(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function listTrackedAndPendingFiles() {
  return [...new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean))]
    .sort();
}

function isTextCandidate(relativePath, size) {
  if (size > 5 * mib) return false;
  return textExtensions.has(path.extname(relativePath).toLowerCase()) ||
    ["AGENTS.md", "CODEOWNERS", "CNAME", "Dockerfile"].includes(path.basename(relativePath));
}

function scanReachableHistory() {
  const messages = normalized(git(["log", "HEAD", "--format=%H%x00%B%x00"]));
  const paths = normalized(git(["log", "HEAD", "--name-only", "--format="]));

  for (const rule of formerTokens) {
    if (messages.includes(rule.value)) failures.push(`reachable commit message contains ${rule.label}`);
    if (paths.includes(rule.value)) failures.push(`reachable historical path contains ${rule.label}`);

    const matchingCommits = [...new Set(git([
      "log", "HEAD", "-i", `-G${rule.value}`, "--format=%H", "--",
    ]).trim().split(/\r?\n/).filter(Boolean))].sort();
    const expectedCommits = [...(historyBaseline[rule.label] ?? [])].sort();
    if (JSON.stringify(matchingCommits) !== JSON.stringify(expectedCommits)) {
      failures.push(`reachable historical content baseline changed for ${rule.label}`);
    }
  }
}

function renderedTextContainsProvider(relativePath, content) {
  if (!renderedRoots.some((root) => relativePath.startsWith(root))) return [];

  const findings = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const textNode = line.replace(/\{[{%][\s\S]*?[}%]\}/g, " ");
    const looksVisible = />[^<]+</.test(textNode) ||
      /\b(?:alt|aria-label|description|eyebrow|heading|label|message|placeholder|subtitle|title)\s*[=:]/i.test(line) ||
      (relativePath.includes("/locales/") && /:\s*"[^"]+"/.test(line)) ||
      (relativePath.includes("/resources/lang/") && /=>\s*['"][^'"]+['"]/.test(line));
    if (!looksVisible) continue;

    for (const provider of infrastructureNames) {
      if (new RegExp(`\\b${provider.replace(".", "\\.")}\\b`, "i").test(line)) {
        findings.push(`${relativePath}:${index + 1}: rendered text contains infrastructure branding`);
      }
    }
  }
  return findings;
}

function normalizedRepositoryReferences(content) {
  return content
    .replaceAll("\\/", "/")
    .replaceAll(/%252f/gi, "/")
    .replaceAll(/%2f/gi, "/");
}

if (!existsSync(path.join(repoRoot, ".git"))) {
  console.error("Repository boundary check failed: Git repository not found.");
  process.exit(1);
}

scanReachableHistory();

const files = listTrackedAndPendingFiles();
let totalBytes = 0;

for (const relativePath of files) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  const absolutePath = path.join(repoRoot, normalizedPath);
  if (!existsSync(absolutePath)) continue;

  const stats = statSync(absolutePath);
  if (!stats.isFile()) continue;
  totalBytes += stats.size;

  const budget = reviewedFileBudgets.get(normalizedPath) ?? defaultFileBudget;
  if (stats.size > hardFileBudget) {
    failures.push(`${normalizedPath}: exceeds the 50 MiB hard file limit`);
  } else if (stats.size > budget) {
    failures.push(`${normalizedPath}: exceeds its reviewed file-size budget`);
  }

  if (credentialPathPattern.test(normalizedPath)) {
    failures.push(`${normalizedPath}: credential or private-evidence path must not be tracked`);
  }
  if (privateKeyPathPattern.test(normalizedPath)) {
    failures.push(`${normalizedPath}: private-key-shaped file must not be tracked`);
  }
  if (generatedArchivePattern.test(normalizedPath)) {
    failures.push(`${normalizedPath}: generated archives and backup artifacts must not be tracked`);
  }
  if (
    databaseArtifactPattern.test(normalizedPath) &&
    !normalizedPath.startsWith("supabase/migrations/") &&
    !reviewedDatabaseTestPaths.has(normalizedPath)
  ) {
    failures.push(`${normalizedPath}: database artifacts are allowed only as reviewed Supabase migrations`);
  }
  if (realEnvPattern.test(normalizedPath) && !allowedEnvFiles.has(normalizedPath)) {
    failures.push(`${normalizedPath}: real environment files must not be tracked`);
  }

  if (!isTextCandidate(normalizedPath, stats.size)) continue;
  const content = readFileSync(absolutePath, "utf8");

  const mayPreserveFormerWebsiteRepository = formerWebsiteRepositoryAllowedRoots
    .some((root) => normalizedPath.startsWith(root)) ||
    formerWebsiteRepositoryAllowedFiles.has(normalizedPath);
  if (
    !mayPreserveFormerWebsiteRepository &&
    formerWebsiteRepositoryPattern.test(normalizedRepositoryReferences(content))
  ) {
    failures.push(`${normalizedPath}: contains the former Website repository slug`);
  }

  for (const rule of formerTokens) {
    if (normalized(normalizedPath).includes(rule.value) || normalized(content).includes(rule.value)) {
      failures.push(`${normalizedPath}: contains ${rule.label}`);
    }
  }
  for (const rule of highConfidenceSecretPatterns) {
    const isApprovedCanary = normalizedPath === "scripts/check-apple-auth-readiness.mjs" &&
      rule.label === "private key material";
    if (!isApprovedCanary && rule.pattern.test(content)) failures.push(`${normalizedPath}: contains ${rule.label}`);
  }
  failures.push(...renderedTextContainsProvider(normalizedPath, content));
}

if (totalBytes > repositoryBudget) {
  failures.push("tracked working tree exceeds the reviewed 900 MiB repository budget");
}

const objectStats = Object.fromEntries(git(["count-objects", "-v"])
  .trim()
  .split(/\r?\n/)
  .map((line) => line.split(": ")));
const packedBytes = (Number(objectStats["size-pack"] ?? 0) + Number(objectStats.size ?? 0)) * 1024;
if (packedBytes > repositoryBudget) {
  failures.push("reachable Git object storage exceeds the reviewed 900 MiB budget");
}

if (failures.length) {
  console.error("Repository boundary check failed.");
  [...new Set(failures)].forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Repository boundary check OK (${files.length} files, ${(totalBytes / mib).toFixed(1)} MiB tracked/pending).`);
