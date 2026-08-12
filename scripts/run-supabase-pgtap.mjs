import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const localPreviewWorkdir = process.env.SUPABASE_LOCAL_WORKDIR
  ? resolve(process.env.SUPABASE_LOCAL_WORKDIR)
  : "";
const testDirectory = resolve(root, "supabase/tests");
const tests = readdirSync(testDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith("_test.sql"))
  .map((entry) => `supabase/tests/${entry.name}`)
  .sort();

if (tests.length === 0) {
  throw new Error("No top-level Supabase pgTAP test files were found.");
}

const supabaseCli = resolve(root, "node_modules", "supabase", "dist", "supabase.js");
if (!existsSync(supabaseCli)) {
  throw new Error("The repository-pinned Supabase CLI could not be located. Run npm ci first.");
}

const result = spawnSync(
  process.execPath,
  [
    supabaseCli,
    "test",
    "db",
    "--local",
    ...(localPreviewWorkdir ? ["--workdir", localPreviewWorkdir] : []),
    ...tests,
  ],
  { cwd: localPreviewWorkdir || root, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`Supabase pgTAP suite OK (${tests.length} files).`);
