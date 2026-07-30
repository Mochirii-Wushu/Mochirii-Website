import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SUPABASE_PROJECT_REF } from "./lib/public-urls.mjs";

const root = process.cwd();
const allowedEnvFiles = new Set([
  ".env.example",
  "apps/web/.env.example",
  "services/social/.env.docker.example",
  "services/social/.env.example",
  "services/social/.env.testing",
  "supabase/functions/.env.example",
]);
const expectedProjectRef = SUPABASE_PROJECT_REF;
const expectedUrl = `https://${expectedProjectRef}.supabase.co`;

const forbiddenBrowserTerms = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEYS",
  "SUPABASE_DB_PASSWORD",
  "DISCORD_BOT_TOKEN",
  "DISCORD_CLIENT_SECRET",
  "JWT_SECRET",
  "DATABASE_URL",
  "sb_secret_",
  "service_role",
  "postgres://",
  "postgresql://",
];

const strongSecretPatterns = [
  {
    label: "Supabase secret key",
    pattern: /\bsb_secret_[A-Za-z0-9_-]{12,}\b/g,
  },
  {
    label: "Discord webhook URL",
    pattern: /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g,
  },
  {
    label: "Discord bot token",
    pattern: /\b[A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}\b/g,
  },
  {
    label: "Credentialed Postgres URL",
    pattern: /\bpostgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@[^\s]+/g,
  },
  {
    label: "JWT-like token",
    pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  },
];

const secretAssignmentPattern =
  /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|SERVICE_ROLE_KEY|DATABASE_URL|CLIENT_SECRET|WEBHOOK))\b\s*=\s*([^`'"\s)]*)/g;

const failures = [];
const warnings = [];

function listTrackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
}

function listUntrackedFiles() {
  return execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
}

function readText(file) {
  const absolute = path.join(root, file);
  const buffer = readFileSync(absolute);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

function isTextFile(file) {
  return /\.(?:css|html|js|json|md|mjs|npmrc|sql|toml|ts|txt|yml|yaml)$/i.test(file) || file === ".gitignore" || file.endsWith(".example");
}

function isBrowserFile(file) {
  return file.startsWith("apps/web/") && /\.(?:js|jsx|ts|tsx)$/i.test(file);
}

function isEnvPath(file) {
  return /(^|\/)\.env(?:$|\.)/.test(file) || /^supabase\/functions\/\.env(?:$|\.)/.test(file);
}

function isPlaceholderValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return true;
  if (/^(?:true|false|null|undefined)$/i.test(value)) return true;
  if (/^(?:example|placeholder|redacted)$/i.test(value)) return true;
  if (/^%[a-z](?:\\n)?$/i.test(value)) return true;
  if (/^[<[{]/.test(value)) return true;
  if (/^(?:<.*>|\[.*\])$/.test(value)) return true;
  if (/PASTE|REPLACE|SET_MANUALLY|set manually|never commit|\.\.\./i.test(value)) return true;
  if (/[|*]/.test(value)) return true;
  return false;
}

function maskValue(value) {
  const text = String(value || "");
  if (text.length <= 8) return "[redacted]";
  return `${text.slice(0, 4)}...[redacted]`;
}

function addFailure(file, lineNumber, message) {
  failures.push(`${file}${lineNumber ? `:${lineNumber}` : ""}: ${message}`);
}

function checkEnvFiles(trackedFiles, untrackedFiles) {
  trackedFiles.filter(isEnvPath).forEach((file) => {
    if (!allowedEnvFiles.has(file)) {
      addFailure(file, 0, "tracked environment file is not allowed; keep local secrets ignored.");
    }
  });

  untrackedFiles.filter(isEnvPath).forEach((file) => {
    addFailure(file, 0, "untracked environment file is not ignored; update .gitignore before adding secrets locally.");
  });
}

function checkGitignore() {
  const gitignorePath = path.join(root, ".gitignore");
  if (!existsSync(gitignorePath)) {
    failures.push(".gitignore: missing; local environment files must be ignored.");
    return;
  }

  const text = readFileSync(gitignorePath, "utf8");
  [".env", ".env.*", "supabase/functions/.env", "supabase/functions/.env.*"].forEach((entry) => {
    if (!text.split(/\r?\n/).some((line) => line.trim() === entry)) {
      failures.push(`.gitignore: missing ${entry} ignore rule.`);
    }
  });
}

function checkPublicUrlContract() {
  const config = JSON.parse(readText("apps/web/config/public-urls.json") || "{}");
  if (config.supabaseProjectRef !== expectedProjectRef) {
    failures.push("apps/web/config/public-urls.json: expected public Supabase project ref is missing.");
  }
  const browserConfig = readText("apps/web/lib/supabase/config.ts") || "";
  if (!browserConfig.includes("process.env.NEXT_PUBLIC_SUPABASE_URL")) {
    failures.push("apps/web/lib/supabase/config.ts: public URL must come from the hosted environment.");
  }
  if (!browserConfig.includes("process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) {
    failures.push("apps/web/lib/supabase/config.ts: publishable key must come from the hosted environment.");
  }
}

function checkTextFile(file, text) {
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    strongSecretPatterns.forEach(({ label, pattern }) => {
      pattern.lastIndex = 0;
      const matches = [...line.matchAll(pattern)];
      matches.forEach((match) => {
        addFailure(file, lineNumber, `${label} appears to be committed (${maskValue(match[0])}).`);
      });
    });

    secretAssignmentPattern.lastIndex = 0;
    for (const match of line.matchAll(secretAssignmentPattern)) {
      const key = match[1];
      const value = match[2];
      if (!isPlaceholderValue(value)) {
        addFailure(file, lineNumber, `${key} has a non-placeholder value (${maskValue(value)}).`);
      }
    }

    if (isBrowserFile(file)) {
      forbiddenBrowserTerms.forEach((term) => {
        if (line.includes(term)) {
          addFailure(file, lineNumber, `browser file contains secret-only Supabase/Discord term "${term}".`);
        }
      });
    }
  });
}

const trackedFiles = listTrackedFiles();
const untrackedFiles = listUntrackedFiles();

checkEnvFiles(trackedFiles, untrackedFiles);
checkGitignore();
checkPublicUrlContract();

trackedFiles.filter((file) => existsSync(path.join(root, file))).filter(isTextFile).forEach((file) => {
  const text = readText(file);
  if (text == null) {
    warnings.push(`${file}: skipped binary-like text file.`);
    return;
  }
  checkTextFile(file, text);
});

if (failures.length) {
  console.error("Supabase public config validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  console.error("No secret values are printed in full. Rotate any real secret that was committed.");
  process.exit(1);
}

warnings.forEach((warning) => console.warn(`WARN ${warning}`));
console.log("Supabase public config OK.");
console.log(`Allowed public config: ${expectedUrl}, sb_publishable_ browser key, project ref, role IDs, bucket name, and upload limits.`);
