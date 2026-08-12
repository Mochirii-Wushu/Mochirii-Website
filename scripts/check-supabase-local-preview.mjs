import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  EXPECTED_FUNCTION_COUNT,
  EXPECTED_VERIFY_JWT_FALSE,
  EXPECTED_VERIFY_JWT_TRUE,
  classifySupabaseChanges,
  migrationVersions,
  parseFunctionInventory,
} from "./lib/supabase-local-preview.mjs";

const root = process.cwd();
const workflowPath = path.join(root, ".github", "workflows", "validate-supabase-local-preview.yml");
const workflow = readFileSync(workflowPath, "utf8").replaceAll("\r\n", "\n");
const packageJson = readFileSync(path.join(root, "package.json"), "utf8");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

assert.equal(classifySupabaseChanges(["docs/README.md"]).changed, false);
assert.equal(classifySupabaseChanges(["supabase/migrations/20260101000000_example.sql"]).changed, true);
assert.equal(classifySupabaseChanges(["package-lock.json"]).changed, true);
assert.equal(classifySupabaseChanges(["scripts/check-supabase-edge-types.mjs"]).changed, true);
assert.equal(classifySupabaseChanges([".github/workflows/validate-supabase-local-preview.yml"]).changed, true);

const migrationCanary = mkdtempSync(path.join(os.tmpdir(), "mochirii-migration-canary-"));
try {
  writeFileSync(path.join(migrationCanary, "20260101000000_first.sql"), "select 1;\n");
  writeFileSync(path.join(migrationCanary, "20260102000000_second.sql"), "select 1;\n");
  assert.deepEqual(migrationVersions(migrationCanary), ["20260101000000", "20260102000000"]);
  writeFileSync(path.join(migrationCanary, "invalid.sql"), "select 1;\n");
  assert.throws(() => migrationVersions(migrationCanary), /Invalid Supabase migration filename/u);
} finally {
  rmSync(migrationCanary, { recursive: true, force: true });
}

const deletionCanary = mkdtempSync(path.join(os.tmpdir(), "mochirii-preview-delete-canary-"));
try {
  git(deletionCanary, ["init", "--quiet"]);
  git(deletionCanary, ["config", "user.name", "Mochirii CI"]);
  git(deletionCanary, ["config", "user.email", "ci@invalid.example"]);
  const migrations = path.join(deletionCanary, "supabase", "migrations");
  mkdirSync(migrations, { recursive: true });
  const migration = path.join(migrations, "20260101000000_delete_canary.sql");
  writeFileSync(migration, "select 1;\n");
  git(deletionCanary, ["add", "--all"]);
  git(deletionCanary, ["commit", "--quiet", "-m", "add migration canary"]);
  const base = git(deletionCanary, ["rev-parse", "HEAD"]);
  rmSync(migration);
  git(deletionCanary, ["add", "--all"]);
  git(deletionCanary, ["commit", "--quiet", "-m", "delete migration canary"]);
  const head = git(deletionCanary, ["rev-parse", "HEAD"]);
  const detector = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "detect-supabase-local-preview-changes.mjs"), "--base", base, "--head", head],
    { cwd: deletionCanary, encoding: "utf8" },
  );
  assert.equal(detector.status, 0, detector.stderr || "Supabase change detector failed");
  assert.match(
    detector.stdout,
    /Supabase local preview change detection: true \(supabase\/migrations\/20260101000000_delete_canary\.sql\)/u,
    "deleting a Supabase-owned file must run the heavy local Preview path",
  );
} finally {
  rmSync(deletionCanary, { recursive: true, force: true });
}

const inventory = parseFunctionInventory(
  readFileSync(path.join(root, "supabase", "config.toml"), "utf8"),
  path.join(root, "supabase", "functions"),
);
assert.equal(inventory.count, EXPECTED_FUNCTION_COUNT);
assert.equal(inventory.verifyJwtTrue, EXPECTED_VERIFY_JWT_TRUE);
assert.equal(inventory.verifyJwtFalse, EXPECTED_VERIFY_JWT_FALSE);

const requiredWorkflowSnippets = [
  "name: Validate Supabase locally",
  "permissions:\n  contents: read",
  "concurrency:\n  group: supabase-local-preview-${{ github.event.pull_request.number || github.ref }}\n  cancel-in-progress: true",
  "  supabase-local-preview:\n    name: supabase-local-preview",
  "runs-on: ubuntu-24.04",
  "EXPECTED_SHA: ${{ github.event.pull_request.head.sha || github.sha }}",
  "ref: ${{ env.EXPECTED_SHA }}",
  "actual_sha=\"$(git rev-parse HEAD)\"",
  "test \"$actual_sha\" = \"$EXPECTED_SHA\"",
  "printf 'SUPABASE_LOCAL_WORKDIR=%s\\n' \"$RUNNER_TEMP/mochirii-supabase-local-preview\" >> \"$GITHUB_ENV\"",
  "persist-credentials: false",
  "fetch-depth: 0",
  "node-version-file: .node-version",
  "deno-version: 2.9.4",
  "SUPABASE_TELEMETRY_DISABLED: 1",
  "DO_NOT_TRACK: 1",
  "steps.changes.outputs.changed == 'true'",
  '--destination "$SUPABASE_LOCAL_WORKDIR"',
  "--port-base 58000",
  "npm exec -- supabase db start",
  "npm exec -- supabase db reset --local --no-seed",
  "npm run test:supabase-db",
  "npm exec -- supabase db lint --local --level warning --fail-on warning",
  "npm run check:supabase-edge-types",
  "npm run test:supabase-edge-local-preview",
];
for (const snippet of requiredWorkflowSnippets) {
  assert.ok(workflow.includes(snippet), `Supabase local Preview workflow is missing: ${snippet}`);
}

for (const forbidden of [
  "pull_request_target",
  "secrets.",
  "supabase link",
  "supabase db push",
  "supabase functions deploy",
  " --linked",
  "actions/upload-artifact",
  "cache:",
  "paths:",
  "paths-ignore:",
  "${{ runner.temp }}",
]) {
  assert.ok(!workflow.includes(forbidden), `Supabase local Preview workflow contains forbidden text: ${forbidden}`);
}

for (const script of [
  "test:supabase-local-preview-contract",
  "test:supabase-edge-local-preview",
]) {
  assert.ok(packageJson.includes(`"${script}"`), `package.json is missing ${script}.`);
}

console.log(
  `Supabase local Preview contract OK (${inventory.count} functions; ${inventory.verifyJwtTrue}/${inventory.verifyJwtFalse} JWT parity).`,
);
