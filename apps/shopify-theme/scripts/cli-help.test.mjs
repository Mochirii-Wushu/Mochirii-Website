import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(script, args) {
  return spawnSync(process.execPath, [path.join(appRoot, "scripts", script), ...args], {
    cwd: appRoot,
    encoding: "utf8",
    windowsHide: true,
  });
}

test("prepayment CLI help documents the npm passthrough and private boundary", () => {
  const result = run("check-prepayment-evidence.mjs", ["--help"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /npm run gate:prepayment-complete -- --bundle/u);
  assert.match(result.stdout, /[.]artifacts[/]operations/u);
  assert.match(result.stdout, /does not access or mutate Shopify/u);
});

test("provider-surface CLI help works through the gate alias argument shape", () => {
  const result = run("check-provider-surfaces.mjs", ["--require-provider-ready", "--help"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /npm run gate:provider-surfaces -- --private-readback/u);
  assert.match(result.stdout, /--candidate-theme-id <theme-id>/u);
  assert.match(result.stdout, /--package-sha256 <sha256>/u);
  assert.match(result.stdout, /does not access or mutate Shopify/u);
});

test("invalid gate arguments remain fail closed", () => {
  const prepayment = run("check-prepayment-evidence.mjs", []);
  assert.equal(prepayment.status, 2);
  assert.match(prepayment.stderr, /category=arguments/u);

  const provider = run("check-provider-surfaces.mjs", ["--require-provider-ready", "--private-readback", "missing.json"]);
  assert.equal(provider.status, 2);
  assert.match(provider.stderr, /category=arguments/u);
});
