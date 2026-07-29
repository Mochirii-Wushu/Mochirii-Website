import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compareRedirectContracts,
  discoverAppRouterEntries,
  parseNextConfigLegacyRedirects,
  validateAppRouteMatrix,
} from "./app-router-inventory.mjs";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "mochirii-route-inventory-"));
  const app = path.join(root, "app");
  mkdirSync(path.join(app, "(public)", "article", "[slug]"), { recursive: true });
  mkdirSync(path.join(app, "api", "status"), { recursive: true });
  mkdirSync(path.join(app, "_components"), { recursive: true });
  writeFileSync(path.join(app, "page.tsx"), "export default function Page() { return null; }\n");
  writeFileSync(path.join(app, "(public)", "article", "[slug]", "page.tsx"), "export default function Page() { return null; }\n");
  writeFileSync(path.join(app, "api", "status", "route.ts"), "export async function GET() {}\nexport const POST = async () => {};\n");
  writeFileSync(path.join(app, "_components", "page.tsx"), "throw new Error('not a route');\n");
  return { root, app, matrix: path.join(root, "matrix.json") };
}

function writeMatrix(file, routes) {
  writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, publicSafe: true, routes, redirects: [] }, null, 2)}\n`);
}

test("discovers pages, route groups, dynamic segments, and explicit handler methods", () => {
  const current = fixture();
  try {
    assert.deepEqual(discoverAppRouterEntries(current.app), [
      { path: "/", kind: "page", source: "app/page.tsx" },
      { path: "/api/status", kind: "handler", source: "app/api/status/route.ts", methods: ["GET", "POST"] },
      { path: "/article/[slug]", kind: "page", source: "app/(public)/article/[slug]/page.tsx" },
    ]);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("fails closed when an App Router entry is undocumented", () => {
  const current = fixture();
  try {
    writeMatrix(current.matrix, [
      { path: "/", kind: "page", source: "app/page.tsx", surface: "public", productionSmoke: true },
      { path: "/api/status", kind: "handler", source: "app/api/status/route.ts", surface: "public", productionSmoke: false, methods: ["GET", "POST"] },
    ]);
    const result = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix });
    assert(result.failures.some((failure) => failure.includes("undocumented App Router page /article/[slug]")));
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("fails closed when handler method exports drift", () => {
  const current = fixture();
  try {
    writeMatrix(current.matrix, [
      { path: "/", kind: "page", source: "app/page.tsx", surface: "public", productionSmoke: true },
      { path: "/api/status", kind: "handler", source: "app/api/status/route.ts", surface: "public", productionSmoke: false, methods: ["GET"] },
      { path: "/article/[slug]", kind: "page", source: "app/(public)/article/[slug]/page.tsx", surface: "public", productionSmoke: false },
    ]);
    const result = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix });
    assert(result.failures.some((failure) => failure.includes("exports GET, POST; matrix records GET")));
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("parses and compares the Next legacy redirect tuple contract", () => {
  const parsed = parseNextConfigLegacyRedirects(`
    const legacyHtmlRedirects = [
      ["/tome.html", "/tome"],
      ["/social.html", "/social"],
    ] as const;
  `);
  assert.deepEqual(parsed, [
    { source: "/social.html", destination: "/social", permanent: true },
    { source: "/tome.html", destination: "/tome", permanent: true },
  ]);
  assert.deepEqual(compareRedirectContracts(parsed, parsed), []);
  assert.deepEqual(
    compareRedirectContracts(parsed, parsed.slice(0, 1)),
    ["documented redirect /tome.html -> /tome is absent from next.config.ts"],
  );
});
