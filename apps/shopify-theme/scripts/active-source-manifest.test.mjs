import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_SOURCE_MANIFEST_PATH,
  ACTIVE_SOURCE_MANIFEST_SCHEMA_PATH,
  HISTORICAL_MIGRATION_MANIFEST_PATH,
  refreshActiveSourceManifest,
  resolveContainedManifestPath,
  sha256Bytes,
  validateActiveSourceManifest,
} from "./lib/active-source-manifest.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "../..");
const readRepo = (relativePath) => readFileSync(path.join(repoRoot, ...relativePath.split("/")));
const readJson = (relativePath) => JSON.parse(readRepo(relativePath).toString("utf8"));

test("the active-source manifest is the complete current hash authority", () => {
  const manifest = readJson(ACTIVE_SOURCE_MANIFEST_PATH);
  const schema = readJson(ACTIVE_SOURCE_MANIFEST_SCHEMA_PATH);
  assert.deepEqual(validateActiveSourceManifest(manifest, schema, appRoot, repoRoot), []);
  assert.deepEqual(refreshActiveSourceManifest(manifest, appRoot, repoRoot), manifest);
});

test("active-source hash and path drift fail closed", () => {
  const manifest = readJson(ACTIVE_SOURCE_MANIFEST_PATH);
  const schema = readJson(ACTIVE_SOURCE_MANIFEST_SCHEMA_PATH);
  manifest.files[0].sha256 = "0".repeat(64);
  assert.ok(validateActiveSourceManifest(manifest, schema, appRoot, repoRoot).some((issue) =>
    issue.includes("active-source SHA-256 mismatch")));

  const unsafe = readJson(ACTIVE_SOURCE_MANIFEST_PATH);
  unsafe.files[0].path = "apps/shopify-theme/..\\outside";
  assert.ok(validateActiveSourceManifest(unsafe, schema, appRoot, repoRoot).some((issue) =>
    issue.includes("invalid entry")));

  const weakenedSchema = structuredClone(schema);
  weakenedSchema.properties.authority.properties.publicationAuthorized = { type: "boolean" };
  assert.ok(validateActiveSourceManifest(readJson(ACTIVE_SOURCE_MANIFEST_PATH), weakenedSchema, appRoot, repoRoot)
    .some((issue) => issue.includes("schema identity or root contract")));
});

test("active-source paths reject file and directory symlinks", (t) => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "mochirii-active-source-"));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const repository = path.join(temporaryRoot, "repository");
  const outside = path.join(temporaryRoot, "outside");
  mkdirSync(repository);
  mkdirSync(outside);
  const regularFile = path.join(repository, "regular.txt");
  const outsideFile = path.join(outside, "outside.txt");
  writeFileSync(regularFile, "inside");
  writeFileSync(outsideFile, "outside");
  assert.equal(resolveContainedManifestPath(repository, regularFile, "file"), regularFile);
  assert.throws(() => resolveContainedManifestPath(repository, regularFile, "socket"), /file or directory/u);

  try {
    const fileLink = path.join(repository, "file-link.txt");
    const directoryLink = path.join(repository, "directory-link");
    symlinkSync(outsideFile, fileLink, "file");
    symlinkSync(outside, directoryLink, "junction");
    assert.throws(() => resolveContainedManifestPath(repository, fileLink, "file"), /symbolic links/u);
    assert.throws(() => resolveContainedManifestPath(repository, directoryLink, "directory"), /symbolic links/u);
  } catch (error) {
    if (error?.code === "EPERM") t.skip("The current Windows policy does not permit creating test symlinks.");
    else throw error;
  }
});

test("the migration manifest is byte-sealed and its former generator refuses writes", () => {
  const before = readRepo(HISTORICAL_MIGRATION_MANIFEST_PATH);
  assert.equal(sha256Bytes(before), "30e690423668ae0b2bc36bd3beac75e2044a267a41d5bbdd0ca1ac9b38b83a53");
  const result = spawnSync(process.execPath, [path.join(appRoot, "scripts/generate-migration-manifest.mjs")], {
    cwd: appRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /sealed migration-history evidence/u);
  assert.deepEqual(readRepo(HISTORICAL_MIGRATION_MANIFEST_PATH), before);
});
