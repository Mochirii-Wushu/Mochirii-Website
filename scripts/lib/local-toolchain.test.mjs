import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { appendContainerToolchainChecks, runLocalToolchainCheck } from "../check-local-toolchain.mjs";
import { CHECK_PLAN, runAllChecks } from "../check-all.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const checkerPath = join(root, "scripts", "check-local-toolchain.mjs");
const npmUserAgent = "npm/10.9.8 node/v22.23.1 win32 x64 workspaces/false";

function successfulSpawn(calls) {
  return (...args) => {
    calls.push(args);
    if (args[0] === "deno") {
      return { status: 0, stdout: "deno 2.9.4\n", stderr: "" };
    }
    return { status: 0, stdout: "ok\n", stderr: "" };
  };
}

async function withNpmUserAgent(callback) {
  const previous = process.env.npm_config_user_agent;
  process.env.npm_config_user_agent = npmUserAgent;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = previous;
  }
}

test("Windows local toolchain dispatches no container commands", () => {
  const commands = [];
  const skips = [];

  appendContainerToolchainChecks({
    platform: "win32",
    commandCheck: (...args) => commands.push(args),
    recordSkip: (...args) => skips.push(args),
  });

  assert.deepEqual(commands, []);
  assert.deepEqual(skips, [
    [
      "local container backend",
      "Windows-native workstation policy; container-backed validation runs in isolated GitHub-hosted CI.",
    ],
  ]);
});

test("non-Windows toolchain retains exact container checks", () => {
  const commands = [];
  const skips = [];

  appendContainerToolchainChecks({
    platform: "linux",
    commandCheck: (...args) => commands.push(args),
    recordSkip: (...args) => skips.push(args),
  });

  assert.deepEqual(skips, []);
  assert.deepEqual(commands, [
    ["docker", "docker", ["--version"]],
    ["Docker daemon", "docker", ["info", "--format", "{{.ServerVersion}}"]],
  ]);
});

test("actual Windows runner skips containers and retains all native checks", async () => {
  const calls = [];
  const output = [];
  const errors = [];

  const result = await withNpmUserAgent(() =>
    runLocalToolchainCheck({
      platform: "win32",
      root,
      spawn: successfulSpawn(calls),
      pathExists: () => true,
      loadPlaywright: async () => ({}),
      writeOutput: (line) => output.push(line),
      writeError: (line) => errors.push(line),
    }),
  );

  assert.equal(result, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    output.filter((line) => line.startsWith("SKIP ")),
    [
      "SKIP local container backend: Windows-native workstation policy; container-backed validation runs in isolated GitHub-hosted CI.",
    ],
  );
  assert.match(output.at(-1), /Local website toolchain check OK\./);
  const serializedCalls = JSON.stringify(calls).toLowerCase();
  assert.doesNotMatch(serializedCalls, /docker|(?:^|[^a-z])wsl(?:[^a-z]|$)|(?:^|[^a-z])bash(?:[^a-z]|$)/);
  assert.equal(calls.some(([command]) => command === "deno"), true);
  assert.equal(calls.some(([command]) => String(command).includes("supabase.cmd")), true);
  assert.equal(calls.some(([command]) => String(command).includes("lighthouse.cmd")), true);
  assert.equal(calls.some(([command]) => String(command).includes("vercel.cmd")), true);
});

test("actual Linux runner requires the exact Docker CLI and daemon calls", async () => {
  const calls = [];
  const output = [];

  const result = await withNpmUserAgent(() =>
    runLocalToolchainCheck({
      platform: "linux",
      root,
      spawn: successfulSpawn(calls),
      pathExists: () => true,
      loadPlaywright: async () => ({}),
      writeOutput: (line) => output.push(line),
      writeError: () => assert.fail("successful runner emitted an error"),
    }),
  );

  assert.equal(result, 0);
  assert.deepEqual(
    calls.filter(([command]) => command === "docker"),
    [
      ["docker", ["--version"], { encoding: "utf8" }],
      ["docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" }],
    ],
  );
  assert.equal(output.some((line) => line.startsWith("SKIP ")), false);
});

