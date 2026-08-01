import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { classifySupabaseChanges } from "./lib/supabase-local-preview.mjs";

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed.`);
  }
  return result.stdout.trim();
}

const head = value("--head") || "HEAD";
let base = value("--base");
if (!base || /^0{40}$/u.test(base)) {
  const parent = spawnSync("git", ["rev-parse", `${head}^`], { encoding: "utf8" });
  base = parent.status === 0 ? parent.stdout.trim() : "";
}

const output = base
  ? git(["diff", "--name-only", "--diff-filter=ACDMRTUXB", base, head])
  : git(["ls-tree", "-r", "--name-only", head]);
const classification = classifySupabaseChanges(output.split(/\r?\n/u));
const changed = classification.changed ? "true" : "false";
const reason = classification.changed
  ? classification.owned.join(",")
  : "no-supabase-owned-paths";

console.log(`Supabase local preview change detection: ${changed} (${reason})`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nreason=${reason}\n`, "utf8");
}
