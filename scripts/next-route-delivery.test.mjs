import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
let checker = readFileSync(new URL("./check-next-route-delivery.mjs", import.meta.url), "utf8");
// Execute the actual checker with in-memory source substitutions. Only the two
// import bindings are supplied by this fixture; no app files or subprocesses change.
for (const binding of ['import { readFileSync } from "node:fs";', 'import path from "node:path";']) {
  assert.equal(checker.split(binding).length, 2);
  checker = checker.replace(binding, "");
}
const sources = new Map();
function read(relative) {
  if (!sources.has(relative)) sources.set(relative, readFileSync(path.join(root, relative), "utf8"));
  return sources.get(relative);
}

function validate(overrides = {}) {
  const exited = {}, result = { code: 0, errors: [], output: [] };
  try {
    runInNewContext(checker, {
      path,
      readFileSync(filename, encoding) {
        assert.equal(encoding, "utf8");
        const relative = path.relative(root, filename).split(path.sep).join("/");
        assert(!relative.startsWith("../") && !path.isAbsolute(relative));
        return Object.hasOwn(overrides, relative) ? overrides[relative] : read(relative);
      },
      process: { cwd: () => root, exit(code) { result.code = code; throw exited; } },
      console: {
        error: (...values) => result.errors.push(values.join(" ")),
        log: (...values) => result.output.push(values.join(" ")),
      },
    }, { filename: "check-next-route-delivery.mjs" });
  } catch (error) { if (error !== exited) throw error; }
  return result;
}

function replace(relative, from, to = "") {
  const source = read(relative);
  assert(source.includes(from), `Fixture target is absent: ${relative}: ${from}`);
  return source.replaceAll(from, to);
}

function removeStyle(relative, style) {
  const source = read(relative);
  const imports = source.split("\n").filter(line => line.startsWith("import ") && line.includes("/" + style + '";'));
  assert.equal(imports.length, 1, `Expected one real CSS import: ${relative}: ${style}`);
  return source.replace(imports[0], "");
}

function rejects(relative, source, diagnostic) {
  const result = validate({ [relative]: source });
  assert.equal(result.code, 1);
  assert(result.errors.some(message => message.includes(diagnostic)), result.errors.join("\n"));
}

const home = "apps/web/app/page.tsx";
test("actual delivery checker accepts the current Home CSS contract", () => {
  const result = validate();
  assert.equal(result.code, 0, result.errors.join("\n"));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.output, ["Next route delivery validation OK."]);
});

for (const style of [
  "public-home-seal.css", "public-home-media.css", "public-home-bulletins.css", "public-home-doors.css",
  "public-home-visual.css", "public-home-pvp-swords.css", "shell-gallery-media.css", "shell-lightbox.css",
]) test(`Home rejects removal of required ${style}`, () => {
  rejects(home, removeStyle(home, style), `${home}: missing ${style}`);
});

test("Home rejects restoring its unused shared-content stylesheet", () => {
  rejects(home, 'import "./styles/public-content-shared.css";\n' + read(home), "home page: must not include public-content-shared.css");
});

for (const style of ["public-content-shared.css", "public-home-visual.css", "shell-lightbox.css"]) {
  test(`root layout rejects hoisting route-only ${style}`, () => {
    const layout = "apps/web/app/layout.tsx";
    rejects(layout, `import "./styles/${style}";\n` + read(layout), `root layout: must not include ${style}`);
  });
}

for (const route of [
  "join", "events", "announcements", "raffle", "spotify", "spotlight", "gallery", "leaders", "ranks", "tome",
  "recruitment", "twills", "privacy", "meta-data-deletion", "account", "auth", "social", "oauth/consent",
  "gallery-submit", "leader-dashboard",
]) test(`${route} retains its shared-content CSS requirement`, () => {
  const file = `apps/web/app/${route}/page.tsx`;
  rejects(file, removeStyle(file, "public-content-shared.css"), `${file}: missing public-content-shared.css`);
});

for (const [file, from, to, diagnostic] of [
  ["apps/web/next.config.ts", "outputFileTracingRoot: workspaceRoot,", "", "Next workspace root: missing outputFileTracingRoot: workspaceRoot,"],
  ["apps/web/app/not-found.tsx", 'id="main"', "", 'root not-found: missing id="main"'],
  [home, 'export const dynamic = "force-dynamic";', "", `missing export const dynamic = "force-dynamic";`],
  ["apps/web/components/public-pages/SpotlightWinnerTitle.tsx", "export async function SpotlightWinnerTitle", "export function SpotlightWinnerTitle", "spotlight title: missing export async function SpotlightWinnerTitle"],
  ["apps/web/lib/supabase/spotlight.ts", 'import "server-only";', "", 'spotlight lookup: missing import "server-only";'],
  ["apps/web/lib/supabase/spotlight-response.ts", 'cache: "no-store"', 'cache: "force-cache"', 'spotlight response: missing cache: "no-store"'],
  ["apps/web/components/HomeGalleryLightbox.tsx", "lazy(() =>", "eager(() =>", "home gallery: missing lazy(() =>"],
  ["apps/web/components/HomeGalleryLightbox.tsx", "useBodyScrollLock(openItem !== null && portalRoot !== null);", "", "home gallery: missing useBodyScrollLock(openItem !== null && portalRoot !== null);"],
  ["apps/web/components/HomeGalleryLightboxModal.tsx", "createPortal", "unported", "home gallery modal: missing createPortal"],
]) test(`delivery retains ${diagnostic}`, () => {
  rejects(file, replace(file, from, to), diagnostic);
});

test("Spinner not-found retains its opaque presentation", () => {
  const file = "apps/web/app/spinner/not-found.tsx";
  rejects(file, read(file) + "\n// Page not found\n", "opaque spinner not-found: must not include Page not found");
});
