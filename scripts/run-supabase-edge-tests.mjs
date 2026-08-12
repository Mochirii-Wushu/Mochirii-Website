import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const deno = process.env.DENO_BIN || "deno";
const suites = [
  ["reaper interactions", ["--allow-env", "--node-modules-dir=auto", "--import-map=supabase/functions/reaper-discord-interactions/deno.json", "supabase/functions/_shared/discord-interaction-helpers_test.ts", "supabase/functions/_shared/discord-signature_test.ts", "supabase/functions/_shared/photo-day-polls_test.ts", "supabase/functions/_shared/reaper-discord-events_test.ts"]],
  ["gallery cleanup", ["--allow-env", "--node-modules-dir=auto", "--import-map=supabase/functions/delete-rejected-gallery-submission/deno.json", "supabase/functions/_shared/gallery-cleanup_test.ts"]],
  ["gallery thumbnail", ["supabase/functions/_shared/gallery-thumbnail_test.ts"]],
  ["member access", ["--allow-env", "--node-modules-dir=auto", "--import-map=supabase/functions/sync-pixelfed-social-account/deno.json", "supabase/functions/_shared/member-access-policy_test.ts", "supabase/functions/_shared/pixelfed-social-sync_test.ts", "supabase/functions/_shared/social-service-entitlement_test.ts"]],
  ["member verification identity", ["supabase/functions/_shared/member-verification-identity_test.ts"]],
  ["Mochi Pets", ["--allow-env", "--node-modules-dir=auto", "--import-map=supabase/functions/mochi-pets-unity-auth/deno.json", "supabase/functions/_shared/mochi-pets-alpha_test.ts"]],
  ["modmail audit", ["supabase/functions/_shared/modmail-audit_test.ts"]],
  ["pending verification", ["supabase/functions/_shared/pending-verification-containment_test.ts"]],
  ["spinner", ["--allow-env", "--node-modules-dir=auto", "--import-map=supabase/functions/spinner-live-session/deno.json", "supabase/functions/_shared/spinner-live_test.ts", "supabase/functions/_shared/spinner-media_test.ts"]],
  ["spotlight poll", ["--allow-env", "--node-modules-dir=auto", "--import-map=deno-spotlight-poll.import_map.json", "supabase/functions/_shared/spotlight-polls_test.ts"]],
  ["service role", ["supabase/functions/_shared/supabase-service-role_test.ts"]],
  ["vote reminder", ["--allow-env", "supabase/functions/_shared/vote-reminders_test.ts"]],
  ["member access refresh", ["--allow-env", "--node-modules-dir=auto", "--import-map=supabase/functions/verify-member-access/deno.json", "supabase/functions/verify-member-access/index_test.ts"]],
];

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return discover(absolute);
    if (!entry.isFile() || !entry.name.endsWith("_test.ts")) return [];
    return [path.relative(root, absolute).replaceAll("\\", "/")];
  });
}

const discovered = discover(path.join(root, "supabase", "functions")).sort();
const covered = suites.flatMap(([, args]) => args.filter((arg) => arg.endsWith("_test.ts"))).sort();
if (JSON.stringify(discovered) !== JSON.stringify(covered)) {
  throw new Error(`Edge test coverage mismatch. Discovered: ${discovered.join(", ")}; covered: ${covered.join(", ")}`);
}

for (const [label, args] of suites) {
  console.log(`Running Supabase Edge tests: ${label}`);
  const result = spawnSync(deno, ["test", "--lock=deno.lock", "--frozen=true", ...args], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Supabase Edge test suite OK (${discovered.length} test files in ${suites.length} bounded runs).`);
