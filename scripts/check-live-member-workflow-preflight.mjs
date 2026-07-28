import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = realpathSync(process.cwd());
const localEnvFile = ".env.live-member-qa";
const templateFile = "reports/live-member-qa-local-template.md";
const strictMode = process.argv.includes("--strict") || process.env.QA_LIVE_MEMBER_WORKFLOW_STRICT === "1";
const requireMutationApproval =
  process.argv.includes("--require-mutation-approval") ||
  process.env.QA_LIVE_MEMBER_REQUIRE_MUTATION_APPROVAL === "1";
const selfTestMode = process.argv.includes("--self-test");
const maxUploadBytes = 8 * 1024 * 1024;

const requiredVars = [
  "QA_TEST_MEMBER_EMAIL_OR_LABEL",
  "QA_TEST_UNVERIFIED_DISCORD_LABEL",
  "QA_TEST_VERIFIED_MEMBER_LABEL",
  "QA_TEST_MODERATOR_LABEL",
  "QA_TEST_IMAGE_PATH_LOCAL",
  "QA_TEST_TITLE_PREFIX",
  "QA_TEST_CAPTION_MARKER",
  "QA_ALLOW_LIVE_MUTATION",
];

const identityVars = [
  "QA_TEST_MEMBER_EMAIL_OR_LABEL",
  "QA_TEST_UNVERIFIED_DISCORD_LABEL",
  "QA_TEST_VERIFIED_MEMBER_LABEL",
  "QA_TEST_MODERATOR_LABEL",
];

const secretPatterns = [
  { label: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{12,}\b/ },
  { label: "JWT-like token", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { label: "database URL", pattern: /\bpostgres(?:ql)?:\/\/[^\s<>)]+/i },
  { label: "Discord token", pattern: /\b[MN][A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/ },
  { label: "signed Storage URL", pattern: /https?:\/\/[^\s<>)]+\/storage\/v1\/object\/sign\/[^\s<>)]+/i },
  { label: "access token assignment", pattern: /\b(?:access|refresh|bearer|service[_-]?role)[_-]?token\s*[:=]\s*\S{8,}/i },
  { label: "client secret assignment", pattern: /\bclient[_-]?secret\s*[:=]\s*\S{8,}/i },
  { label: "API credential assignment", pattern: /\b(?:api[_-]?key|api[_-]?token|cloudflare[_-]?token|vercel[_-]?token|github[_-]?token|pat)\s*[:=]\s*\S{8,}/i },
  { label: "password assignment", pattern: /\bpassword\s*[:=]\s*\S{8,}/i },
  { label: "session cookie assignment", pattern: /\b(?:cookie|session[_-]?cookie)\s*[:=]\s*\S{20,}/i },
  { label: "Discord webhook URL", pattern: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/[^\s<>)]+/i },
];

const privateIdentifierPatterns = [
  { label: "email-like identifier", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: "UUID-like private identifier", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i },
  { label: "private Storage object path", pattern: /\bmember-gallery\/[^\s<>)]+/i },
];
const allowedUploadExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const forbiddenTrackedPatterns = [
  /^\.env\.live-member-qa(?:$|\.)/,
  /^live-member-qa\.env$/,
  /^\.auth\//,
  /^playwright\/\.auth\//,
  /(?:^|\/)(?:auth-state|storage-state|cookies)\.json$/,
];

