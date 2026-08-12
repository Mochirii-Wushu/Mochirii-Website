import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseSupabaseMigrationList } from "./lib/supabase-migration-list.mjs";
import { migrationVersions } from "./lib/supabase-local-preview.mjs";

const index = process.argv.indexOf("--workdir");
const workdir = index === -1 ? "" : process.argv[index + 1] || "";
if (!workdir) throw new Error("--workdir is required.");

const migrationsDirectory = path.resolve(workdir, "supabase", "migrations");
const expected = migrationVersions(migrationsDirectory);
const supabaseCli = path.resolve("node_modules", "supabase", "dist", "supabase.js");
if (!existsSync(supabaseCli)) {
  throw new Error("The repository-pinned Supabase CLI could not be located. Run npm ci first.");
}
const result = spawnSync(
  process.execPath,
  [supabaseCli, "migration", "list", "--local", "--workdir", workdir],
  { encoding: "utf8" },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr.trim() || "Supabase local migration list failed.");
const parsed = parseSupabaseMigrationList(result.stdout);
const local = parsed.rows.map(({ local }) => local).filter(Boolean).sort();
const applied = parsed.rows.map(({ remote }) => remote).filter(Boolean).sort();

if (JSON.stringify(local) !== JSON.stringify(expected)) {
  throw new Error(`Local migration-file history mismatch: expected ${expected.length}, received ${local.length}.`);
}
if (JSON.stringify(applied) !== JSON.stringify(expected)) {
  throw new Error(`Applied local migration history mismatch: expected ${expected.length}, received ${applied.length}.`);
}
console.log(`Supabase local migration history OK (${expected.length} migrations applied exactly once).`);
