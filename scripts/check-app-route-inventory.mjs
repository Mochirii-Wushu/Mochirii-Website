import { readFileSync } from "node:fs";
import path from "node:path";
import {
  compareRedirectContracts,
  parseNextConfigLegacyRedirects,
  validateAppRouteMatrix,
} from "./lib/app-router-inventory.mjs";

const root = process.cwd();
const appDirectory = path.join(root, "apps", "web", "app");
const matrixPath = path.join(root, "apps", "web", "config", "app-route-matrix.v1.json");
const nextConfigPath = path.join(root, "apps", "web", "next.config.ts");

const result = validateAppRouteMatrix({ appDirectory, matrixPath });
const failures = [...result.failures];

if (result.matrix?.redirects) {
  try {
    const configuredRedirects = parseNextConfigLegacyRedirects(readFileSync(nextConfigPath, "utf8"));
    failures.push(...compareRedirectContracts(result.matrix.redirects, configuredRedirects));
  } catch (error) {
    failures.push(`Next redirect contract could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error(`App route inventory validation failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

const pages = result.discovered.filter((entry) => entry.kind === "page").length;
const handlers = result.discovered.length - pages;
console.log(`App route inventory OK (${pages} pages, ${handlers} handlers, ${result.matrix.redirects.length} redirects).`);
