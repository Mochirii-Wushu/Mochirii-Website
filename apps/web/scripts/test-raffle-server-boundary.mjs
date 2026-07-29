import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { PRIVATE_RAFFLE_OPERATION_ALLOWLIST } from "./private-raffle-operation-policy.mjs";

const appRoot = path.resolve(import.meta.dirname, "..");
const tests = [
  "lib/supabase/auth-redirect-core.test.mts",
  "lib/supabase/legacy-auth-cutover-core.test.mts",
  "lib/supabase/raffle-access-policy-core.test.mts",
  "lib/supabase/server-cookie-adapters-core.test.mts",
  "scripts/private-raffle-operation-policy.test.mjs",
  ...PRIVATE_RAFFLE_OPERATION_ALLOWLIST.map(({ behaviorTest }) => behaviorTest),
];
const result = spawnSync(process.execPath, [
  "--experimental-default-type=module",
  "--experimental-strip-types",
  "--test",
  ...tests,
], { cwd: appRoot, encoding: "utf8", stdio: "inherit" });
process.exit(result.status ?? 1);