const failures = [];
const warnings = [];
const notes = [];

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function addFailure(message) {
  failures.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

function addNote(message) {
  notes.push(message);
}

function addStrictIssue(message) {
  strictMode ? addFailure(message) : addWarning(message);
}

function fileText(file) {
  return readFileSync(path.join(root, file), "utf8");
}

function gitCheckIgnore(file) {
  const result = spawnSync("git", ["check-ignore", "-q", file], { cwd: root });
  return result.status === 0;
}

function listTrackedFiles() {
  const output = git(["ls-files"]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function parseEnvText(text) {
  const values = new Map();

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) return;

    const key = match[1];
    const rawValue = match[2].trim().replace(/^["']|["']$/g, "");
    values.set(key, rawValue);
  });

  return values;
}

function boolValue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function booleanText(value) {
  return String(value || "").trim().toLowerCase();
}

function repoRelative(absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function isInsideRepo(absolutePath) {
  const relative = repoRelative(absolutePath);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function scanLocalFileForPrivateValues(text) {
  const secretMatches = [];
  const privateMatches = [];

  text.split(/\r?\n/).forEach((line, index) => {
    for (const { label, pattern } of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) secretMatches.push(`line ${index + 1}: ${label}`);
    }

    for (const { label, pattern } of privateIdentifierPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) privateMatches.push(`line ${index + 1}: ${label}`);
    }
  });

  return { secretMatches, privateMatches };
}

function checkLocalFileForSecrets(text) {
  const { secretMatches, privateMatches } = scanLocalFileForPrivateValues(text);

  if (secretMatches.length) {
    addFailure(`Local ${localEnvFile} appears to contain secret values: ${secretMatches.join("; ")}.`);
  }

  if (privateMatches.length) {
    addStrictIssue(`Local ${localEnvFile} appears to contain private identifiers: ${privateMatches.join("; ")}.`);
  }
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(message);
}

function runSelfTest() {
  const supabaseSecretSample = ["sb", "secret"].join("_") + "_fakeSecretValueForSelfTest";
  const discordWebhookSample = `https://${["discord", "com"].join(".")}/api/${"webhooks"}/111111111111111111/fakeWebhookSecretValue`;
  const cases = [
    ["email-like identifier", "QA_TEST_MEMBER_EMAIL_OR_LABEL=operator@example.com"],
    ["UUID-like private identifier", "QA_PRIVATE_NOTE=123e4567-e89b-12d3-a456-426614174000"],
    ["private Storage object path", "QA_PRIVATE_NOTE=member-gallery/private/proof.webp"],
    ["Supabase secret key", `QA_PRIVATE_NOTE=${supabaseSecretSample}`],
    ["Discord webhook URL", `QA_PRIVATE_NOTE=${discordWebhookSample}`],
    ["API credential assignment", "QA_PRIVATE_NOTE=cloudflare_token=cf_test_secret_value"],
    ["password assignment", "QA_PRIVATE_NOTE=password=local-test-password"],
    ["session cookie assignment", "QA_PRIVATE_NOTE=session_cookie=local-test-cookie-value"],
  ];

  for (const [label, line] of cases) {
    const { secretMatches, privateMatches } = scanLocalFileForPrivateValues(`${line}\n`);
    const matches = [...secretMatches, ...privateMatches];
    assertSelfTest(matches.some((match) => match.includes(label)), `${label} was not detected.`);
    assertSelfTest(!matches.some((match) => match.includes(line.split("=").slice(1).join("="))), `${label} leaked a value.`);
  }

  const safe = scanLocalFileForPrivateValues(
    "QA_TEST_MEMBER_EMAIL_OR_LABEL=qa-member\nQA_TEST_UNVERIFIED_DISCORD_LABEL=qa-unverified\n",
  );
  assertSelfTest(safe.secretMatches.length === 0, "Safe labels matched secret patterns.");
  assertSelfTest(safe.privateMatches.length === 0, "Safe labels matched private identifier patterns.");

  console.log("Live member workflow preflight self-test OK (values redacted).");
}

function checkLabelValues(values) {
  if (!strictMode) return;

  const emptyIdentityKeys = identityVars.filter((key) => !String(values.get(key) || "").trim());
  if (!emptyIdentityKeys.length) addNote("Local QA identity labels are present.");
}

function checkMarkerValues(values) {
  const title = values.get("QA_TEST_TITLE_PREFIX") || "";
  const caption = values.get("QA_TEST_CAPTION_MARKER") || "";

  if (strictMode && title && !title.startsWith("Mochirii QA Test")) {
    addFailure("QA_TEST_TITLE_PREFIX must begin with the approved disposable QA marker.");
  }

  if (strictMode && caption && !/QA Test/i.test(caption)) {
    addFailure("QA_TEST_CAPTION_MARKER must clearly identify disposable QA content.");
  }
}

function checkMutationFlag(values) {
  const mutationValue = values.get("QA_ALLOW_LIVE_MUTATION");
  const normalized = booleanText(mutationValue);
  const mutationEnabled = boolValue(mutationValue);

  if (mutationValue && !["true", "false"].includes(normalized)) {
    addStrictIssue("QA_ALLOW_LIVE_MUTATION must be exactly true or false.");
  }

  if (mutationEnabled) {
    if (strictMode && !requireMutationApproval) {
      addFailure("strict D02 mode requires QA_ALLOW_LIVE_MUTATION=false; use --require-mutation-approval only for D03.");
    } else {
      addWarning("Local mutation flag is true. This does not authorize D03 by itself; explicit human approval is still required.");
    }
  }

  if (requireMutationApproval && !mutationEnabled) {
    addFailure("mutation-approval mode requires QA_ALLOW_LIVE_MUTATION=true in the local ignored QA file.");
  }
}

function checkModeCombination() {
  if (requireMutationApproval && !strictMode) {
    addFailure("mutation-approval mode requires --strict.");
  }
}

function checkImagePath(values) {
  const imagePath = values.get("QA_TEST_IMAGE_PATH_LOCAL");
  if (!imagePath) return;

  if (!path.isAbsolute(imagePath)) {
    addStrictIssue("QA_TEST_IMAGE_PATH_LOCAL must be an absolute repo-external path.");
    return;
  }

  if (!existsSync(imagePath)) {
    addStrictIssue("QA_TEST_IMAGE_PATH_LOCAL must point to an existing local image file.");
    return;
  }

  let absoluteImagePath;
  let stats;
  try {
    absoluteImagePath = realpathSync(imagePath);
    stats = statSync(absoluteImagePath);
  } catch {
    addStrictIssue("QA_TEST_IMAGE_PATH_LOCAL could not be inspected.");
    return;
  }

  if (!stats.isFile()) {
    addStrictIssue("QA_TEST_IMAGE_PATH_LOCAL must point to a file.");
  }

  if (stats.size <= 0) {
    addStrictIssue("QA_TEST_IMAGE_PATH_LOCAL must not be empty.");
  }

  if (stats.size > maxUploadBytes) {
    addStrictIssue("QA_TEST_IMAGE_PATH_LOCAL must be under 8 MB.");
  }

  if (!allowedUploadExtensions.has(path.extname(absoluteImagePath).toLowerCase())) {
    addStrictIssue("QA_TEST_IMAGE_PATH_LOCAL must be a JPEG, PNG, or WebP file.");
  }

  if (isInsideRepo(absoluteImagePath)) {
    addStrictIssue("QA_TEST_IMAGE_PATH_LOCAL must stay outside the repository.");
  }
}

function checkIgnoredLocalFile() {
  if (gitCheckIgnore(localEnvFile)) {
    addNote(`${localEnvFile} is ignored by Git.`);
  } else {
    addFailure(`${localEnvFile} is not ignored; update .gitignore before storing local QA values.`);
  }
}

function checkNoTrackedCredentialFiles() {
  const trackedFiles = listTrackedFiles();
  const matches = trackedFiles.filter((file) => forbiddenTrackedPatterns.some((pattern) => pattern.test(file)));

  if (matches.length) {
    matches.forEach((file) => addFailure(`${file} is tracked but should remain local-only credential state.`));
    return;
  }

  addNote("No live member QA credential files are tracked.");
}

function checkTemplate() {
  if (!existsSync(path.join(root, templateFile))) {
    addFailure(`${templateFile} is missing; local QA variable names are no longer documented.`);
    return;
  }

  const text = fileText(templateFile);
  const missingVars = requiredVars.filter((key) => !text.includes(key));

  if (missingVars.length) {
    addFailure(`${templateFile} is missing required variable names: ${missingVars.join(", ")}.`);
  } else {
    addNote(`${templateFile} documents all required local QA variable names.`);
  }

  if (!/QA_ALLOW_LIVE_MUTATION\s*=\s*false/.test(text)) {
    addFailure(`${templateFile} must show QA_ALLOW_LIVE_MUTATION=false as the default.`);
  } else {
    addNote("QA_ALLOW_LIVE_MUTATION defaults to false in the committed template.");
  }
}

function checkLocalReadiness() {
  const absolute = path.join(root, localEnvFile);

  if (!existsSync(absolute)) {
    addNote(`${localEnvFile} not found; live member workflow QA is not configured.`);
    if (strictMode) addFailure(`strict mode requires local ${localEnvFile}.`);
    return;
  }

  const localText = readFileSync(absolute, "utf8");
  checkLocalFileForSecrets(localText);

  const values = parseEnvText(localText);
  const missingKeys = requiredVars.filter((key) => !values.has(key));
  const emptyKeys = requiredVars.filter((key) => values.has(key) && !String(values.get(key) || "").trim());
  const configuredCount = requiredVars.length - missingKeys.length - emptyKeys.length;

  addNote(`${localEnvFile} found locally; ${configuredCount}/${requiredVars.length} required fields are configured.`);

  if (missingKeys.length) {
    const message = `${localEnvFile} is missing required keys: ${missingKeys.join(", ")}.`;
    strictMode ? addFailure(message) : addWarning(message);
  }

  if (emptyKeys.length) {
    const message = `${localEnvFile} has empty required keys: ${emptyKeys.join(", ")}.`;
    strictMode ? addFailure(message) : addWarning(message);
  }

  checkLabelValues(values);
  checkMarkerValues(values);
  checkMutationFlag(values);
  checkImagePath(values);
}

if (selfTestMode) {
  try {
    runSelfTest();
  } catch (error) {
    console.error(`Live member workflow preflight self-test failed: ${error?.message || error}`);
    process.exit(1);
  }

  process.exit(0);
}

checkIgnoredLocalFile();
checkNoTrackedCredentialFiles();
checkTemplate();
checkModeCombination();
checkLocalReadiness();

console.log("Live member workflow preflight:");
notes.forEach((note) => console.log(`- ${note}`));
warnings.forEach((warning) => console.warn(`WARN ${warning}`));

if (failures.length) {
  console.error("Live member workflow preflight failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  console.error("No secret values were printed. Keep credentials local and ignored.");
  process.exit(1);
}

const modeLabel = requireMutationApproval ? "strict mutation-approval" : strictMode ? "strict" : "normal";
console.log(`Live member workflow preflight OK (${modeLabel} mode).`);
