import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = process.cwd();
const checkerPath = path.join(repoRoot, "scripts", "check-cross-repository-contract-registry.mjs");
const registryPath = path.join(
  repoRoot,
  "docs",
  "integrations",
  "cross-repository-contract-registry.v1.json",
);
const canonicalRegistry = JSON.parse(readFileSync(registryPath, "utf8"));

function runChecker(registry) {
  const fixtureDirectory = mkdtempSync(path.join(tmpdir(), "mochirii-contract-registry-"));
  const fixturePath = path.join(fixtureDirectory, "registry.json");
  writeFileSync(fixturePath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

  try {
    return spawnSync(process.execPath, [checkerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MOCHIRII_CROSS_REPOSITORY_REGISTRY_TEST_FIXTURE: fixturePath,
      },
    });
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
}

test("accepts the reviewed Website-owned registry", () => {
  const result = runChecker(structuredClone(canonicalRegistry));
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("rejects an incomplete repository inventory regardless of length", () => {
  const registry = structuredClone(canonicalRegistry);
  registry.repositories = registry.repositories.filter(
    (repository) => repository !== "Mochirii-Wushu/Mochirii-Forums",
  );

  const result = runChecker(registry);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /registry\.repositories must contain the exact expected string set/);
});

test("rejects Reaper as a shared-contract producer", () => {
  const registry = structuredClone(canonicalRegistry);
  const contract = registry.contracts.find(({ id }) => id === "member-synchronization");
  contract.producerRepositories = ["Mochirii-Wushu/Reaper-Discord-Bot"];

  const result = runChecker(registry);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not assign Reaper shared-contract producer ownership/);
});

test("rejects an additional producer on a Website-owned contract", () => {
  const registry = structuredClone(canonicalRegistry);
  const contract = registry.contracts.find(({ id }) => id === "website-session-guild-entitlement");
  contract.producerRepositories.push("Mochirii-Wushu/Mochirii-Social");

  const result = runChecker(registry);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /website-session-guild-entitlement\.producerRepositories must contain the exact expected string set/,
  );
});

test("rejects Website as the Unity artifact producer", () => {
  const registry = structuredClone(canonicalRegistry);
  const contract = registry.contracts.find(({ id }) => id === "unity-artifact-manifest");
  contract.producerRepositories = ["Mochirii-Wushu/Mochirii-Website"];

  const result = runChecker(registry);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /unity-artifact-manifest\.producerRepositories must contain the exact expected string set/,
  );
});

test("rejects an unapproved Social cutover claim", () => {
  const registry = structuredClone(canonicalRegistry);
  registry.ownership.socialTargetStatus = "cut_over";

  const result = runChecker(registry);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /future-staged without a cutover claim/);
});
