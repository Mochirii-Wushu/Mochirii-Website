import fs from "node:fs";
import path from "node:path";

export const PRIVATE_RAFFLE_OPERATION_ALLOWLIST = Object.freeze([
  // Enabling an operation requires its exact source path and a dedicated
  // behavioral test proving authorization runs before every side effect.
]);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

export function discoverPrivateRaffleOperations(appRoot) {
  const roots = [
    path.join(appRoot, "app", "raffle", "claim"),
    path.join(appRoot, "app", "leader-dashboard", "raffle"),
  ];
  return roots.flatMap(walk).filter((absolute) => {
    const name = path.basename(absolute);
    if (/\.test\.[cm]?[jt]sx?$/.test(name)) return false;
    if (/^route\.[cm]?[jt]sx?$/.test(name)) return true;
    if (!/\.[cm]?[jt]sx?$/.test(name)) return false;
    return /(?:^|[;{}\n]\s*)["']use server["']\s*;/.test(fs.readFileSync(absolute, "utf8"));
  }).map((absolute) => path.relative(appRoot, absolute).replaceAll("\\", "/")).sort();
}

export function validatePrivateRaffleOperationAllowlist(appRoot) {
  const discovered = discoverPrivateRaffleOperations(appRoot);
  const allowlisted = PRIVATE_RAFFLE_OPERATION_ALLOWLIST.map(({ source }) => source).sort();
  const failures = [];
  for (const source of discovered) {
    if (!allowlisted.includes(source)) failures.push(`${source} is not explicitly allowlisted.`);
  }
  for (const entry of PRIVATE_RAFFLE_OPERATION_ALLOWLIST) {
    if (!discovered.includes(entry.source)) failures.push(`${entry.source} is allowlisted but not present.`);
    if (!entry.behaviorTest || !fs.existsSync(path.join(appRoot, entry.behaviorTest))) {
      failures.push(`${entry.source} has no executable behavioral test.`);
    }
  }
  return { discovered, failures };
}
