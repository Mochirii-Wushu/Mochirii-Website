import path from "node:path";
import {
  APP_ROUTE_MATRIX_LIMITS,
  compareRedirectContracts,
  parseNextConfigLegacyRedirects,
  readNextConfigSource,
  validateAppRouteMatrix,
} from "./lib/app-router-inventory.mjs";

const root = process.cwd();
const appDirectory = path.join(root, "apps", "web", "app");
const matrixPath = path.join(root, "apps", "web", "config", "app-route-matrix.v1.json");
const nextConfigPath = path.join(root, "apps", "web", "next.config.ts");

const result = validateAppRouteMatrix({ appDirectory, matrixPath });
const failures = [];
let failureLimitReported = false;

function addFailures(values) {
  for (const value of values) {
    if (failures.length < APP_ROUTE_MATRIX_LIMITS.failures) {
      const message = String(value);
      failures.push(message.length <= APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters
        ? message
        : `${message.slice(0, APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters - 3)}...`);
      continue;
    }
    if (!failureLimitReported) {
      failures[APP_ROUTE_MATRIX_LIMITS.failures - 1] = `failure limit reached (${APP_ROUTE_MATRIX_LIMITS.failures}); additional diagnostics omitted`;
      failureLimitReported = true;
    }
    return;
  }
}

addFailures(result.failures);

if (result.matrix?.redirects) {
  try {
    const configuredRedirects = parseNextConfigLegacyRedirects(readNextConfigSource(nextConfigPath));
    addFailures(compareRedirectContracts(result.matrix.redirects, configuredRedirects));
  } catch {
    addFailures(["Next redirect contract could not be read or parsed [NEXT_REDIRECT_INPUT]"]);
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
