import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const WINDOWS_CONTAINER_SKIP =
  "Windows-native workstation policy; container-backed validation runs in isolated GitHub-hosted CI.";

export function appendContainerToolchainChecks({ platform, commandCheck, recordSkip }) {
  if (platform === "win32") {
    recordSkip("local container backend", WINDOWS_CONTAINER_SKIP);
    return;
  }

  commandCheck("docker", "docker", ["--version"]);
  commandCheck("Docker daemon", "docker", ["info", "--format", "{{.ServerVersion}}"]);
}

export async function runLocalToolchainCheck({
  platform = process.platform,
  root = process.cwd(),
  spawn = spawnSync,
  pathExists = existsSync,
  loadPlaywright = () => import("playwright"),
  writeOutput = console.log,
  writeError = console.error,
} = {}) {
  const isWindows = platform === "win32";
  const bin = (name, cwd = root) => join(cwd, "node_modules", ".bin", isWindows ? `${name}.cmd` : name);
  const checks = [];

  function command(label, commandName, args = [], options = {}) {
    const commandLine = [commandName, ...args]
      .map((part) => `"${String(part).replaceAll('"', '""')}"`)
      .join(" ");
    const result = isWindows
      ? spawn(commandLine, { encoding: "utf8", shell: true, ...options })
      : spawn(commandName, args, { encoding: "utf8", ...options });
    checks.push({
      label,
      ok: result.status === 0,
      output: `${result.stdout || ""}${result.stderr || ""}${result.error?.message || ""}`.trim(),
    });
  }

  function requireVersion(label, actual, ok, hint) {
    checks.push({ label, ok, output: `${actual}${ok ? "" : `\n${hint}`}` });
  }

  const nodeVersion = process.versions.node;
  requireVersion("Node.js", nodeVersion, nodeVersion.startsWith("22."), "Run `fnm use 22.23.1` from the repo root.");

  const npmVersion = process.env.npm_config_user_agent?.match(/npm\/([^\s]+)/)?.[1] || "";
  checks.push({
    label: "npm",
    ok: /^10\./.test(npmVersion),
    output: npmVersion || "Unknown npm version. Run through `npm run toolchain:check`.",
  });

  for (const name of ["git", "gh", "magick", "fnm", "jq"]) {
    command(name, name, ["--version"]);
  }

  const denoResult = spawn("deno", ["--version"], { encoding: "utf8", shell: isWindows });
  const denoOutput = `${denoResult.stdout || ""}${denoResult.stderr || ""}`.trim();
  checks.push({
    label: "Deno",
    ok: denoResult.status === 0 && /^deno 2\.9\.4\b/m.test(denoOutput),
    output: `${denoOutput}${/^deno 2\.9\.4\b/m.test(denoOutput) ? "" : "\nRun `deno upgrade 2.9.4`."}`,
  });

  appendContainerToolchainChecks({
    platform,
    commandCheck: command,
    recordSkip: (label, output) => checks.push({ label, ok: true, skipped: true, output }),
  });

  const supabaseBin = bin("supabase");
  checks.push({ label: "local Supabase CLI", ok: pathExists(supabaseBin), output: supabaseBin });
  if (pathExists(supabaseBin)) command("Supabase CLI version", supabaseBin, ["--version"]);

  const lighthouseBin = bin("lighthouse");
  checks.push({ label: "local Lighthouse CLI", ok: pathExists(lighthouseBin), output: lighthouseBin });
  if (pathExists(lighthouseBin)) command("Lighthouse version", lighthouseBin, ["--version"]);

  try {
    await loadPlaywright();
    checks.push({ label: "Playwright package", ok: true, output: "installed" });
  } catch (error) {
    checks.push({ label: "Playwright package", ok: false, output: error.message });
  }

  const webRoot = join(root, "apps", "web");
  const vercelBin = bin("vercel", webRoot);
  checks.push({ label: "local Vercel CLI", ok: pathExists(vercelBin), output: vercelBin });
  if (pathExists(vercelBin)) command("Vercel CLI version", vercelBin, ["--version"], { cwd: webRoot });

  let failed = false;
  for (const check of checks) {
    const icon = check.skipped ? "SKIP" : check.ok ? "OK" : "FAIL";
    writeOutput(`${icon} ${check.label}${check.output ? `: ${check.output}` : ""}`);
    if (!check.skipped && !check.ok) failed = true;
  }

  if (failed) {
    writeError("\nLocal website toolchain check failed.");
    return 1;
  }

  writeOutput("\nLocal website toolchain check OK.");
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = await runLocalToolchainCheck();
}
