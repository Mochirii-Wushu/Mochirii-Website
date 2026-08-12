import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

const rawDestination = value("--destination");
const repositoryRoot = path.resolve(process.cwd());
const destination = path.resolve(rawDestination);
const relativeDestination = path.relative(repositoryRoot, destination);
const destinationIsInsideRepository = relativeDestination === "" ||
  (
    relativeDestination !== ".." &&
    !relativeDestination.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeDestination)
  );
const projectId = value("--project-id");
const portBase = Number.parseInt(value("--port-base"), 10);
if (!rawDestination || destinationIsInsideRepository || existsSync(destination)) {
  throw new Error("--destination must name a new, dedicated directory outside the repository root.");
}
if (!/^[a-z][a-z0-9-]{7,62}$/u.test(projectId)) {
  throw new Error("--project-id must be a non-secret local identifier using lowercase letters, numbers, and hyphens.");
}
if (!Number.isInteger(portBase) || portBase < 20000 || portBase > 64000) {
  throw new Error("--port-base must be an integer from 20000 through 64000.");
}
const reserved = new Set([54321, 54322, 54323, 54324, 54325, 54326, 54327]);
if (reserved.has(portBase) || reserved.has(portBase + 2)) {
  throw new Error("The local preview workdir must not use the shared Supabase port family.");
}

mkdirSync(destination, { recursive: false });
const source = path.resolve("supabase");
const target = path.join(destination, "supabase");
cpSync(source, target, {
  recursive: true,
  filter: (entry) => !/[\\/](?:\.branches|\.temp)(?:[\\/]|$)/u.test(entry),
});

const configPath = path.join(target, "config.toml");
const config = readFileSync(configPath, "utf8");
if (!/^project_id\s*=\s*"[^"]+"\s*$/mu.test(config)) {
  throw new Error("Supabase config is missing its project_id declaration.");
}
if (/^\[db\]\s*$/mu.test(config)) {
  throw new Error("Tracked config already defines [db]; update the local preview generator deliberately.");
}
const isolated = config.replace(
  /^project_id\s*=\s*"[^"]+"\s*$/mu,
  `project_id = "${projectId}"\n\n[db]\nport = ${portBase + 2}\nshadow_port = ${portBase}\nmajor_version = 17`,
);
writeFileSync(configPath, isolated, "utf8");
console.log(`Prepared isolated Supabase workdir at ${destination} (database port ${portBase + 2}).`);