test("actual runner propagates command, binary, and package failures", async (context) => {
  await context.test("a skipped Windows container row cannot mask a command failure", async () => {
    const calls = [];
    const spawn = successfulSpawn(calls);
    const result = await withNpmUserAgent(() =>
      runLocalToolchainCheck({
        platform: "win32",
        root,
        spawn: (...args) =>
          String(args[0]).startsWith('"git"')
            ? { status: 1, stdout: "", stderr: "fixed failure" }
            : spawn(...args),
        pathExists: () => true,
        loadPlaywright: async () => ({}),
        writeOutput: () => {},
        writeError: () => {},
      }),
    );
    assert.equal(result, 1);
  });

  await context.test("missing local binaries remain terminal failures", async () => {
    const result = await withNpmUserAgent(() =>
      runLocalToolchainCheck({
        platform: "win32",
        root,
        spawn: successfulSpawn([]),
        pathExists: () => false,
        loadPlaywright: async () => ({}),
        writeOutput: () => {},
        writeError: () => {},
      }),
    );
    assert.equal(result, 1);
  });

  await context.test("Playwright load failure remains terminal", async () => {
    const result = await withNpmUserAgent(() =>
      runLocalToolchainCheck({
        platform: "win32",
        root,
        spawn: successfulSpawn([]),
        pathExists: () => true,
        loadPlaywright: async () => {
          throw new Error("fixed failure");
        },
        writeOutput: () => {},
        writeError: () => {},
      }),
    );
    assert.equal(result, 1);
  });
});

test("module import is inert", () => {
  const moduleUrl = pathToFileURL(checkerPath).href;
  const imported = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", "await import(" + JSON.stringify(moduleUrl) + ");"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");
});

test("actual Windows CLI entrypoint executes the native preflight", { skip: process.platform !== "win32" }, () => {
  const cli = spawnSync(process.execPath, [checkerPath], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_user_agent: npmUserAgent },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Local website toolchain check OK\./);
  assert.match(cli.stdout, /SKIP local container backend:/);
  assert.doesNotMatch(cli.stdout, /(?:^|\n)(?:OK|FAIL) Docker?(?: daemon)?:/);
});

test("package and immutable aggregate plan bind the exact focused test once", () => {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["test:local-toolchain"], "node --test scripts/lib/local-toolchain.test.mjs");
  assert.equal(packageJson.scripts["toolchain:check"], "node scripts/check-local-toolchain.mjs");

  const expected = ["node", "--test", "scripts/lib/local-toolchain.test.mjs"];
  const matches = CHECK_PLAN.filter(([label, command]) =>
    label === "test:local-toolchain" && command.length === expected.length
      && command.every((value, index) => value === expected[index]));
  assert.equal(matches.length, 1);
  assert.equal(Object.isFrozen(CHECK_PLAN), true);
  assert.equal(Object.isFrozen(matches[0]), true);
  assert.equal(Object.isFrozen(matches[0][1]), true);
});

test("aggregate runner consumes the exact exported plan and module import stays inert", () => {
  const calls = [];
  const output = [];
  const errors = [];
  assert.equal(runAllChecks({
    runSuite: (plan) => {
      calls.push(plan);
      return true;
    },
    writeOutput: (line) => output.push(line),
    writeError: (line) => errors.push(line),
  }), true);
  assert.deepEqual(calls, [CHECK_PLAN]);
  assert.deepEqual(errors, []);
  assert.deepEqual(output, ["\nAll validation checks completed."]);

  const checkAllUrl = pathToFileURL(join(root, "scripts", "check-all.mjs")).href;
  const imported = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", "await import(" + JSON.stringify(checkAllUrl) + ");"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");
});
