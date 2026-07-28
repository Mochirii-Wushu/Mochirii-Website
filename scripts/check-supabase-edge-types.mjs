import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const edgeRuntimeTypes = "jsr:@supabase/functions-js@2.110.8/edge-runtime.d.ts";
const supabaseClient = "npm:@supabase/supabase-js@2.110.8";

const functions = [
  "verify-discord-member",
  "verify-member-access",
  "review-member-verification",
  "list-gallery-review-queue",
  "spinner-live-session",
  "moderate-gallery-submission",
  "delete-rejected-gallery-submission",
  "list-approved-gallery-submissions",
  "submit-discord-gallery-image",
  "reaper-discord-interactions",
  "reaper-spinner-dispatch",
  "reaper-discord-member-sync",
  "send-vote-reminder",
  "send-member-spotlight-poll",
  "publish-member-spotlight-winner",
  "get-current-spotlight-winner",
  "get-current-raffle",
  "list-instagram-publish-queue",
  "publish-instagram-gallery-submission",
  "mark-instagram-gallery-submission-shared",
  "check-instagram-api-status",
  "list-member-profiles",
  "list-visible-profile-cards",
  "get-member-profile",
  "submit-member-profile-media",
  "list-member-profile-media-queue",
  "moderate-member-profile-media",
  "mochi-pets-alpha-session",
  "mochi-pets-unity-auth",
  "mochi-pets-alpha-action",
  "mochi-pets-alpha-progress",
  "mochi-pets-alpha-admin",
  "submit-mochi-pets-feedback",
  "sync-pixelfed-social-account",
];
const committedLockFunctions = [
  "list-approved-gallery-submissions",
  "list-gallery-review-queue",
  "moderate-gallery-submission",
  "reaper-spinner-dispatch",
  "spinner-live-session",
  "submit-discord-gallery-image",
];

function denoBinary() {
  if (process.env.DENO_BIN) return process.env.DENO_BIN;

  const localInstall = path.join(os.homedir(), ".deno", "bin", process.platform === "win32" ? "deno.exe" : "deno");
  if (existsSync(localInstall)) return localInstall;

  return "deno";
}

const deno = denoBinary();
let failed = false;

const functionRoot = path.join(root, "supabase", "functions");
const discoveredFunctions = readdirSync(functionRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(functionRoot, entry.name, "deno.json")))
  .map((entry) => entry.name)
  .sort();
const expectedFunctions = [...functions].sort();

if (JSON.stringify(discoveredFunctions) !== JSON.stringify(expectedFunctions)) {
  failed = true;
  console.error("Supabase Edge Function manifest inventory does not match the reviewed function list.");
  console.error(`Expected: ${expectedFunctions.join(", ")}`);
  console.error(`Found: ${discoveredFunctions.join(", ")}`);
}

const discoveredCommittedLockFunctions = readdirSync(functionRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(functionRoot, entry.name, "deno.lock")))
  .map((entry) => entry.name)
  .sort();
const expectedCommittedLockFunctions = [...committedLockFunctions].sort();
if (JSON.stringify(discoveredCommittedLockFunctions) !== JSON.stringify(expectedCommittedLockFunctions)) {
  failed = true;
  console.error("Committed Supabase Edge Function lock inventory does not match the reviewed list.");
  console.error(`Expected: ${expectedCommittedLockFunctions.join(", ")}`);
  console.error(`Found: ${discoveredCommittedLockFunctions.join(", ")}`);
}

for (const name of functions) {
  const importMap = path.join(functionRoot, name, "deno.json");
  try {
    const imports = JSON.parse(readFileSync(importMap, "utf8")).imports ?? {};
    const expectedImports = {
      "@supabase/functions-js/edge-runtime.d.ts": edgeRuntimeTypes,
      "@supabase/supabase-js": supabaseClient,
      ...(name === "reaper-discord-interactions" ? { tweetnacl: "npm:tweetnacl@1.0.3" } : {}),
    };
    if (imports["@supabase/functions-js/edge-runtime.d.ts"] !== edgeRuntimeTypes) {
      failed = true;
      console.error(`${name}: Edge Runtime types must resolve exactly to ${edgeRuntimeTypes}.`);
    }
    if (imports["@supabase/supabase-js"] !== supabaseClient) {
      failed = true;
      console.error(`${name}: Supabase client must resolve exactly to ${supabaseClient}.`);
    }
    if (Object.hasOwn(imports, "@supabase/functions-js")) {
      failed = true;
      console.error(`${name}: remove the unused @supabase/functions-js alias.`);
    }
    const actualEntries = Object.entries(imports).sort(([left], [right]) => left.localeCompare(right));
    const expectedEntries = Object.entries(expectedImports).sort(([left], [right]) => left.localeCompare(right));
    if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
      failed = true;
      console.error(`${name}: dependency manifest contains an unreviewed or missing direct import.`);
    }
  } catch (error) {
    failed = true;
    console.error(`${name}: unable to read deployment dependency manifest: ${error.message}`);
  }
}

if (failed) {
  console.error("Supabase Edge Function dependency contract validation failed.");
  process.exit(1);
}

function runDeno(args, label) {
  const result = spawnSync(deno, args, {
    cwd: root,
    stdio: "inherit",
  });

  if (result.error) {
    failed = true;
    console.error(`${label}: unable to run Deno: ${result.error.message}`);
    return false;
  } else if (result.status !== 0) {
    failed = true;
    return false;
  }
  return true;
}

const resolutionDirectory = mkdtempSync(path.join(os.tmpdir(), "mochirii-edge-resolution-"));

try {
  for (const name of functions) {
    const config = `supabase/functions/${name}/deno.json`;
    const entrypoint = `supabase/functions/${name}/index.ts`;
    const resolutionLock = path.join(resolutionDirectory, `${name}.lock`);
    console.log(`Checking provider-style Supabase Edge Function types: ${name}`);

    const lockCaptured = runDeno(
      [
        "check",
        "--quiet",
        "--node-modules-dir=auto",
        `--config=${config}`,
        "--no-lock",
        entrypoint,
      ],
      name,
    );

    runDeno(
      [
        "check",
        "--quiet",
        "--node-modules-dir=auto",
        `--config=${config}`,
        `--lock=${resolutionLock}`,
        "--frozen=false",
        entrypoint,
      ],
      `${name} dependency resolution`,
    );
    if (lockCaptured) {
      runDeno(
        ["audit", "--quiet", `--lock=${resolutionLock}`, "--frozen=true"],
        `${name} resolved dependency audit`,
      );
    }

    if (committedLockFunctions.includes(name)) {
      const committedLock = `supabase/functions/${name}/deno.lock`;
      runDeno(
        [
          "check",
          "--quiet",
          "--node-modules-dir=auto",
          `--config=${config}`,
          `--lock=${committedLock}`,
          "--frozen=true",
          entrypoint,
        ],
        `${name} committed dependency lock`,
      );
      runDeno(
        ["audit", "--quiet", `--lock=${committedLock}`, "--frozen=true"],
        `${name} committed dependency audit`,
      );
    }
  }

  runDeno(
    ["audit", "--quiet", "--lock=deno.lock", "--frozen=true"],
    "Repository Deno lock audit",
  );
} finally {
  rmSync(resolutionDirectory, { recursive: true, force: true });
}

if (failed) {
  console.error("Supabase Edge Function type validation failed.");
  process.exit(1);
}

console.log("Supabase Edge Function type validation OK.");
