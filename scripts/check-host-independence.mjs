import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireComplete = process.argv.includes("--require-complete");
const manifestPath = resolve(root, "docs/integrations/hosted-runtime.json");
const publicUrlsPath = resolve(root, "apps/web/config/public-urls.json");
const failures = [];

const requiredRuntimeIds = [
  "website",
  "storefront",
  "backend",
  "social",
  "discord-interactions",
  "release-automation",
];
const requiredReadbackIds = [
  "supabase-cron",
  "reaper-gateway-host",
  "social-backup-recovery",
];
const readbackKinds = new Map([
  ["supabase-cron", "managed_schedule"],
  ["reaper-gateway-host", "persistent_worker"],
  ["social-backup-recovery", "backup_recovery"],
]);
const requiredPendingEvidence = new Map([
  [
    "reaper-gateway-host",
    [
      "provider_class",
      "supervisor",
      "boot_policy",
      "source_revision_present",
      "health_signal_present",
      "observed_healthy",
    ],
  ],
  [
    "social-backup-recovery",
    [
      "provider_class",
      "supervisor",
      "timer_enabled",
      "latest_encrypted_recovery_point_present",
      "validate_only_restore_passed",
      "observed_healthy",
    ],
  ],
]);
const runtimePrefixes = [
  ".github/workflows/",
  "apps/shopify-theme/assets/",
  "apps/shopify-theme/config/",
  "apps/shopify-theme/layout/",
  "apps/shopify-theme/sections/",
  "apps/shopify-theme/snippets/",
  "apps/shopify-theme/templates/",
  "apps/web/app/",
  "apps/web/components/",
  "apps/web/config/",
  "apps/web/lib/",
  "apps/web/public/data/",
  "services/social/caddy/",
  "services/social/docker/",
  "services/social/systemd/",
  "supabase/functions/",
  "supabase/migrations/",
];
const runtimeExactFiles = new Set([
  "apps/web/next.config.ts",
  "apps/web/public/manifest.json",
  "apps/web/vercel.json",
  "services/social/.dockerignore",
  "services/social/Dockerfile",
  "services/social/docker-compose.production.yml",
]);
const runtimeTextExtensions = new Set([
  ".cjs",
  ".conf",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".liquid",
  ".mjs",
  ".service",
  ".sh",
  ".sql",
  ".timer",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const reviewedLoopbacks = new Map([
  [
    ".github/workflows/manual-lighthouse.yml",
    [
      { value: "http://127.0.0.1:8765", count: 1 },
      { value: "http://127.0.0.1:8766", count: 1 },
      { value: "--hostname 127.0.0.1", count: 1 },
      { value: "EXCLUDE 127.0.0.1", count: 1 },
    ],
  ],
  [
    "apps/web/lib/gallery/approved-feed_test.ts",
    [{ value: "http://127.0.0.1:8765", count: 1 }],
  ],
  [
    "apps/web/lib/gallery/moderation-preview-server-core.ts",
    [
      { value: '"localhost"', count: 1 },
      { value: '"127.0.0.1"', count: 1 },
    ],
  ],
  [
    "apps/web/lib/gallery/moderation-preview-server_test.ts",
    [
      { value: "localhost", count: 2 },
      { value: "127.0.0.1", count: 2 },
    ],
  ],
  [
    "apps/web/lib/gallery/moderation-preview-route.ts",
    [
      { value: '"localhost"', count: 1 },
      { value: '"127.0.0.1"', count: 1 },
    ],
  ],
  [
    "apps/web/lib/gallery/moderation-preview-route_test.ts",
    [
      { value: "localhost", count: 4 },
      { value: "127.0.0.1", count: 2 },
    ],
  ],
  [
    "supabase/functions/_shared/gallery-preview-attestation.ts",
    [
      { value: '"localhost"', count: 1 },
      { value: '"127.0.0.1"', count: 1 },
    ],
  ],
  [
    "supabase/functions/_shared/gallery-preview-attestation_test.ts",
    [
      { value: "localhost", count: 1 },
      { value: "127.0.0.1", count: 5 },
    ],
  ],
  [
    "supabase/functions/_shared/social-publication-copy.ts",
    [{ value: "localhost", count: 1 }],
  ],
  [
    "supabase/functions/_shared/social-publication-copy_test.ts",
    [
      { value: "localhost", count: 1 },
      { value: "127.0.0.1", count: 1 },
    ],
  ],
  [
    "apps/web/lib/member-social-links/profile-links-core.ts",
    [{ value: "localhost", count: 2 }],
  ],
  [
    "services/social/caddy/Caddyfile",
    [{ value: "reverse_proxy 127.0.0.1:8080", count: 1 }],
  ],
  [
    "services/social/docker-compose.production.yml",
    [
      { value: "mariadb-admin ping -h 127.0.0.1", count: 1 },
      { value: "127.0.0.1:8080:8080", count: 1 },
      { value: "http://127.0.0.1:8080/api/service/readiness-check", count: 1 },
    ],
  ],
  [
    "services/social/scripts/check-production-runtime.mjs",
    [
      { value: "127.0.0.1:8080:8080", count: 1 },
      { value: "http://127.0.0.1:8080/api/service/readiness-check", count: 2 },
      { value: "reverse_proxy 127.0.0.1:8080", count: 2 },
      { value: "['127.0.0.1', '::1']", count: 1 },
    ],
  ],
  [
    "services/social/scripts/install-production-caddy.sh",
    [
      { value: "http://127.0.0.1:8080/", count: 2 },
      { value: "http://127.0.0.1:8080/api/service/readiness-check", count: 1 },
      { value: "social.mochirii.com:443:127.0.0.1", count: 4 },
    ],
  ],
  [
    "services/social/scripts/production-runtime-lib.sh",
    [
      { value: "http://127.0.0.1:8080/", count: 2 },
      { value: "http://127.0.0.1:8080/api/service/readiness-check", count: 1 },
      { value: "http://127.0.0.1:2019/config/", count: 1 },
      { value: "reverse_proxy 127.0.0.1:8080", count: 1 },
      { value: '"127.0.0.1:8080"', count: 1 },
    ],
  ],
  [
    "supabase/functions/_shared/cors.ts",
    [
      { value: "http://localhost:3000", count: 1 },
      { value: "http://127.0.0.1:3000", count: 1 },
    ],
  ],
  [
    "apps/web/lib/spinner/session-policy.ts",
    [
      { value: '"localhost"', count: 2 },
      { value: '"127.0.0.1"', count: 2 },
    ],
  ],
]);

if (!existsSync(manifestPath)) failures.push("hosted runtime manifest is missing");
if (!existsSync(publicUrlsPath)) failures.push("public URL contract is missing");

const manifest = readJson(manifestPath);
const publicUrls = readJson(publicUrlsPath);

assertExactKeys(manifest, ["schema_version", "updated_date", "scope", "workstation", "acceptance", "runtimes", "operational_readbacks"], "hosted runtime manifest");
if (manifest?.schema_version !== 2) failures.push("hosted runtime manifest schema_version must be 2");
assertExactKeys(manifest?.workstation, ["role", "core_customer_surfaces_production_dependency"], "workstation contract");
if (manifest?.workstation?.role !== "development_and_administration_only") {
  failures.push("workstation role must remain development_and_administration_only");
}
if (manifest?.workstation?.core_customer_surfaces_production_dependency !== false) {
  failures.push("core customer surfaces must not depend on the workstation");
}
if (Object.hasOwn(manifest?.workstation || {}, "production_dependency")) {
  failures.push("unscoped workstation production_dependency claims are forbidden");
}
if (manifest?.acceptance?.core_customer_surfaces_independent !== true) {
  failures.push("core customer surfaces must remain independently hosted");
}
assertExactKeys(manifest?.acceptance, ["core_customer_surfaces_independent", "complete_auxiliary_continuity_certified"], "host-independence acceptance");

const runtimes = Array.isArray(manifest?.runtimes) ? manifest.runtimes : [];
assertExactIds(runtimes, requiredRuntimeIds, "hosted runtime");

const expectedOrigins = new Map([
  ["website", [publicUrls?.siteOrigin]],
  ["storefront", ["https://shop.mochirii.com"]],
  ["backend", [`https://${publicUrls?.supabaseProjectRef}.supabase.co`]],
  ["social", [publicUrls?.socialHost]],
  ["discord-interactions", ["https://discord.com", `https://${publicUrls?.supabaseProjectRef}.supabase.co`]],
  ["release-automation", ["https://github.com/Mochirii-Wushu/Mochirii-Website"]],
]);

for (const runtime of runtimes) {
  const id = runtime?.id || "unknown runtime";
  assertExactKeys(runtime, ["id", "provider", "source", "public_origins", "continuity", "workstation_requirement"], `${id} runtime`);
  if (runtime?.workstation_requirement !== "none") failures.push(`${id} requires the workstation`);
  for (const field of ["provider", "source", "continuity"]) {
    if (typeof runtime?.[field] !== "string" || !runtime[field].trim()) {
      failures.push(`${id} must define ${field}`);
    }
  }
  const origins = Array.isArray(runtime?.public_origins) ? runtime.public_origins : [];
  if (new Set(origins).size !== origins.length) failures.push(`${id} contains duplicate public origins`);
  for (const origin of origins) assertHostedHttps(origin, `${id} origin`);
  const expected = expectedOrigins.get(runtime?.id) || [];
  if (!sameStrings(origins, expected)) failures.push(`${id} origins do not match the canonical contract`);
}

const readbacks = Array.isArray(manifest?.operational_readbacks)
  ? manifest.operational_readbacks
  : [];
assertExactIds(readbacks, requiredReadbackIds, "operational readback");
for (const readback of readbacks) validateReadback(readback);

const pendingReadbacks = readbacks
  .filter((entry) => entry?.status !== "verified")
  .map((entry) => entry?.id || "unknown")
  .sort();
if (manifest?.acceptance?.complete_auxiliary_continuity_certified !== (pendingReadbacks.length === 0)) {
  failures.push("complete auxiliary continuity flag does not match verified readback evidence");
}
if (requireComplete && pendingReadbacks.length) {
  failures.push(`hosted readback(s) remain pending: ${pendingReadbacks.join(", ")}`);
}

for (const relativePath of listFiles()) {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  if (!isRuntimeSurface(normalizedPath)) continue;
  const absolutePath = resolve(root, normalizedPath);
  if (!existsSync(absolutePath)) continue;
  const content = readFileSync(absolutePath, "utf8");

  const workflowRunnerContent = content.replaceAll("--deny-self-hosted-runners", "");
  if (normalizedPath.startsWith(".github/workflows/") && /\bself-hosted\b/i.test(workflowRunnerContent)) {
    failures.push(`${normalizedPath}: self-hosted runner is forbidden`);
  }
  if (/(?:\b[A-Za-z]:\\(?:Users|Github Repo's)\\|\/mnt\/[a-z]\/(?:Users|Github Repo's)\/)/i.test(content)) {
    failures.push(`${normalizedPath}: production surface contains a workstation path`);
  }
  if (/\bMochi Creds\b/i.test(content)) failures.push(`${normalizedPath}: production surface names the credential boundary`);
  if (/\bfile:\/\//i.test(content)) failures.push(`${normalizedPath}: production surface contains a file URL`);
  assertReviewedLoopbacks(normalizedPath, content);
}

if (failures.length) {
  console.error("Host independence check failed.");
  [...new Set(failures)].sort().forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Host independence check OK.");
console.log(`- Hosted runtimes: ${runtimes.length}`);
console.log(`- Pending operational readbacks: ${pendingReadbacks.length}`);
if (pendingReadbacks.length) console.log(`- Pending: ${pendingReadbacks.join(", ")}`);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    failures.push(`${relative(root, path)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function assertExactIds(entries, expectedIds, label) {
  const ids = entries.map((entry) => entry?.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) failures.push(`${label} IDs must be unique`);
  if (!sameStrings(ids, expectedIds)) failures.push(`${label} IDs must match the required contract exactly`);
}

function validateReadback(readback) {
  const id = readback?.id || "unknown readback";
  if (!["pending", "verified"].includes(readback?.status)) {
    failures.push(`${id} status must be pending or verified`);
    return;
  }
  if (typeof readback?.summary !== "string" || !readback.summary.trim()) {
    failures.push(`${id} must include a non-sensitive summary`);
  }
  if (readback?.kind !== readbackKinds.get(id)) failures.push(`${id} kind does not match the contract`);

  if (readback.status === "pending") {
    assertExactKeys(readback, ["id", "kind", "status", "required_evidence", "summary"], `${id} pending readback`);
    if (readback.verified_date || readback.evidence || readback.evidence_ref) {
      failures.push(`${id} pending readback must not include verified evidence`);
    }
    const required = requiredPendingEvidence.get(id);
    if (required && !sameStrings(readback.required_evidence || [], required)) {
      failures.push(`${id} pending evidence requirements do not match the contract`);
    }
    return;
  }

  assertExactKeys(readback, ["id", "kind", "status", "verified_date", "evidence_ref", "evidence", "summary"], `${id} verified readback`);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(readback?.verified_date || "")) {
    failures.push(`${id} verified readback requires an ISO verified_date`);
  }
  if (typeof readback?.evidence_ref !== "string" || !readback.evidence_ref.startsWith("docs/operations/")) {
    failures.push(`${id} verified readback requires a docs/operations evidence_ref`);
  } else if (!existsSync(resolve(root, readback.evidence_ref))) {
    failures.push(`${id} evidence_ref does not exist`);
  }
  if (!readback?.evidence || typeof readback.evidence !== "object" || Array.isArray(readback.evidence)) {
    failures.push(`${id} verified readback requires structured evidence`);
    return;
  }

  if (id === "supabase-cron") {
    const expected = {
      provider_class: "managed_cloud",
      supervisor: "supabase_cron",
      enabled_required_schedules: 2,
      latest_required_executions_succeeded: true,
      vote_reminder_schedule_active: false,
    };
    assertExactKeys(readback.evidence, Object.keys(expected), `${id} evidence`);
    assertEvidence(readback, expected);
  } else if (id === "reaper-gateway-host") {
    assertExactKeys(readback.evidence, requiredPendingEvidence.get(id), `${id} evidence`);
    assertAllowed(readback.evidence.provider_class, ["managed_cloud", "hosted_droplet", "managed_container"], `${id} provider_class`);
    assertAllowed(readback.evidence.supervisor, ["provider_managed", "systemd", "container_supervisor"], `${id} supervisor`);
    assertAllowed(readback.evidence.boot_policy, ["provider_managed", "enabled", "always_restart"], `${id} boot_policy`);
    for (const field of ["source_revision_present", "health_signal_present", "observed_healthy"]) {
      if (readback.evidence[field] !== true) failures.push(`${id} ${field} must be true`);
    }
  } else if (id === "social-backup-recovery") {
    assertExactKeys(readback.evidence, requiredPendingEvidence.get(id), `${id} evidence`);
    assertAllowed(readback.evidence.provider_class, ["hosted_droplet"], `${id} provider_class`);
    assertAllowed(readback.evidence.supervisor, ["systemd"], `${id} supervisor`);
    for (const field of ["timer_enabled", "latest_encrypted_recovery_point_present", "validate_only_restore_passed", "observed_healthy"]) {
      if (readback.evidence[field] !== true) failures.push(`${id} ${field} must be true`);
    }
  }
}

function assertEvidence(readback, expected) {
  for (const [field, value] of Object.entries(expected)) {
    if (readback.evidence[field] !== value) failures.push(`${readback.id} ${field} must equal ${JSON.stringify(value)}`);
  }
}

function assertAllowed(value, allowed, label) {
  if (!allowed.includes(value)) failures.push(`${label} must be one of ${allowed.join(", ")}`);
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} must be an object`);
    return;
  }
  if (!sameStrings(Object.keys(value), expectedKeys)) failures.push(`${label} fields do not match the schema`);
}

function assertHostedHttps(value, label) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || isPrivateHostname(hostname)) {
      failures.push(`${label} must be a public credential-free HTTPS URL without query or fragment`);
    }
  } catch {
    failures.push(`${label} is not a valid URL`);
  }
}

