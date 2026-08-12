import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const EXPECTED_FUNCTION_COUNT = 33;
export const EXPECTED_VERIFY_JWT_TRUE = 20;
export const EXPECTED_VERIFY_JWT_FALSE = 13;

const ownedRootFiles = new Set([
  "deno.lock",
  "deno-spotlight-poll.import_map.json",
  "package.json",
  "package-lock.json",
]);

const ownedScriptPattern = /^scripts\/(?:check|detect|prepare|run|test|verify)-supabase-[^/]+\.mjs$/u;
const ownedLibraryPattern = /^scripts\/lib\/supabase-[^/]+\.mjs$/u;

export function normalizeRepositoryPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function isSupabaseCiOwnedPath(value) {
  const file = normalizeRepositoryPath(value);
  return file.startsWith("supabase/") ||
    ownedRootFiles.has(file) ||
    ownedScriptPattern.test(file) ||
    ownedLibraryPattern.test(file) ||
    file === ".github/workflows/validate-supabase-local-preview.yml";
}

export function classifySupabaseChanges(files) {
  const normalized = [...new Set(files.map(normalizeRepositoryPath).filter(Boolean))].sort();
  const owned = normalized.filter(isSupabaseCiOwnedPath);
  return {
    changed: owned.length > 0,
    files: normalized,
    owned,
  };
}

export function migrationVersions(migrationsDirectory) {
  const entries = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  const versions = [];
  const seen = new Set();

  for (const file of entries) {
    const match = file.match(/^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/u);
    if (!match) {
      throw new Error(`Invalid Supabase migration filename: ${file}`);
    }
    if (seen.has(match[1])) {
      throw new Error(`Duplicate Supabase migration version: ${match[1]}`);
    }
    seen.add(match[1]);
    versions.push(match[1]);
  }

  if (versions.length === 0) {
    throw new Error("No Supabase migrations were found.");
  }
  return versions;
}

export function parseFunctionInventory(configText, functionsDirectory) {
  const configured = [];
  const source = `${String(configText || "").trimEnd()}\n[local_preview_end]\n`;
  const blockPattern = /^\[functions\.([^\]]+)\]\s*$([\s\S]*?)(?=^\[)/gmu;
  for (const match of source.matchAll(blockPattern)) {
    const name = match[1];
    const body = match[2];
    const enabled = body.match(/^enabled\s*=\s*(true|false)\s*$/mu)?.[1];
    const verifyJwt = body.match(/^verify_jwt\s*=\s*(true|false)\s*$/mu)?.[1];
    const importMap = body.match(/^import_map\s*=\s*"([^"]+)"\s*$/mu)?.[1];
    const entrypoint = body.match(/^entrypoint\s*=\s*"([^"]+)"\s*$/mu)?.[1];
    if (enabled !== "true") throw new Error(`${name}: enabled must remain true.`);
    if (!verifyJwt) throw new Error(`${name}: verify_jwt must be explicit.`);
    if (importMap !== `./functions/${name}/deno.json`) {
      throw new Error(`${name}: import_map must target its function-local deno.json.`);
    }
    if (entrypoint !== `./functions/${name}/index.ts`) {
      throw new Error(`${name}: entrypoint must target its function-local index.ts.`);
    }
    configured.push({ name, verifyJwt: verifyJwt === "true" });
  }

  const discovered = readdirSync(functionsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const directory = path.join(functionsDirectory, entry.name);
      try {
        readFileSync(path.join(directory, "deno.json"));
        readFileSync(path.join(directory, "index.ts"));
        return true;
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort();
  const configuredNames = configured.map(({ name }) => name).sort();

  if (JSON.stringify(configuredNames) !== JSON.stringify(discovered)) {
    throw new Error(
      `Supabase function inventory mismatch. Configured: ${configuredNames.join(", ")}; discovered: ${discovered.join(", ")}`,
    );
  }

  const verifyJwtTrue = configured.filter(({ verifyJwt }) => verifyJwt).length;
  const verifyJwtFalse = configured.length - verifyJwtTrue;
  return {
    count: configured.length,
    verifyJwtTrue,
    verifyJwtFalse,
    names: configuredNames,
  };
}
