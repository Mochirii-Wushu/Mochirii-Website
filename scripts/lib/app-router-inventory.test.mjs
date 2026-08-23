import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  APP_ROUTE_MATRIX_LIMITS,
  HTTP_METHODS,
  compareRedirectContracts,
  discoverAppRouterEntries,
  parseNextConfigLegacyRedirects,
  parseNextConfigLegacyRedirectsUnpinnedForTest as parseRedirectFixture,
  readAppRouteMatrix,
  readNextConfigSource,
  validateAppRouteMatrix,
} from "./app-router-inventory.mjs";
import {
  PRODUCTION_SMOKE_HTML_BYTE_LIMIT,
  assertExpectedRouteUrl,
  assertPermanentRedirectStatus,
  checkBody,
  checkBrandedNotFound,
  loadProductionSmokeContract,
  readBoundedHtmlResponse,
  resolveSameOriginRedirect,
} from "../smoke-vercel-production.mjs";
import {
  OBSERVABILITY_DIAGNOSTIC_LIMITS,
  checkLiveIfRequested,
  createObservabilityFailureRecorder,
  resolveSameOriginMetadataImage,
} from "../check-observability-metadata-smoke.mjs";

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

function writeMatrix(file, routes, redirects = []) {
  writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, publicSafe: true, routes, redirects }, null, 2)}\n`);
}

const productionAppDirectory = fileURLToPath(new URL("../../apps/web/app/", import.meta.url));
const productionMatrixPath = fileURLToPath(new URL("../../apps/web/config/app-route-matrix.v1.json", import.meta.url));
const productionNextConfigPath = fileURLToPath(new URL("../../apps/web/next.config.ts", import.meta.url));
const appRouteCheckerPath = fileURLToPath(new URL("../check-app-route-inventory.mjs", import.meta.url));
const contentGuardrailsPath = fileURLToPath(new URL("../check-content-guardrails.mjs", import.meta.url));
const raffleCheckerPath = fileURLToPath(new URL("../check-raffle-closed-state.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const productionRouteMatrix = readAppRouteMatrix(productionMatrixPath);
const productionRedirects = parseNextConfigLegacyRedirects(readNextConfigSource(productionNextConfigPath));

function completeRoutes() {
  return [
    { path: "/", kind: "page", source: "app/page.tsx", surface: "public", productionSmoke: true },
    { path: "/api/status", kind: "handler", source: "app/api/status/route.ts", surface: "public", productionSmoke: false, methods: ["GET", "POST"] },
    { path: "/article/[slug]", kind: "page", source: "app/(public)/article/[slug]/page.tsx", surface: "public", productionSmoke: false },
  ];
}

test("discovers pages, route groups, dynamic segments, and explicit handler methods", () => {
  const current = fixture();
  try {
    mkdirSync(path.join(current.app, "(.staff)", "team"), { recursive: true });
    writeFileSync(path.join(current.app, "(.staff)", "team", "page.tsx"), "export default function Page() { return null; }\n");
    assert.deepEqual(discoverAppRouterEntries(current.app), [
      { path: "/", kind: "page", source: "app/page.tsx" },
      { path: "/api/status", kind: "handler", source: "app/api/status/route.ts", methods: ["GET", "POST"] },
      { path: "/article/[slug]", kind: "page", source: "app/(public)/article/[slug]/page.tsx" },
      { path: "/team", kind: "page", source: "app/(.staff)/team/page.tsx" },
    ]);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("masks an initial hashbang before discovering handler exports", async () => {
  const current = fixture();
  try {
    for (const prefix of ["", "\uFEFF"]) {
      for (const terminator of ["\r", "\n", "\r\n", "\u2028", "\u2029"]) {
        const source = `${prefix}#! export function DELETE() {}${terminator}export function GET() {}${terminator}`;
        const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
        assert.deepEqual(Object.keys(namespace).filter((name) => HTTP_METHODS.includes(name)), ["GET"]);
        writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
        assert.deepEqual(
          discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
          ["GET"],
        );
      }
    }
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("ignores method-like text in comments, strings, regex literals, and ASI-boundary regex statements", async () => {
  const current = fixture();
  try {
    writeFileSync(path.join(current.app, "api", "status", "route.ts"), `
      const quoted = "export function DELETE() {}";
      const templated = \`export const PUT = async () => {};\`;
      const expression = /export\\s+function\\s+HEAD/;
      const hostile = /; export function DELETE\\b/;
      if (ready) /; export function DELETE\\b/.test(value);
      while (ready) /; export function DELETE\\b/.test(value);
      for (; ready;) /; export function DELETE\\b/.test(value);
      // export async function OPTIONS() {}
      /* export const PATCH = async () => {}; */
      export async function GET() {}
      const handler = async () => {};
      export { handler as POST };
    `);
    assert.deepEqual(discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods, ["GET", "POST"]);

    for (const source of [
      `import "node:path"\n/; export function DELETE\\b/.test(value);`,
      `export { sep as pathSeparator } from "node:path"\n/; export function DELETE\\b/.test(value);`,
      `while (ready) { break\n/; export function DELETE\\b/.test(value); }`,
      `while (ready) { continue\n/; export function DELETE\\b/.test(value); }`,
      `debugger\n/; export function DELETE\\b/.test(value);`,
      `const make = () => new /; export function DELETE\\b/;`,
      `const \u03c0export = true;\n\u03c0export\nfunction DELETE() {}`,
    ]) {
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), `${source}\nexport async function GET() {}`);
      assert.deepEqual(
        discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
        ["GET"],
      );
    }

    for (const terminator of ["\r", "\n", "\r\n", "\u2028", "\u2029"]) {
      for (const declaration of [
        "let value",
        "var value",
        "let initialized = 1, value",
        "var initialized = 1, value",
      ]) {
        const source = `${declaration}${terminator}/; export function DELETE\\b/.test("");${terminator}export function GET() {}`;
        const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
        assert.deepEqual(Object.keys(namespace).filter((name) => HTTP_METHODS.includes(name)), ["GET"]);
        writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
        assert.throws(
          () => discoverAppRouterEntries(current.app),
          /unsupported route handler export declaration/,
        );
      }
    }

    for (const source of [
      `let value // declaration comment\n/; export function DELETE\\b/.test("");\nexport function GET() {}`,
      `var value /* declaration\ncomment */ /; export function DELETE\\b/.test("");\nexport function GET() {}`,
    ]) {
      const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
      assert.deepEqual(Object.keys(namespace).filter((name) => HTTP_METHODS.includes(name)), ["GET"]);
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
      assert.throws(
        () => discoverAppRouterEntries(current.app),
        /unsupported route handler export declaration/,
      );
    }

    const typescriptDeclarations = [
      "type Marker = string",
      "export type Marker = string",
      "declare let value: number",
      "declare var value: number",
      "declare const value: number",
      "export declare let value: number",
      "export declare var value: number",
      "export declare const value: number",
      "let value: number",
      "var value: number",
      "let value!: number",
      "declare function helper(): number",
      "export declare function helper(): number",
    ];
    for (const declaration of typescriptDeclarations) {
      const routeFile = path.join(current.app, "api", "status", "route.ts");
      const source = `${declaration}\n/; export function DELETE\\b/.test("");\nexport function GET() {}`;
      writeFileSync(routeFile, source);
      const runtimeProbe = `
        const namespace = await import(${JSON.stringify(pathToFileURL(routeFile).href)});
        process.stdout.write(JSON.stringify(Object.keys(namespace).filter((name) => ${JSON.stringify(HTTP_METHODS)}.includes(name))));
      `;
      const outcome = spawnSync(process.execPath, [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        runtimeProbe,
      ], {
        encoding: "utf8",
        windowsHide: true,
      });
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.status, 0, outcome.stderr);
      assert.deepEqual(JSON.parse(outcome.stdout), ["GET"]);
      assert.throws(
        () => discoverAppRouterEntries(current.app),
        /unsupported route handler export declaration/,
      );
    }

    writeFileSync(
      path.join(current.app, "api", "status", "route.ts"),
      `const quotient = 8\n/ 2; export function POST() {}\nconst pattern = /x/; export function GET() { return [quotient, pattern]; }`,
    );
    assert.deepEqual(
      discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
      ["GET", "POST"],
    );

    writeFileSync(
      path.join(current.app, "api", "status", "route.ts"),
      "export const GET\u03c0 = async () => {};\nexport async function POST() {}\n",
    );
    assert.deepEqual(
      discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
      ["POST"],
    );

    writeFileSync(
      path.join(current.app, "api", "status", "route.ts"),
      "export const helper = 1, DELETE = async () => {};\nexport async function POST() {}\n",
    );
    assert.deepEqual(
      discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
      ["POST", "DELETE"],
    );

    writeFileSync(
      path.join(current.app, "api", "status", "route.ts"),
      "let DELETE;\nexport const helper = 1\nvoid 0, DELETE = async () => {};\nexport async function POST() {}\n",
    );
    assert.throws(
      () => discoverAppRouterEntries(current.app),
      /unsupported route handler export declaration/,
    );

    writeFileSync(
      path.join(current.app, "api", "status", "route.ts"),
      "const handler = async () => {};\nexport { handler as \\u0048EAD };\nexport { handler as \"PATCH\" };\nexport async function POST() {}\n",
    );
    assert.deepEqual(
      discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
      ["POST", "PATCH", "HEAD"],
    );

    writeFileSync(
      path.join(current.app, "api", "status", "route.ts"),
      "export const GET\\u03c0 = async () => {};\nexport async function POST() {}\n",
    );
    assert.deepEqual(
      discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
      ["POST"],
    );

    for (const terminator of ["\r", "\n", "\r\n", "\u2028", "\u2029"]) {
      writeFileSync(
        path.join(current.app, "api", "status", "route.ts"),
        `// export function DELETE() {}${terminator}export async function GET() {}`,
      );
      assert.deepEqual(
        discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
        ["GET"],
      );
    }
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("matches the runtime HTTP namespace around default-export regex literals", async () => {
  const current = fixture();
  try {
    for (const source of [
      `export default /; export function DELETE\\b/;
export function GET() {}
`,
      `const object = { default: 8 };
const quotient = object.default / 2;
/; export function DELETE\\b/.test(String(quotient));
export function GET() {}
`,
      `export /* retained trivia */ default /; export function POST\\b/;
export function GET() {}
`,
    ]) {
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
      const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
      const runtimeMethods = Object.keys(namespace).filter((name) => HTTP_METHODS.includes(name));
      assert.deepEqual(runtimeMethods, ["GET"]);
      assert.deepEqual(
        discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
        runtimeMethods,
      );
    }
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("masks slash-equals regex literals without misclassifying division assignment", async () => {
  const current = fixture();
  try {
    for (const source of [
      `const pattern = /=; export function DELETE/;
export function GET() { return pattern; }
`,
      `export default /=; export function DELETE/;
export function GET() {}
`,
      `if (false) /=; export function DELETE/.test("");
export function GET() {}
`,
      `let quotient = 8;
quotient /= 2;
export function GET() { return quotient; }
`,
    ]) {
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
      const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
      const runtimeMethods = Object.keys(namespace).filter((name) => HTTP_METHODS.includes(name));
      assert.deepEqual(runtimeMethods, ["GET"]);
      assert.deepEqual(
        discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
        runtimeMethods,
      );
    }

    const ambiguousStatement = `{}
/=; export function DELETE/.test("");
export function GET() {}
`;
    writeFileSync(path.join(current.app, "api", "status", "route.ts"), ambiguousStatement);
    const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(ambiguousStatement)}`);
    assert.deepEqual(Object.keys(namespace), ["GET"]);
    assert.throws(
      () => discoverAppRouterEntries(current.app),
      /unsupported route handler export declaration/,
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("preserves expression context for contextual identifiers and keyword-named properties", async () => {
  const current = fixture();
  try {
    const sources = [
      `const of = 4; const result = of / 2; export function POST() {} const pattern = /x/; export function GET() { return [result, pattern]; }`,
      `function probe(of) { const result = of / 2; return result; } const result = probe(4); export function POST() {} const pattern = /x/; export function GET() { return [result, pattern]; }`,
      ...["return", "delete", "void", "new", "case", "throw", "await", "yield", "in", "instanceof", "of"].map((property) => `const object = { ${property}: 4 }; const result = object.${property} / 2; export function POST() {} const pattern = /x/; export function GET() { return [result, pattern]; }`),
      `const object = { return: 4 }; const result = object?.return / 2; export function POST() {} const pattern = /x/; export function GET() { return [result, pattern]; }`,
      `const object = { new: 4 }; object.new /= 2; export function POST() {} const pattern = /x/; export function GET() { return [object.new, pattern]; }`,
      `class Holder { #return = 4; read() { return this.#return / 2; } } const result = new Holder().read(); export function POST() {} const pattern = /x/; export function GET() { return [result, pattern]; }`,
      `function probe() { return [...delete /]}; export function DELETE/]; } export function POST() {} const pattern = /x/; export function GET() { return pattern; }`,
    ];

    for (const source of sources) {
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
      const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
      const runtimeMethods = Object.keys(namespace).filter((name) => HTTP_METHODS.includes(name));
      assert.deepEqual(runtimeMethods, ["GET", "POST"]);
      assert.deepEqual(
        discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
        runtimeMethods,
      );
    }

    const ambiguousForOf = `for (const match of /; export function DELETE/.exec("") ?? []) { void match; }
export function GET() {}
`;
    writeFileSync(path.join(current.app, "api", "status", "route.ts"), ambiguousForOf);
    const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(ambiguousForOf)}`);
    assert.deepEqual(Object.keys(namespace), ["GET"]);
    assert.throws(
      () => discoverAppRouterEntries(current.app),
      /unsupported route handler export declaration/,
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("fails closed on ambiguous TypeScript postfix expressions before division", () => {
  const current = fixture();
  try {
    const routeFile = path.join(current.app, "api", "status", "route.ts");
    const ambiguousSources = [
      `let value: number | null = 1; value! /= 2; export function POST() {} const pattern = /x/; export function GET() { return [value, pattern]; }`,
      `let value: number | null = 1; const result = value! / 2; export function POST() {} const pattern = /x/; export function GET() { return [result, pattern]; }`,
      `const foo = <T>() => 4; const result = foo<number> / 2; export function POST() {} const pattern = /x/; export function GET() { return [result, pattern]; }`,
      `const foo = <T>() => 4; const result = foo<Map<string, number>> / 2; export function POST() {} const pattern = /x/; export function GET() { return [result, pattern]; }`,
    ];

    for (const source of ambiguousSources) {
      writeFileSync(routeFile, source);
      const runtimeProbe = `
        const namespace = await import(${JSON.stringify(pathToFileURL(routeFile).href)});
        process.stdout.write(JSON.stringify(Object.keys(namespace).filter((name) => ${JSON.stringify(HTTP_METHODS)}.includes(name))));
      `;
      const outcome = spawnSync(process.execPath, [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        runtimeProbe,
      ], {
        encoding: "utf8",
        windowsHide: true,
      });
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.status, 0, outcome.stderr);
      assert.deepEqual(JSON.parse(outcome.stdout), ["GET", "POST"]);
      assert.throws(
        () => discoverAppRouterEntries(current.app),
        /unsupported route handler export declaration/,
      );
    }

    for (const source of [
      `let value: number | null = 1;
const result = (value!) / 2;
export function POST() {}
const pattern = /x/;
export function GET() { return [result, pattern]; }
`,
      `const foo = <T>() => 4;
const result = (foo<number>) / 2;
export function POST() {}
const pattern = /x/;
export function GET() { return [result, pattern]; }
`,
    ]) {
      writeFileSync(routeFile, source);
      assert.deepEqual(
        discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
        ["GET", "POST"],
      );
    }
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("matches the runtime namespace across an astral identifier export boundary", async () => {
  const current = fixture();
  try {
    for (const source of [`const 𐐀export = 1;
𐐀export
function DELETE() {}
export function GET() {}
`, `const 𐐀 = 4;
const value = 𐐀 / 2; /; export function DELETE\\b/.test(String(value));
export function GET() {}
`, `const \\u{61}export = 1;
\\u{61}export;
function DELETE() {}
export function GET() {}
`]) {
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
      const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
      assert.deepEqual(Object.keys(namespace), ["GET"]);
      assert.deepEqual(
        discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
        Object.keys(namespace),
      );
    }
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("fails closed on exported handler destructuring that the inventory does not parse", async () => {
  const current = fixture();
  try {
    for (const source of [
      `export const { GET } = { GET: async () => {} };
export async function POST() {}
`,
      `const handler = async () => {};
export const { source: GET = handler, ...rest } = { source: handler };
export async function POST() {}
`,
      `const handler = async () => {};
export const [GET = handler, ...rest] = [handler];
export async function POST() {}
`,
    ]) {
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
      const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
      assert.deepEqual(
        Object.keys(namespace).filter((name) => ["GET", "POST"].includes(name)),
        ["GET", "POST"],
      );
      assert.throws(
        () => discoverAppRouterEntries(current.app),
        /unsupported route handler export declaration/,
      );
    }
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("fails closed on other runtime export forms outside the supported inventory grammar", async () => {
  const current = fixture();
  try {
    for (const source of [
      `export * from "data:text/javascript,export%20function%20GET()%7B%7D";
export function POST() {}
`,
      `export * as GET from "data:text/javascript,export%20default%200";
export function POST() {}
`,
      `export class GET {}
export function POST() {}
`,
      `export async function* GET() {}
export function POST() {}
`,
      `export const
GET = async () => {};
export function POST() {}
`,
      `export const helper = 1,
GET = async () => {};
export function POST() {}
`,
      `export const GET = async () => {}
export function POST() {}
`,
    ]) {
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
      const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
      assert.deepEqual(
        Object.keys(namespace).filter((name) => ["GET", "POST"].includes(name)),
        ["GET", "POST"],
      );
      assert.throws(
        () => discoverAppRouterEntries(current.app),
        /unsupported route handler export declaration/,
      );
    }
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("fails closed on quoted runtime export names with unsupported JavaScript escapes", async () => {
  const current = fixture();
  try {
    for (const [method, exported] of [
      ["GET", `"G\\x45T"`],
      ["HEAD", `'H\\u0045AD'`],
      ["PATCH", `"P\\u{41}TCH"`],
    ]) {
      const source = `const handler = () => {};
export { handler as ${exported} };
export function POST() {}
`;
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
      const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
      assert.deepEqual(
        Object.keys(namespace).filter((name) => [method, "POST"].includes(name)),
        [method, "POST"].sort(),
      );
      assert.throws(
        () => discoverAppRouterEntries(current.app),
        /unsupported route handler export declaration/,
      );
    }
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("fails closed when a property named export could masquerade as a declaration", async () => {
  const current = fixture();
  try {
    for (const source of [
      `const object = { export: 1 };
object.export
function DELETE() {}
export function GET() {}
`,
      `const object = { export: 1 };
object?.export
function DELETE() {}
export function GET() {}
`,
      `const object = { export: 1 };
object.
export
function DELETE() {}
export function GET() {}
`,
    ]) {
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
      const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
      assert.deepEqual(Object.keys(namespace), ["GET"]);
      assert.throws(
        () => discoverAppRouterEntries(current.app),
        /unsupported route handler export declaration/,
      );
    }
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("fails closed on slash ambiguity after block, class, or function bodies", async () => {
  const current = fixture();
  try {
    const regexStatement = `/; export function POST\\b/.test("");`;
    for (const prefix of ["{}", "ready: {}", "class Ready {}", "function ready() {}"]) {
      const source = `${prefix}
${regexStatement}
export function GET() {}
`;
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
      const namespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
      assert.deepEqual(Object.keys(namespace), ["GET"]);
      assert.throws(
        () => discoverAppRouterEntries(current.app),
        /unsupported route handler export declaration/,
      );
    }

    const ambiguousDivisionSource = `const quotient = {} / 2 / 3;
export function GET() { return quotient; }
`;
    writeFileSync(path.join(current.app, "api", "status", "route.ts"), ambiguousDivisionSource);
    const ambiguousDivisionNamespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(ambiguousDivisionSource)}`);
    assert.deepEqual(Object.keys(ambiguousDivisionNamespace), ["GET"]);
    assert.throws(
      () => discoverAppRouterEntries(current.app),
      /unsupported route handler export declaration/,
    );

    const functionDivisionSource = `const value = function () {} / 1; export function POST() {} / 2 /;
`;
    writeFileSync(path.join(current.app, "api", "status", "route.ts"), functionDivisionSource);
    const functionDivisionNamespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(functionDivisionSource)}`);
    assert.deepEqual(Object.keys(functionDivisionNamespace), ["POST"]);
    assert.throws(
      () => discoverAppRouterEntries(current.app),
      /unsupported route handler export declaration/,
    );

    const unambiguousDivisionSource = `const quotient = {} / 2;
export function GET() { return quotient; }
`;
    writeFileSync(path.join(current.app, "api", "status", "route.ts"), unambiguousDivisionSource);
    const unambiguousDivisionNamespace = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(unambiguousDivisionSource)}`);
    assert.deepEqual(Object.keys(unambiguousDivisionNamespace), ["GET"]);
    assert.deepEqual(
      discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
      ["GET"],
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("ignores method-like text in nested template literals and interpolations", () => {
  const current = fixture();
  try {
    for (const source of [
      "const nested = `${`export function DELETE() {}`}`;\nexport async function GET() {}\n",
      "const \u03c0 = 4; const nested = `${\u03c0 / 2} / raw`;\nexport async function GET() {}\n",
      `const nested = \`${"${"}({
        value: \`${"${"}\`export const PUT = async () => {};\`}\`,
        matches: /}/.test("}") /* } \` export function PATCH() {} */,
      }).value}\`;
      export async function GET() {}
      `,
      "function probe() { return `${[...delete /]}; export function DELETE/]}`; } export function GET() {}\n",
    ]) {
      writeFileSync(path.join(current.app, "api", "status", "route.ts"), source);
      assert.deepEqual(
        discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
        ["GET"],
      );
    }

    writeFileSync(
      path.join(current.app, "api", "status", "route.ts"),
      "const nested = `${{} / 2}` / 3;\nexport async function GET() {}\n",
    );
    assert.throws(
      () => discoverAppRouterEntries(current.app),
      /unsupported route handler export declaration/,
    );

    writeFileSync(
      path.join(current.app, "api", "status", "route.ts"),
      "const \u53d6 = async () => {};\nexport { \u53d6 as POST };\nexport async function GET() {}\n",
    );
    assert.deepEqual(
      discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
      ["GET", "POST"],
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("counts only depth-zero handler exports and rejects JSX-capable handlers", () => {
  const current = fixture();
  try {
    for (const nested of [
      `export declare namespace Internal { export function PATCH(): void; }`,
      `declare module "virtual" { export function PUT(): void; }`,
      `namespace Internal { export function DELETE() {} }`,
    ]) {
      writeFileSync(
        path.join(current.app, "api", "status", "route.ts"),
        `${nested}\nexport async function GET() {}\n`,
      );
      assert.deepEqual(
        discoverAppRouterEntries(current.app).find((entry) => entry.path === "/api/status")?.methods,
        ["GET"],
      );
    }

    rmSync(path.join(current.app, "api", "status", "route.ts"));
    for (const extension of ["js", "jsx", "tsx"]) {
      const routeFile = path.join(current.app, "api", "status", `route.${extension}`);
      writeFileSync(
        routeFile,
        "const marker = <div>export function DELETE()</div>;\nexport function GET() { return marker; }\n",
      );
      assert.throws(
        () => discoverAppRouterEntries(current.app),
        new RegExp(`unsupported App Router handler extension \\.${extension}`),
      );
      rmSync(routeFile);
    }

    writeFileSync(path.join(current.app, "api", "status", "route.ts"), "export async function GET() {}\n");
    writeMatrix(current.matrix, [
      { path: "/", kind: "page", source: "app/page.tsx", surface: "public", productionSmoke: true },
      { path: "/api/status", kind: "handler", source: "app/api/status/route.js", surface: "public", productionSmoke: false, methods: ["GET"] },
      { path: "/article/[slug]", kind: "page", source: "app/(public)/article/[slug]/page.tsx", surface: "public", productionSmoke: false },
    ]);
    assert(
      validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix }).failures
        .some((failure) => failure.includes("unsupported JSX-capable handler extension")),
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects symlinked App Router entries instead of silently omitting routes", () => {
  const current = fixture();
  try {
    const target = path.join(current.root, "linked-route.ts");
    const linkedDirectory = path.join(current.app, "api", "linked");
    mkdirSync(linkedDirectory, { recursive: true });
    writeFileSync(target, "export async function DELETE() {}\n");
    symlinkSync(target, path.join(linkedDirectory, "route.ts"), "file");

    assert.throws(
      () => discoverAppRouterEntries(current.app),
      /symbolic links are unsupported inside App Router source \(api\/linked\/route\.ts\)/,
    );

    rmSync(path.join(linkedDirectory, "route.ts"));
    const linkedRoot = path.join(current.root, "linked-app");
    symlinkSync(current.app, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    assert.throws(
      () => discoverAppRouterEntries(linkedRoot),
      /App Router root must be a non-symbolic directory/,
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects symlinked route matrix and Next configuration files", () => {
  const current = fixture();
  try {
    const matrixTarget = path.join(current.root, "matrix-target.json");
    writeMatrix(matrixTarget, completeRoutes());
    symlinkSync(matrixTarget, current.matrix, "file");
    assert.throws(
      () => readAppRouteMatrix(current.matrix),
      /route matrix must be a regular non-symbolic file/,
    );
    assert.deepEqual(
      validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix }).failures,
      ["route matrix could not be read or parsed [ROUTE_MATRIX_INPUT]"],
    );

    const configLink = path.join(current.root, "next.config.ts");
    symlinkSync(productionNextConfigPath, configLink, "file");
    assert.throws(
      () => readNextConfigSource(configLink),
      /next\.config\.ts must be a regular non-symbolic file/,
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("returns bounded failures for malformed route rows and methods", () => {
  const current = fixture();
  try {
    writeMatrix(current.matrix, [
      null,
      { path: "/", kind: "page", source: "app/page.tsx", surface: "public", productionSmoke: true },
      { path: "/api/status", kind: "handler", source: "app/api/status/route.ts", surface: "public", productionSmoke: false },
    ]);
    let result;
    assert.doesNotThrow(() => {
      result = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix });
    });
    assert(result.failures.some((failure) => failure.includes("routes[0] must be an object")));
    assert(result.failures.some((failure) => failure.includes("routes[2].methods must list at least one explicit handler export")));
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("caps hostile matrix sources, rows, fields, failures, and diagnostics", () => {
  const current = fixture();
  try {
    writeMatrix(current.matrix, Array.from({ length: 2_048 }, () => null));
    const manyRows = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix });
    assert.equal(manyRows.failures.length, APP_ROUTE_MATRIX_LIMITS.failures);
    assert(manyRows.failures.some((failure) => failure.includes("failure limit reached")));
    assert(manyRows.failures.every((failure) => failure.length <= APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters));

    const longPath = `/${"x".repeat(65_536)}`;
    writeMatrix(current.matrix, [
      { path: longPath, kind: "page", source: "app/page.tsx", surface: "public", productionSmoke: false },
      ...completeRoutes().slice(1),
    ]);
    const longField = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix });
    assert(longField.failures.some((failure) => failure.includes("bounded root-relative route")));
    assert(longField.failures.every((failure) => failure.length <= APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters));

    writeFileSync(current.matrix, " ".repeat(APP_ROUTE_MATRIX_LIMITS.bytes + 1));
    assert.throws(
      () => readAppRouteMatrix(current.matrix),
      new RegExp(`route matrix exceeds the ${APP_ROUTE_MATRIX_LIMITS.bytes}-byte source limit`),
    );
    const oversized = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix });
    assert.deepEqual(oversized.failures, ["route matrix could not be read or parsed [ROUTE_MATRIX_INPUT]"]);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("redacts route matrix and App Router input diagnostics", () => {
  const current = fixture();
  const sentinel = "MOCHIRII_PRIVATE_MATRIX_SENTINEL";
  try {
    const missingMatrix = path.join(current.root, `${sentinel}.json`);
    const missingResult = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: missingMatrix });
    assert.deepEqual(missingResult.failures, ["route matrix could not be read or parsed [ROUTE_MATRIX_INPUT]"]);
    assert(!missingResult.failures.join(" ").includes(sentinel));

    writeFileSync(current.matrix, `{"${sentinel}":`);
    const malformedResult = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix });
    assert.deepEqual(malformedResult.failures, ["route matrix could not be read or parsed [ROUTE_MATRIX_INPUT]"]);
    assert(!malformedResult.failures.join(" ").includes(sentinel));

    writeMatrix(current.matrix, completeRoutes());
    const missingApp = path.join(current.root, sentinel, "app");
    const missingAppResult = validateAppRouteMatrix({ appDirectory: missingApp, matrixPath: current.matrix });
    assert.deepEqual(missingAppResult.failures, ["App Router filesystem could not be inventoried [APP_ROUTER_INPUT]"]);
    assert(!missingAppResult.failures.join(" ").includes(sentinel));
    assert([
      ...missingResult.failures,
      ...malformedResult.failures,
      ...missingAppResult.failures,
    ].every((failure) => failure.length <= APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters));
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("repository checkers redact missing Next configuration paths", () => {
  const sentinel = "MOCHIRII_PRIVATE_CHECKER_SENTINEL";
  const root = mkdtempSync(path.join(tmpdir(), `${sentinel}-`));
  const app = path.join(root, "apps", "web", "app");
  const matrix = path.join(root, "apps", "web", "config", "app-route-matrix.v1.json");
  try {
    mkdirSync(path.join(app, "api", "status"), { recursive: true });
    mkdirSync(path.dirname(matrix), { recursive: true });
    mkdirSync(path.join(root, "apps", "web", "public", "data"), { recursive: true });
    writeFileSync(path.join(app, "page.tsx"), "export default function Page() { return null; }\n");
    writeFileSync(path.join(app, "api", "status", "route.ts"), "export function GET() {}\n");
    writeMatrix(matrix, [
      { path: "/", kind: "page", source: "app/page.tsx", surface: "public", productionSmoke: true },
      { path: "/api/status", kind: "handler", source: "app/api/status/route.ts", surface: "public", productionSmoke: false, methods: ["GET"] },
    ]);

    for (const script of [appRouteCheckerPath, contentGuardrailsPath]) {
      const outcome = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      });
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.status, 1);
      const output = `${outcome.stdout}${outcome.stderr}`;
      assert.match(output, /NEXT_REDIRECT_INPUT/);
      assert(!output.includes(sentinel));
      assert(!output.includes(root));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("raffle checker rejects a symlinked Next configuration without leaking its path", () => {
  const prefix = path.join(tmpdir(), "mochirii-raffle-symlink-");
  const root = mkdtempSync(prefix);
  const copiedFiles = [
    "apps/web/config/public-urls.json",
    "apps/web/app/raffle/page.tsx",
    "apps/web/app/raffle/rules/page.tsx",
    "apps/web/app/raffle/rules/[version]/page.tsx",
    "apps/web/app/raffle-render-fixtures-internal/[scenario]/page.tsx",
    "apps/web/lib/raffle/public-render-fixtures.ts",
    "apps/web/components/public-pages/route-pages/RafflePage.tsx",
    "apps/web/components/public-pages/RaffleMonthlyWinner.tsx",
    "apps/web/lib/raffle/latest-winner-core.ts",
    "apps/web/lib/raffle/latest-winner.ts",
    "apps/web/app/api/raffle/latest-winner/route.ts",
    "apps/web/lib/raffle/public-view.ts",
    "apps/web/lib/raffle/time.ts",
    "apps/web/public/data/raffles.json",
    "apps/web/components/public-pages/metadata.ts",
    "apps/web/lib/site-navigation.ts",
    "apps/web/components/SiteFooter.tsx",
    "apps/web/public/data/home.json",
    "apps/web/public/data/tome.json",
    "apps/web/lib/guild-schedule.ts",
    "apps/web/public/sitemap.xml",
    "apps/web/app/styles/tokens-base.css",
    "apps/web/app/styles/public-side-pages.css",
  ];

  try {
    for (const relativePath of copiedFiles) {
      const destination = path.join(root, relativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(path.join(repositoryRoot, relativePath), destination);
    }

    const configLink = path.join(root, "apps", "web", "next.config.ts");
    symlinkSync(path.join(repositoryRoot, "apps", "web", "next.config.ts"), configLink, "file");
    assert(lstatSync(configLink).isSymbolicLink());

    const outcome = spawnSync(process.execPath, [raffleCheckerPath], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.status, 1);
    const output = `${outcome.stdout}${outcome.stderr}`;
    assert.match(output, /NEXT_REDIRECT_INPUT/);
    assert(!output.includes(root));
    assert.doesNotMatch(output, /Raffle public contract OK/);
  } finally {
    assert(root.startsWith(prefix));
    rmSync(root, { recursive: true, force: true });
  }
});

test("forbids production smoke on private, internal, and not-found surfaces", () => {
  const current = fixture();
  try {
    const routes = completeRoutes();
    routes[0] = { ...routes[0], surface: "private", productionSmoke: true };
    writeMatrix(current.matrix, routes);
    const result = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix });
    assert(result.failures.some((failure) => failure.includes("enables production smoke for the private surface")));
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects network-path redirect sources", () => {
  const current = fixture();
  try {
    writeMatrix(current.matrix, completeRoutes(), [
      { source: "//outside.example/legacy", destination: "/", permanent: true },
    ]);
    const result = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix });
    assert(result.failures.some((failure) => failure.includes("redirects[0].source must be a bounded root-relative path")));
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects redirect sources that collide with a documented handler", () => {
  const current = fixture();
  try {
    writeMatrix(current.matrix, completeRoutes(), [
      { source: "/api/status", destination: "/", permanent: true },
    ]);
    const result = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix });
    assert(result.failures.some((failure) => failure.includes("redirects[0].source conflicts with a documented route")));
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects non-canonical route, source, and redirect paths", () => {
  const current = fixture();
  try {
    writeMatrix(current.matrix, [
      { path: "/", kind: "page", source: "app/../page.tsx", surface: "public", productionSmoke: true },
      ...completeRoutes().slice(1),
    ], [
      { source: "/legacy//page", destination: "/", permanent: true },
      { source: "/%2e%2e/legacy", destination: "/", permanent: true },
    ]);
    const result = validateAppRouteMatrix({ appDirectory: current.app, matrixPath: current.matrix });
    assert(result.failures.some((failure) => failure.includes("routes[0].source must be a bounded App Router")));
    assert(result.failures.filter((failure) => failure.includes("must be a bounded root-relative path")).length >= 2);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("production smoke loads only a validated bounded route contract", () => {
  const current = fixture();
  try {
    writeMatrix(current.matrix, productionRouteMatrix.routes, productionRedirects);
    assert.equal(loadProductionSmokeContract({
      appDirectory: productionAppDirectory,
      matrixPath: current.matrix,
      nextConfigPath: productionNextConfigPath,
    }).routes.length, productionRouteMatrix.routes.length);

    writeMatrix(current.matrix, productionRouteMatrix.routes, productionRedirects.slice(1));
    assert.throws(
      () => loadProductionSmokeContract({
        appDirectory: productionAppDirectory,
        matrixPath: current.matrix,
        nextConfigPath: productionNextConfigPath,
      }),
      /production smoke redirect contract validation failed: next\.config\.ts contains an undocumented redirect/,
    );

    writeFileSync(current.matrix, " ".repeat(APP_ROUTE_MATRIX_LIMITS.bytes + 1));
    assert.throws(
      () => loadProductionSmokeContract({
        appDirectory: productionAppDirectory,
        matrixPath: current.matrix,
        nextConfigPath: productionNextConfigPath,
      }),
      /production smoke route matrix validation failed: route matrix could not be read/,
    );

    const longRoutes = [
      ...productionRouteMatrix.routes,
      ...Array.from({ length: 8 }, (_, index) => ({
        path: `/${index}-${"x".repeat(470)}`,
        kind: "page",
        source: `app/hostile-${index}/page.tsx`,
        surface: "public",
        productionSmoke: false,
      })),
    ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    writeMatrix(current.matrix, longRoutes, productionRedirects);
    const longValidation = validateAppRouteMatrix({
      appDirectory: productionAppDirectory,
      matrixPath: current.matrix,
    });
    assert(longValidation.failures.slice(0, 8).join("; ").length > APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters);
    assert.throws(
      () => loadProductionSmokeContract({
        appDirectory: productionAppDirectory,
        matrixPath: current.matrix,
        nextConfigPath: productionNextConfigPath,
      }),
      (error) => {
        assert.match(error.message, /production smoke route matrix validation failed/);
        assert(error.message.length <= APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters);
        return true;
      },
    );

    writeMatrix(current.matrix, productionRouteMatrix.routes, productionRedirects);
    const nextConfigSentinel = path.join(current.root, "MOCHIRII_PRIVATE_NEXT_CONFIG_SENTINEL.ts");
    assert.throws(
      () => loadProductionSmokeContract({
        appDirectory: productionAppDirectory,
        matrixPath: current.matrix,
        nextConfigPath: nextConfigSentinel,
      }),
      (error) => {
        assert.equal(error.message, "production smoke Next redirect contract could not be read or parsed [NEXT_REDIRECT_INPUT]");
        assert(!error.message.includes("MOCHIRII_PRIVATE_NEXT_CONFIG_SENTINEL"));
        assert(error.message.length <= APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters);
        return true;
      },
    );
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("resolves only same-origin redirect targets and redacts observed URL details", () => {
  const sameOrigin = resolveSameOriginRedirect("https://preview.example", "https://preview.example/legacy", "/target");
  assert.equal(sameOrigin.href, "https://preview.example/target");
  assert.throws(
    () => resolveSameOriginRedirect("https://preview.example", "https://preview.example/legacy", "https://outside.example/target"),
    /redirect target must remain same-origin/,
  );
  assert.throws(
    () => resolveSameOriginRedirect("https://preview.example", "https://preview.example/legacy", "https://user:pass@preview.example/target"),
    /redirect target must not contain URL credentials/,
  );

  const sentinel = "MOCHIRII_PRIVATE_REDIRECT_SENTINEL";
  const hostile = new URL(`https://preview.example/${sentinel.repeat(2_048)}?code=${sentinel}#${sentinel}`);
  assert.throws(
    () => assertExpectedRouteUrl(hostile, "/target"),
    (error) => {
      assert.match(error.message, /path mismatch, unexpected query, unexpected fragment/);
      assert(!error.message.includes(sentinel));
      assert(error.message.length <= APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters);
      return true;
    },
  );
});

test("binds permanent production redirects to HTTP 308", () => {
  assert.doesNotThrow(() => assertPermanentRedirectStatus(308));
  for (const status of [301, 302, 307]) {
    assert.throws(() => assertPermanentRedirectStatus(status), /expected permanent redirect HTTP 308/);
  }
});

test("reads only bounded UTF-8 HTML response bodies", async () => {
  const html = "<!doctype html><title>Mōchirīī</title>";
  assert.equal(
    await readBoundedHtmlResponse(new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    })),
    html,
  );

  let wrongTypeRead = false;
  let wrongTypeCancelled = false;
  const wrongTypeResponse = {
    headers: new Headers({ "content-type": "text/plain" }),
    body: {
      getReader() {
        wrongTypeRead = true;
        throw new Error("body must not be read");
      },
      async cancel() {
        wrongTypeCancelled = true;
      },
    },
  };
  await assert.rejects(
    () => readBoundedHtmlResponse(wrongTypeResponse),
    /response body must use an HTML media type/,
  );
  assert.equal(wrongTypeRead, false);
  assert.equal(wrongTypeCancelled, true);

  const chunks = [
    new Uint8Array(PRODUCTION_SMOKE_HTML_BYTE_LIMIT),
    new Uint8Array([0x21]),
  ];
  let chunkIndex = 0;
  let oversizedCancelled = false;
  let oversizedReleased = false;
  const oversizedResponse = {
    headers: new Headers({ "content-type": "application/xhtml+xml" }),
    body: {
      getReader() {
        return {
          async read() {
            if (chunkIndex === chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[chunkIndex++] };
          },
          async cancel() {
            oversizedCancelled = true;
          },
          releaseLock() {
            oversizedReleased = true;
          },
        };
      },
    },
  };
  await assert.rejects(
    () => readBoundedHtmlResponse(oversizedResponse),
    /could not be read within the byte limit/,
  );
  assert.equal(oversizedCancelled, true);
  assert.equal(oversizedReleased, true);

  const sentinel = "MOCHIRII_PRIVATE_BODY_SENTINEL";
  await assert.rejects(
    () => readBoundedHtmlResponse(new Response(sentinel, {
      headers: { "content-type": `text/plain; token=${sentinel}` },
    })),
    (error) => {
      assert.equal(error.message, "response body must use an HTML media type");
      assert(!error.message.includes(sentinel));
      return true;
    },
  );
});

test("production smoke consumers execute bounded HTML ingestion", async () => {
  let wrongTypeRead = false;
  let wrongTypeCancelled = false;
  let brandedSuccessReported = false;
  const wrongTypeResponse = {
    status: 404,
    headers: new Headers({ "content-type": "text/plain" }),
    body: {
      getReader() {
        wrongTypeRead = true;
        throw new Error("body must not be read");
      },
      async cancel() {
        wrongTypeCancelled = true;
      },
    },
  };
  await assert.rejects(
    () => checkBrandedNotFound("https://preview.example", {
      requestImpl: async (_baseUrl, _path, options) => {
        assert.equal(options.method, "GET");
        return wrongTypeResponse;
      },
      reportSuccess: () => {
        brandedSuccessReported = true;
      },
    }),
    { message: "response body must use an HTML media type" },
  );
  assert.equal(wrongTypeRead, false);
  assert.equal(wrongTypeCancelled, true);
  assert.equal(brandedSuccessReported, false);

  const chunks = [
    new Uint8Array(PRODUCTION_SMOKE_HTML_BYTE_LIMIT),
    new Uint8Array([0x21]),
  ];
  let chunkIndex = 0;
  let oversizedCancelled = false;
  let oversizedReleased = false;
  let bodySuccessReported = false;
  const oversizedResponse = {
    status: 200,
    headers: new Headers({ "content-type": "application/xhtml+xml" }),
    body: {
      getReader() {
        return {
          async read() {
            if (chunkIndex === chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[chunkIndex++] };
          },
          async cancel() {
            oversizedCancelled = true;
          },
          releaseLock() {
            oversizedReleased = true;
          },
        };
      },
    },
  };
  await assert.rejects(
    () => checkBody("https://preview.example", "/privacy", /privacy/, {
      requestImpl: async () => oversizedResponse,
      reportSuccess: () => {
        bodySuccessReported = true;
      },
    }),
    { message: "HTML response body could not be read within the byte limit" },
  );
  assert.equal(oversizedCancelled, true);
  assert.equal(oversizedReleased, true);
  assert.equal(bodySuccessReported, false);
});

function observabilityHeaders(contentType = "text/html; charset=utf-8") {
  return new Headers({
    "content-type": contentType,
    server: "Vercel",
    "content-security-policy": "default-src 'self'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=()",
    "cross-origin-opener-policy": "same-origin",
    "x-frame-options": "DENY",
  });
}

function observedResponse(url, body, init) {
  const response = new Response(body, init);
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
    redirected: false,
    url,
  };
}

function publicMetadataHtml({ canonical, ogUrl, ogImage, twitterImage }) {
  return `<!doctype html>
<html><head>
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="Mochirii">
<meta property="og:description" content="Community">
<meta property="og:url" content="${ogUrl}">
<meta property="og:image" content="${ogImage}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Mochirii">
<meta name="twitter:description" content="Community">
<meta name="twitter:image" content="${twitterImage}">
</head><body>Mochirii</body></html>`;
}

test("observability live consumer executes bounded HTML ingestion", async () => {
  let bodyRead = false;
  let bodyCancelled = false;
  const requestOptions = [];
  const response = {
    status: 200,
    headers: observabilityHeaders("text/plain"),
    redirected: false,
    url: "https://preview.example/",
    body: {
      getReader() {
        bodyRead = true;
        throw new Error("body must not be read");
      },
      async cancel() {
        bodyCancelled = true;
      },
    },
  };
  const recorder = createObservabilityFailureRecorder();
  await checkLiveIfRequested({
    liveEnabled: true,
    baseUrl: "https://preview.example",
    routes: ["/"],
    fetchImpl: async (_url, options) => {
      requestOptions.push(options);
      return response;
    },
    recordFailure: recorder.record,
  });
  assert.equal(requestOptions.length, 1);
  assert.equal(requestOptions[0].redirect, "manual");
  assert.equal(bodyRead, false);
  assert.equal(bodyCancelled, true);
  assert.deepEqual(recorder.messages, ["live /: UTF-8 HTML media type rejected"]);

  const chunks = [
    new Uint8Array(PRODUCTION_SMOKE_HTML_BYTE_LIMIT),
    new Uint8Array([0x21]),
  ];
  let chunkIndex = 0;
  let oversizedCancelled = false;
  let oversizedReleased = false;
  const oversizedResponse = {
    status: 200,
    headers: observabilityHeaders(),
    redirected: false,
    url: "https://preview.example/",
    body: {
      getReader() {
        return {
          async read() {
            if (chunkIndex === chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[chunkIndex++] };
          },
          async cancel() {
            oversizedCancelled = true;
          },
          releaseLock() {
            oversizedReleased = true;
          },
        };
      },
    },
  };
  const oversizedRecorder = createObservabilityFailureRecorder();
  await checkLiveIfRequested({
    liveEnabled: true,
    baseUrl: "https://preview.example",
    routes: ["/"],
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "manual");
      return oversizedResponse;
    },
    recordFailure: oversizedRecorder.record,
  });
  assert.equal(oversizedCancelled, true);
  assert.equal(oversizedReleased, true);
  assert.deepEqual(oversizedRecorder.messages, ["live /: HTML response rejected"]);
});

test("observability rejects non-HTML and non-UTF-8 media contracts before body parsing", async () => {
  const sentinel = "MOCHIRII_XHTML_CDATA_SENTINEL";
  const validMetadata = publicMetadataHtml({
    canonical: "https://preview.example/",
    ogUrl: "https://preview.example/",
    ogImage: `/assets/${sentinel}.webp`,
    twitterImage: `/assets/${sentinel}.webp`,
  });
  const cases = [
    {
      contentType: "application/xhtml+xml; charset=utf-8",
      body: `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><![CDATA[inert >${validMetadata}]]></html>`,
    },
    {
      contentType: "text/html; charset=iso-8859-1",
      body: validMetadata,
    },
    {
      contentType: "text/html; charset='utf-8'",
      body: validMetadata,
    },
    {
      contentType: "text/html; charset =utf-8",
      body: validMetadata,
    },
    {
      contentType: 'text/html; charset= "utf-8"',
      body: validMetadata,
    },
    {
      contentType: "\u00a0text/html; charset=utf-8\u00a0",
      body: validMetadata,
    },
  ];

  for (const current of cases) {
    const source = new Response(current.body, {
      status: 200,
      headers: observabilityHeaders(current.contentType),
    });
    let bodyRead = false;
    let bodyCancelled = false;
    const response = {
      status: source.status,
      headers: source.headers,
      redirected: false,
      url: "https://preview.example/",
      body: {
        getReader() {
          bodyRead = true;
          return source.body.getReader();
        },
        async cancel() {
          bodyCancelled = true;
          await source.body.cancel();
        },
      },
    };
    const requests = [];
    const recorder = createObservabilityFailureRecorder();
    await checkLiveIfRequested({
      liveEnabled: true,
      baseUrl: "https://preview.example",
      routes: ["/"],
      fetchImpl: async (url, options) => {
        requests.push({ url: new URL(url), options });
        if (requests.length > 1) throw new Error("rejected media contract must not trigger an image request");
        return response;
      },
      recordFailure: recorder.record,
    });
    assert.deepEqual(requests.map((request) => request.url.href), ["https://preview.example/"]);
    assert.equal(requests[0].options.redirect, "manual");
    assert.equal(bodyRead, false);
    assert.equal(bodyCancelled, true);
    assert.deepEqual(recorder.messages, ["live /: UTF-8 HTML media type rejected"]);
    assert(recorder.messages.every((message) => !message.includes(sentinel)));
  }
});

test("observability rejects invalid bases before fetch and normalizes a valid origin", async () => {
  for (const baseUrl of [
    "https://user:placeholder@preview.example/",
    "https://preview.example/private/path",
    "https://preview.example/?token=placeholder",
    "ftp://preview.example/",
  ]) {
    let requests = 0;
    const recorder = createObservabilityFailureRecorder();
    await checkLiveIfRequested({
      liveEnabled: true,
      baseUrl,
      routes: ["/auth"],
      fetchImpl: async () => {
        requests += 1;
        throw new Error("invalid base must fail before fetch");
      },
      recordFailure: recorder.record,
    });
    assert.equal(requests, 0);
    assert.deepEqual(recorder.messages, ["live observability base URL rejected"]);
  }

  const normalizedRequests = [];
  const normalizedRecorder = createObservabilityFailureRecorder();
  await checkLiveIfRequested({
    liveEnabled: true,
    baseUrl: "HTTPS://PREVIEW.EXAMPLE:443/",
    routes: ["/auth"],
    fetchImpl: async (url, options) => {
      normalizedRequests.push({ url: new URL(url), options });
      return observedResponse(
        "https://preview.example/auth",
        '<html><head><meta name="robots" content="noindex, follow"></head></html>',
        { status: 200, headers: observabilityHeaders() },
      );
    },
    recordFailure: normalizedRecorder.record,
  });
  assert.deepEqual(normalizedRequests.map((request) => request.url.href), ["https://preview.example/auth"]);
  assert.equal(normalizedRequests[0].options.redirect, "manual");
  assert.deepEqual(normalizedRecorder.messages, []);
});

test("observability rejects route redirects and exact-response URL drift before reading", async () => {
  const sentinel = "MOCHIRII_PRIVATE_ROUTE_REDIRECT_SENTINEL";
  const cases = [
    {
      status: 302,
      responseUrl: "https://preview.example/auth",
      expectedFailure: "live /auth: route redirect rejected",
    },
    {
      status: 200,
      responseUrl: `https://outside.example/${sentinel}`,
      expectedFailure: "live /auth: route response URL rejected",
    },
    {
      status: 200,
      responseUrl: `https://user:${sentinel}@preview.example/auth`,
      expectedFailure: "live /auth: route response URL rejected",
    },
  ];

  for (const current of cases) {
    let bodyRead = false;
    let bodyCancelled = false;
    let requests = 0;
    const headers = observabilityHeaders();
    headers.set("location", `https://outside.example/${sentinel}`);
    const response = {
      status: current.status,
      headers,
      redirected: false,
      url: current.responseUrl,
      body: {
        getReader() {
          bodyRead = true;
          throw new Error("rejected response body must not be read");
        },
        async cancel() {
          bodyCancelled = true;
        },
      },
    };
    const recorder = createObservabilityFailureRecorder();
    await checkLiveIfRequested({
      liveEnabled: true,
      baseUrl: "https://preview.example",
      routes: ["/auth"],
      fetchImpl: async (url, options) => {
        requests += 1;
        assert.equal(new URL(url).href, "https://preview.example/auth");
        assert.equal(options.redirect, "manual");
        return response;
      },
      recordFailure: recorder.record,
    });
    assert.equal(requests, 1);
    assert.equal(bodyRead, false);
    assert.equal(bodyCancelled, true);
    assert.deepEqual(recorder.messages, [current.expectedFailure]);
    assert(recorder.messages.every((message) => !message.includes(sentinel)));
  }
});

test("observability rejects response-controlled image targets without diagnostic leakage", async () => {
  const sentinel = "MOCHIRII_PRIVATE_METADATA_SENTINEL";
  const html = publicMetadataHtml({
    canonical: `https://preview.example/?code=${sentinel}`,
    ogUrl: `https://preview.example/?member=${sentinel}`,
    ogImage: `https://outside.example/assets/card-${sentinel}.webp?token=${sentinel}`,
    twitterImage: `https://user:${sentinel}@preview.example/assets/card.webp`,
  });
  const requests = [];
  const recorder = createObservabilityFailureRecorder();
  await checkLiveIfRequested({
    liveEnabled: true,
    baseUrl: "https://preview.example",
    routes: ["/"],
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      if (requests.length === 1) {
        return observedResponse("https://preview.example/", html, { status: 200, headers: observabilityHeaders() });
      }
      throw new Error("response-controlled image target must not be requested");
    },
    recordFailure: recorder.record,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.href, "https://preview.example/");
  assert.equal(requests[0].options.redirect, "manual");
  assert(recorder.messages.includes("live /: canonical metadata mismatch"));
  assert(recorder.messages.includes("live /: og:url metadata mismatch"));
  assert.equal(recorder.messages.filter((message) => message === "live /: social image URL rejected").length, 2);
  assert(recorder.messages.every((message) => !message.includes(sentinel)));
  assert(recorder.messages.every((message) => message.length <= OBSERVABILITY_DIAGNOSTIC_LIMITS.messageCharacters));
  assert(recorder.messages.join("").length <= OBSERVABILITY_DIAGNOSTIC_LIMITS.aggregateCharacters);
});

test("observability accepts only credential-free same-origin asset image URLs", async () => {
  const page = new URL("https://preview.example/");
  assert.equal(
    resolveSameOriginMetadataImage(page, "/assets/social-card.webp")?.href,
    "https://preview.example/assets/social-card.webp",
  );
  for (const value of [
    "https://outside.example/assets/social-card.webp",
    "https://user:pass@preview.example/assets/social-card.webp",
    "https://preview.example/assets/social-card.webp?token=redacted",
    "https://preview.example/assets/social-card.webp#fragment",
    "https://preview.example/other/social-card.webp",
    "data:image/png;base64,AAAA",
  ]) {
    assert.equal(resolveSameOriginMetadataImage(page, value), null);
  }

  const html = publicMetadataHtml({
    canonical: "https://preview.example/",
    ogUrl: "https://preview.example/",
    ogImage: "/assets/social-card.webp",
    twitterImage: "/assets/social-card.webp",
  });
  const requests = [];
  const recorder = createObservabilityFailureRecorder();
  await checkLiveIfRequested({
    liveEnabled: true,
    baseUrl: "https://preview.example",
    routes: ["/"],
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      if (requests.length === 1) {
        return observedResponse("https://preview.example/", html, { status: 200, headers: observabilityHeaders() });
      }
      return observedResponse("https://preview.example/assets/social-card.webp", new Uint8Array([0x00]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    },
    recordFailure: recorder.record,
  });
  assert.deepEqual(requests.map((request) => request.url.href), [
    "https://preview.example/",
    "https://preview.example/assets/social-card.webp",
  ]);
  assert(requests.every((request) => request.options.redirect === "manual"));
  assert.deepEqual(recorder.messages, []);
});

test("observability rejects image redirects and final-response URL drift", async () => {
  const sentinel = "MOCHIRII_PRIVATE_IMAGE_REDIRECT_SENTINEL";
  const html = publicMetadataHtml({
    canonical: "https://preview.example/",
    ogUrl: "https://preview.example/",
    ogImage: "/assets/social-card.webp",
    twitterImage: "/assets/social-card.webp",
  });
  const cases = [
    {
      status: 302,
      responseUrl: "https://preview.example/assets/social-card.webp",
      expectedFailure: "live /: social image redirect rejected",
    },
    {
      status: 200,
      responseUrl: `https://outside.example/${sentinel}.webp`,
      expectedFailure: "live /: social image response URL rejected",
    },
    {
      status: 200,
      responseUrl: `https://user:${sentinel}@preview.example/assets/social-card.webp`,
      expectedFailure: "live /: social image response URL rejected",
    },
  ];

  for (const current of cases) {
    let imageBodyRead = false;
    let imageBodyCancelled = false;
    const requests = [];
    const recorder = createObservabilityFailureRecorder();
    await checkLiveIfRequested({
      liveEnabled: true,
      baseUrl: "https://preview.example",
      routes: ["/"],
      fetchImpl: async (url, options) => {
        requests.push({ url: new URL(url), options });
        if (requests.length === 1) {
          return observedResponse("https://preview.example/", html, { status: 200, headers: observabilityHeaders() });
        }
        const headers = new Headers({
          "content-type": "image/webp",
          location: `https://outside.example/${sentinel}.webp`,
        });
        return {
          status: current.status,
          headers,
          redirected: false,
          url: current.responseUrl,
          body: {
            getReader() {
              imageBodyRead = true;
              throw new Error("rejected image body must not be read");
            },
            async cancel() {
              imageBodyCancelled = true;
            },
          },
        };
      },
      recordFailure: recorder.record,
    });
    assert.deepEqual(requests.map((request) => request.url.href), [
      "https://preview.example/",
      "https://preview.example/assets/social-card.webp",
    ]);
    assert(requests.every((request) => request.options.redirect === "manual"));
    assert.equal(imageBodyRead, false);
    assert.equal(imageBodyCancelled, true);
    assert.deepEqual(recorder.messages, [current.expectedFailure]);
    assert(recorder.messages.every((message) => !message.includes(sentinel)));
  }
});

test("observability bounds canonical image targets before fetch and rejects empty delimiters", async () => {
  const unicodeImage = "/assets/" + "é".repeat(2_040);
  assert.equal(unicodeImage.length, OBSERVABILITY_DIAGNOSTIC_LIMITS.metadataUrlCharacters);
  const cases = [
    {
      html: publicMetadataHtml({
        canonical: "https://preview.example/",
        ogUrl: "https://preview.example/",
        ogImage: unicodeImage,
        twitterImage: unicodeImage,
      }),
      rejectedImages: 1,
    },
    {
      html: publicMetadataHtml({
        canonical: "https://preview.example/",
        ogUrl: "https://preview.example/",
        ogImage: "/assets/social-card.webp?",
        twitterImage: "/assets/social-card.webp#",
      }),
      rejectedImages: 2,
    },
    {
      html: publicMetadataHtml({
        canonical: "https://preview.example/",
        ogUrl: "https://preview.example/",
        ogImage: "/assets/social-card.webp&quest;",
        twitterImage: "/assets/social-card.webp&quest;",
      }),
      rejectedImages: 1,
    },
  ];

  for (const current of cases) {
    const requests = [];
    const recorder = createObservabilityFailureRecorder();
    await checkLiveIfRequested({
      liveEnabled: true,
      baseUrl: "https://preview.example",
      routes: ["/"],
      fetchImpl: async (url, options) => {
        requests.push({ url: new URL(url), options });
        if (requests.length > 1) throw new Error("rejected image URL must not reach fetch");
        return observedResponse("https://preview.example/", current.html, {
          status: 200,
          headers: observabilityHeaders(),
        });
      },
      recordFailure: recorder.record,
    });
    assert.deepEqual(requests.map((request) => request.url.href), ["https://preview.example/"]);
    assert.equal(requests[0].options.redirect, "manual");
    assert.equal(
      recorder.messages.filter((message) => message === "live /: social image URL rejected").length,
      current.rejectedImages,
    );
  }
});

test("observability ignores inactive, foreign, select-mode, malformed, and duplicate metadata", async () => {
  const sentinel = "MOCHIRII_INERT_METADATA_SENTINEL";
  const suffixMetadata = [
    '<link data-rel="canonical" data-href="https://preview.example/">',
    '<meta data-property="og:title" data-content="title">',
    '<meta data-property="og:description" data-content="description">',
    '<meta data-property="og:url" data-content="https://preview.example/">',
    '<meta data-property="og:image" data-content="/assets/' + sentinel + '.webp">',
    '<meta data-name="twitter:card" data-content="summary_large_image">',
    '<meta data-name="twitter:title" data-content="title">',
    '<meta data-name="twitter:description" data-content="description">',
    '<meta data-name="twitter:image" data-content="/assets/' + sentinel + '.webp">',
  ].join("");
  const activeMetadata = suffixMetadata.replaceAll("data-", "");
  const duplicateMetadata = publicMetadataHtml({
    canonical: "https://preview.example/",
    ogUrl: "https://preview.example/",
    ogImage: "/assets/" + sentinel + ".webp",
    twitterImage: "/assets/" + sentinel + ".webp",
  })
    .replace('property="og:image"', 'property="og:image" property="og:image"')
    .replace('name="twitter:image"', 'name="twitter:image" name="twitter:image"');
  const leadingEqualsMetadata = activeMetadata
    .replaceAll(" rel=", " =rel=")
    .replaceAll(" href=", " =href=")
    .replaceAll(" property=", " =property=")
    .replaceAll(" name=", " =name=")
    .replaceAll(" content=", " =content=");
  const cases = [
    "<html><head>" + suffixMetadata + "</head></html>",
    "<html><head><!--" + activeMetadata + "--></head></html>",
    "<html><head><template>" + activeMetadata + "</template></head></html>",
    "<html><head>" + activeMetadata.replaceAll("<link", "<link.fake").replaceAll("<meta", "<meta.fake") + "</head></html>",
    "<html><head>" + '<meta name="viewport" content="x">'.repeat(257) + activeMetadata + "</head></html>",
    duplicateMetadata,
    "<html><body><svg><![CDATA[inert >" + activeMetadata + "]]></svg></body></html>",
    "<html><body><svg>" + activeMetadata + "</svg></body></html>",
    "<html><body><select>" + activeMetadata + "</select></body></html>",
    "<html><frameset>" + activeMetadata + "</frameset></html>",
    "<!doctype html><html><frameset></frameset>" + activeMetadata + "</html>",
    "<!doctype html><html><frameset></frameset></html>" + activeMetadata,
    "<!doctype html><html><head></head><input type=hidden>" + activeMetadata + "<frameset></frameset></html>",
    "<html><body><script><!--<script></script>" + activeMetadata + "</script></body></html>",
    "<html><head>" + leadingEqualsMetadata + "</head></html>",
    "<html><body>" + "<svg>".repeat(65) + "</svg>".repeat(65) + activeMetadata + "</body></html>",
  ];

  for (const html of cases) {
    const requests = [];
    const recorder = createObservabilityFailureRecorder();
    await checkLiveIfRequested({
      liveEnabled: true,
      baseUrl: "https://preview.example",
      routes: ["/"],
      fetchImpl: async (url, options) => {
        requests.push({ url: new URL(url), options });
        if (requests.length > 1) throw new Error("inactive or ambiguous metadata must not trigger an image request");
        return observedResponse("https://preview.example/", html, {
          status: 200,
          headers: observabilityHeaders(),
        });
      },
      recordFailure: recorder.record,
    });
    assert.deepEqual(requests.map((request) => request.url.href), ["https://preview.example/"]);
    assert(recorder.messages.includes("live /: expected og:image metadata"));
    assert(recorder.messages.includes("live /: expected twitter:image metadata"));
    assert(recorder.messages.every((message) => !message.includes(sentinel)));
  }
});

test("observability handles a boundary-valid raw-text close candidate without suffix rescans", async () => {
  const requests = [];
  const recorder = createObservabilityFailureRecorder();
  const originalIndexOf = String.prototype.indexOf;
  let rawTextCloseSearches = 0;
  String.prototype.indexOf = function instrumentedIndexOf(searchValue, fromIndex) {
    if (searchValue === "</script") rawTextCloseSearches += 1;
    return Reflect.apply(originalIndexOf, this, [searchValue, fromIndex]);
  };

  try {
    await checkLiveIfRequested({
      liveEnabled: true,
      baseUrl: "https://preview.example",
      routes: ["/"],
      fetchImpl: async (url, options) => {
        requests.push({ url: new URL(url), options });
        if (requests.length > 1) throw new Error("rejected raw-text metadata must not trigger an image request");
        return observedResponse(
          "https://preview.example/",
          "<script>" + "</script x ".repeat(256),
          { status: 200, headers: observabilityHeaders() },
        );
      },
      recordFailure: recorder.record,
    });
  } finally {
    String.prototype.indexOf = originalIndexOf;
  }

  assert.deepEqual(requests.map((request) => request.url.href), ["https://preview.example/"]);
  assert.equal(rawTextCloseSearches, 1);
  assert(recorder.messages.includes("live /: expected og:image metadata"));
});

test("observability keeps tag folding ASCII-only and preserves malformed tag boundaries", async () => {
  const validHtml = publicMetadataHtml({
    canonical: "https://preview.example/",
    ogUrl: "https://preview.example/",
    ogImage: "/assets/social-card.webp",
    twitterImage: "/assets/social-card.webp",
  });
  const cases = [
    {
      html: validHtml.replace("<link rel=", "<linK rel="),
      failure: "live /: canonical metadata mismatch",
    },
    {
      html: validHtml.replace(
        '<meta property="og:title" content="Mochirii">',
        '<meta x=y" ><div " property=og:title content=Mochirii>',
      ),
      failure: "live /: expected og:title metadata",
    },
  ];

  for (const current of cases) {
    const requests = [];
    const recorder = createObservabilityFailureRecorder();
    await checkLiveIfRequested({
      liveEnabled: true,
      baseUrl: "https://preview.example",
      routes: ["/"],
      fetchImpl: async (url, options) => {
        requests.push({ url: new URL(url), options });
        if (requests.length === 1) {
          return observedResponse("https://preview.example/", current.html, {
            status: 200,
            headers: observabilityHeaders(),
          });
        }
        return observedResponse("https://preview.example/assets/social-card.webp", new Uint8Array([0]), {
          status: 200,
          headers: { "content-type": "image/webp" },
        });
      },
      recordFailure: recorder.record,
    });
    assert.deepEqual(requests.map((request) => request.url.href), [
      "https://preview.example/",
      "https://preview.example/assets/social-card.webp",
    ]);
    assert(recorder.messages.includes(current.failure));
  }
});

test("observability accepts active metadata streamed outside head", async () => {
  const headHtml = publicMetadataHtml({
    canonical: "https://preview.example/",
    ogUrl: "https://preview.example/",
    ogImage: "/assets/social-card.webp",
    twitterImage: "/assets/social-card.webp",
  });
  const html = headHtml
    .replace("<html><head>", "<html><head></head><body><script>İ inert text</script><div>")
    .replace("</head><body>Mochirii</body></html>", "</div></body></html>");
  const requests = [];
  const recorder = createObservabilityFailureRecorder();
  await checkLiveIfRequested({
    liveEnabled: true,
    baseUrl: "https://preview.example",
    routes: ["/"],
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      if (requests.length === 1) {
        return observedResponse("https://preview.example/", html, {
          status: 200,
          headers: observabilityHeaders(),
        });
      }
      return observedResponse("https://preview.example/assets/social-card.webp", new Uint8Array([0]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    },
    recordFailure: recorder.record,
  });
  assert.deepEqual(requests.map((request) => request.url.href), [
    "https://preview.example/",
    "https://preview.example/assets/social-card.webp",
  ]);
  assert.deepEqual(recorder.messages, []);
});

test("observability ignores commented noindex metadata", async () => {
  const recorder = createObservabilityFailureRecorder();
  await checkLiveIfRequested({
    liveEnabled: true,
    baseUrl: "https://preview.example",
    routes: ["/auth"],
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).href, "https://preview.example/auth");
      assert.equal(options.redirect, "manual");
      return observedResponse(
        "https://preview.example/auth",
        '<html><head><!--<meta name="robots" content="noindex, follow">--></head></html>',
        { status: 200, headers: observabilityHeaders() },
      );
    },
    recordFailure: recorder.record,
  });
  assert.deepEqual(recorder.messages, ["live /auth: expected noindex robots meta"]);
});

test("observability diagnostics have per-message, count, and aggregate bounds", () => {
  const recorder = createObservabilityFailureRecorder();
  for (let index = 0; index < 1_000; index += 1) {
    recorder.record(`failure ${index}: ${"x".repeat(2_000)}`);
  }
  assert(recorder.messages.length <= OBSERVABILITY_DIAGNOSTIC_LIMITS.messages);
  assert(recorder.messages.every((message) => message.length <= OBSERVABILITY_DIAGNOSTIC_LIMITS.messageCharacters));
  assert(recorder.messages.join("").length <= OBSERVABILITY_DIAGNOSTIC_LIMITS.aggregateCharacters);
  assert.equal(recorder.messages.at(-1), "additional observability failures were suppressed");
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

test("parses and compares the depth-one Next redirect literal contract", () => {
  const parsed = parseRedirectFixture(`
    const nextConfig: NextConfig = {
      async redirects() {
        return [
          { source: "/tome.html", destination: "/tome", permanent: true },
          { source: "/social.html", destination: "/social", permanent: true },
        ];
      },
    };
    export default nextConfig;
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

test("ignores commented redirect declarations and checks the one live contract", () => {
  const parsed = parseRedirectFixture(`
    /*
      const nextConfig: NextConfig = {
        async redirects() {
          return [{ source: "/safe.html", destination: "/safe", permanent: true }];
        },
      };
      export default nextConfig;
    */
    const nextConfig: NextConfig = {
      async redirects() {
        return [{ source: "/safe.html", destination: "https://outside.example/safe", permanent: true }];
      },
    };
    export default nextConfig;
  `);
  assert.deepEqual(parsed, [
    { source: "/safe.html", destination: "https://outside.example/safe", permanent: true },
  ]);
  assert.deepEqual(compareRedirectContracts([
    { source: "/safe.html", destination: "/safe", permanent: true },
  ], parsed), ["Next redirect /safe.html does not match the route matrix"]);
});

test("rejects a canonical mapping decoy outside the exported nextConfig", () => {
  for (const alternateMember of [
    `redirects() { return []; }`,
    `async redirects() { return []; }`,
  ]) {
    assert.throws(
      () => parseRedirectFixture(`
        const unused = {
          async redirects() {
            return [{ source: "/safe.html", destination: "/safe", permanent: true }];
          },
        };
        const nextConfig: NextConfig = { ${alternateMember} };
        export default nextConfig;
      `),
      /redirects\(\) did not contain any redirect entries|exactly one depth-one async redirects/,
    );
  }
});

test("rejects a canonical redirects method nested below nextConfig depth one", () => {
  assert.throws(
    () => parseRedirectFixture(`
      const nextConfig: NextConfig = {
        async headers() {
          const nested = {
            async redirects() {
              return [{ source: "/safe.html", destination: "/safe", permanent: true }];
            },
          };
          return [];
        },
      };
      export default nextConfig;
    `),
    /exactly one depth-one async redirects/,
  );
});

test("rejects preceding runtime mutation and requires a direct literal return", () => {
  for (const mutation of [
    `Array.prototype.map = () => [];`,
    `Object.prototype.then = (resolve) => resolve([{ source: "/safe.html", destination: "https://outside.example/safe", permanent: true }]);`,
    `const alias = {}; alias.then = () => {};`,
    `Object.defineProperty(Array.prototype, "then", { value: () => {} });`,
    `Reflect.set(Array.prototype, "then", () => {});`,
    `Object["define" + "Property"](Array["pro" + "totype"], "then", { value: () => {} });`,
    `Object?.defineProperty(Object.getPrototypeOf([]), "then", { value: () => {} });`,
    `Reflect?.set(Object.getPrototypeOf([]), "then", () => {});`,
    `const objectAlias = Object; objectAlias.defineProperty(objectAlias.getPrototypeOf([]), "then", { value: () => {} });`,
    `const reflectAlias = Reflect; reflectAlias.set(Object.getPrototypeOf([]), "then", () => {});`,
    `const { defineProperty, getPrototypeOf } = Object; defineProperty(getPrototypeOf([]), "then", { value: () => {} });`,
    `const constructorAlias = (() => {}).constructor; constructorAlias("return 1")();`,
    `const optionalConstructorAlias = (() => {}).constructor; optionalConstructorAlias?.("return 1")();`,
    `const setterAlias = ({}).__defineSetter__; setterAlias("then", () => {});`,
    `const optionalSetterAlias = ({}).__defineSetter__; optionalSetterAlias?.("then", () => {});`,
    `const alias = {}; delete alias.then;`,
    `Function("return Array.prototype")();`,
  ]) {
    assert.throws(
      () => parseRedirectFixture(`
        ${mutation}
        const nextConfig: NextConfig = {
          async redirects() {
            return [{ source: "/safe.html", destination: "/safe", permanent: true }];
          },
        };
        export default nextConfig;
      `),
      /live mutation construct/,
    );
  }

  const parsed = parseRedirectFixture(`
    const nextConfig: NextConfig = {
      async redirects() {
        return [{ source: "/safe.html", destination: "/safe", permanent: true }];
      },
    };
    export default nextConfig;
  `);
  assert.deepEqual(parsed, [{ source: "/safe.html", destination: "/safe", permanent: true }]);
  assert.throws(
    () => parseRedirectFixture(`
      const nextConfig: NextConfig = {
        async redirects() {
          return
          [{ source: "/safe.html", destination: "/safe", permanent: true }];
        },
      };
      export default nextConfig;
    `),
    /return and its literal array must remain on the same line/,
  );
  assert.throws(
    () => parseRedirectFixture(`
      const legacyHtmlRedirects = [["/safe.html", "/safe"]] as const;
      const nextConfig: NextConfig = {
        async redirects() {
          return legacyHtmlRedirects.map(([source, destination]) => ({ source, destination, permanent: true }));
        },
      };
      export default nextConfig;
    `),
    /redirects\(\) expected \[/,
  );
});

test("rejects a top-level nextConfig spread that can override redirects", () => {
  assert.throws(
    () => parseRedirectFixture(`
      const alternate = { redirects: async () => [] };
      const nextConfig: NextConfig = {
        async redirects() {
          return [{ source: "/safe.html", destination: "/safe", permanent: true }];
        },
        ...alternate,
      };
      export default nextConfig;
    `),
    /must not use a top-level object spread/,
  );
});

test("rejects a computed nextConfig member that can override redirects", () => {
  assert.throws(
    () => parseRedirectFixture(`
      const nextConfig: NextConfig = {
        async redirects() {
          return [{ source: "/safe.html", destination: "/safe", permanent: true }];
        },
        ["redirects"]: async () => [{ source: "/safe.html", destination: "https://outside.example/safe", permanent: true }],
      };
      export default nextConfig;
    `),
    /must not use top-level computed members/,
  );
});

test("rejects a template interpolation that can mutate redirects before export", () => {
  assert.throws(
    () => parseRedirectFixture(`
      const nextConfig: NextConfig = {
        async redirects() {
          return [{ source: "/safe.html", destination: "/safe", permanent: true }];
        },
      };
      \`${"${"}(nextConfig.redirects = async () => [{ source: "/safe.html", destination: "https://outside.example/safe", permanent: true }])}\`
      export default nextConfig;
    `),
    /template interpolation is unsupported/,
  );
});

test("rejects eval even when the redirect literal remains structurally direct", () => {
  assert.throws(
    () => parseRedirectFixture(`
      eval("Array.prototype.map = () => []");
      const nextConfig: NextConfig = {
        async redirects() {
          return [{ source: "/safe.html", destination: "/safe", permanent: true }];
        },
      };
      export default nextConfig;
    `),
    /must not use eval/,
  );
});

test("rejects quoted, shorthand, and escaped redirect member overrides", () => {
  for (const { setup = "", member, expected } of [
    {
      member: `"redirects": async () => [{ source: "/safe.html", destination: "https://outside.example/safe", permanent: true }]`,
      expected: /must not use top-level quoted members/,
    },
    {
      setup: `const redirects = async () => [{ source: "/safe.html", destination: "https://outside.example/safe", permanent: true }];`,
      member: "redirects",
      expected: /exactly one depth-one async redirects/,
    },
    {
      member: `redirec\\u0074s: async () => [{ source: "/safe.html", destination: "https://outside.example/safe", permanent: true }]`,
      expected: /live code escapes are unsupported/,
    },
  ]) {
    assert.throws(
      () => parseRedirectFixture(`
        ${setup}
        const nextConfig: NextConfig = {
          async redirects() {
            return [{ source: "/safe.html", destination: "/safe", permanent: true }];
          },
          ${member},
        };
        export default nextConfig;
      `),
      expected,
    );
  }
});

test("binds production redirects to the exact reviewed non-redirect next.config skeleton", () => {
  const nextConfigPath = path.resolve("apps/web/next.config.ts");
  const source = readFileSync(nextConfigPath, "utf8");
  assert.equal(parseNextConfigLegacyRedirects(source).length, 19);

  for (const prefix of [
    `process.getBuiltinModule("node:vm").runInThisContext("Array.prototype.map = () => [];");\n`,
    `import { runInThisContext as executeConfig } from "node:vm";\nexecuteConfig("Array.prototype.map = () => [];");\n`,
    `import "data:text/javascript,globalThis.CONFIG_SIDE_EFFECT=true";\n`,
    `const configRuntime = process.getBuiltinModule("node:vm");\nconfigRuntime.runInThisContext("Array.prototype.map = () => [];");\n`,
  ]) {
    assert.throws(
      () => parseNextConfigLegacyRedirects(`${prefix}${source}`),
      /non-redirect skeleton does not match the reviewed contract/,
    );
  }

  const methodStart = "  async redirects() {\n    return [";
  assert(source.includes(methodStart));
  for (const terminator of ["\r", "\n", "\r\n", "\u2028", "\u2029"]) {
    const hostileBody = source.replace(
      methodStart,
      `  async redirects() {\n    // reviewed comment${terminator}globalThis.__ROUTE_PARSER_SENTINEL__ = true;\n    return [`,
    );
    assert.throws(
      () => parseNextConfigLegacyRedirects(hostileBody),
      /live mutation construct|redirects\(\) expected return/,
    );

    const commentOnlyBody = source.replace(
      methodStart,
      `  async redirects() {\n    // reviewed comment${terminator}    return [`,
    );
    assert.equal(parseNextConfigLegacyRedirects(commentOnlyBody).length, 19);
  }
});

test("redacts untrusted actual redirect values from bounded comparison diagnostics", () => {
  const sentinel = `MOCHIRII_PRIVATE_REDIRECT_SENTINEL_${"X".repeat(600)}`;
  const failures = compareRedirectContracts([
    { source: "/safe.html", destination: "/safe", permanent: true },
  ], [
    { source: `/${sentinel}`, destination: `/${sentinel}`, permanent: true },
    { source: `/${sentinel}`, destination: `/${sentinel}`, permanent: true },
  ]);

  assert(failures.some((failure) => failure.includes("duplicate redirect source")));
  assert(failures.some((failure) => failure.includes("undocumented redirect")));
  assert(failures.some((failure) => failure.includes("documented redirect /safe.html")));
  assert(failures.every((failure) => !failure.includes(sentinel)));
  assert(failures.every((failure) => failure.length <= APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters));
});