function isPrivateHostname(hostname) {
  if (["localhost", "host.docker.internal", "::", "::1"].includes(hostname)) return true;
  if (hostname.endsWith(".localhost") || hostname.endsWith(".local")) return true;
  if (/^(?:fc|fd|fe8|fe9|fea|feb)/i.test(hostname)) return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 198 && [18, 19].includes(octets[1]));
}

function assertReviewedLoopbacks(path, content) {
  let remaining = content;
  for (const allowance of reviewedLoopbacks.get(path) || []) {
    const observed = countOccurrences(content, allowance.value);
    if (observed !== allowance.count) {
      failures.push(`${path}: reviewed loopback ${JSON.stringify(allowance.value)} expected ${allowance.count}, found ${observed}`);
    }
    remaining = remaining.split(allowance.value).join("");
  }
  if (/\b(?:localhost|127\.0\.0\.1|host\.docker\.internal)\b|\[?::1\]?/i.test(remaining)) {
    failures.push(`${path}: production surface contains an unreviewed loopback destination`);
  }

  const privateIpv4 = [...remaining.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)]
    .map(([address]) => address)
    .filter((address) => address !== "0.0.0.0" && isPrivateHostname(address));
  if (privateIpv4.length) {
    failures.push(`${path}: production surface contains a private-network IPv4 destination`);
  }
  if (/(?:^|[^0-9a-f])(?:f[cd][0-9a-f]{0,2}|fe[89ab][0-9a-f]?):[0-9a-f:]+/i.test(remaining)) {
    failures.push(`${path}: production surface contains a private-network IPv6 destination`);
  }
}

function countOccurrences(content, value) {
  return content.split(value).length - 1;
}

function isRuntimeSurface(path) {
  if (runtimeExactFiles.has(path)) return true;
  if (path.startsWith("services/social/scripts/")) {
    return /(?:production|backup|restore)/i.test(basename(path)) && runtimeTextExtensions.has(extname(path).toLowerCase());
  }
  return runtimePrefixes.some((prefix) => path.startsWith(prefix))
    && (runtimeTextExtensions.has(extname(path).toLowerCase()) || path.endsWith("/Caddyfile"));
}

function sameStrings(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function listFiles() {
  return execFileSync(
    "git",
    ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  )
    .split(/\r?\n/)
    .filter(Boolean);
}
