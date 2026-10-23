import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { normalizeProductionHomeSpotlightStreaming as normalize } from "./check-production.mjs";

// Parse the pinned framework's string literals; never evaluate framework or
// response JavaScript. This independent oracle catches dependency output drift.
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiledPath = require.resolve("next/dist/compiled/react-dom/cjs/react-dom-server.node.production.js");
const compiled = ts.createSourceFile(compiledPath, readFileSync(compiledPath, "utf8"), ts.ScriptTarget.Latest, true);
const literals = [];
function visit(node) {
  if (ts.isStringLiteral(node)) literals.push(node.text);
  ts.forEachChild(node, visit);
}
visit(compiled);
const helpers = literals.filter(value => value.startsWith("$RB=[];$RV="));
assert.equal(helpers.length, 1);
const helper = helpers[0];
const timing = "requestAnimationFrame(function(){$RT=performance.now()});";

function card(title = "Member Spotlight") {
  return '<div class="home-spotlight" id="spotlightCard"><img id="spotlightImage" class="home-spotlight__img" src="/assets/img/featured/spotlight.webp" width="1536" height="1024" alt="Member Spotlight cover"><div class="home-spotlight__plate"><span id="spotlightTag" class="home-pill">Current Spotlight</span><h3 id="spotlightTitle" class="home-title">' + title + '</h3><p id="spotlightSummary" class="home-summary">Community recognition.</p><a class="home-link" href="/spotlight">View Spotlight <span aria-hidden="true">↗</span></a></div></div>';
}
function fixture({ id = "0", title = "Member Spotlight" } = {}) {
  return '<!doctype html><html><head><title>Where Winds Meet</title></head><body><main id="main"><section class="home-supporting-card" aria-label="Member spotlight"><h2 class="sr-only">Member Spotlight</h2><!--$?--><template id="B:' + id + '"></template>' + card() + '<!--/$--></section></main><script>' + timing + '</script><div hidden id="S:' + id + '">' + card(title) + '</div><script>' + helper + '$RC("B:' + id + '","S:' + id + '")</script><script>(self.__next_f=self.__next_f||[]).push([0])</script></body></html>';
}

test("pinned completion resolves only Spotlight and preserves ordinary scripts", () => {
  for (const id of ["0", "1", "12", "999"]) {
    for (const title of ["Member Spotlight", "A member", "A &amp; B &lt;member&gt;"]) {
      const input = fixture({ id, title }), result = normalize(input);
      assert.ok(result);
      assert.ok(result.includes("<!--$-->" + card(title) + "<!--/$-->"));
      assert.ok(result.includes("<script>(self.__next_f=self.__next_f||[]).push([0])</script>"));
      assert.equal(result.includes("$RB="), false);
      assert.equal(result.includes('id="S:'), false);
      assert.equal(result.includes('id="B:'), false);
      assert.equal((result.match(/id="spotlightCard"/g) || []).length, 1);
      assert.equal(normalize(result), result);
    }
  }
});

const hostile = {
  "mutated helper": html => html.replace("$RB=[];", "$RB=[1];"),
  "appended completion code": html => html.replace('$RC("B:0","S:0")', '$RC("B:0","S:0");alert(1)'),
  "appended timing code": html => html.replace(timing, timing + "alert(1)"),
  "unknown script attribute": html => html.replace("<script>" + timing, '<script nonce="other">' + timing),
  "completion attribute": html => html.replace("<script>" + helper, '<script type="text/javascript">' + helper),
  "unpaired IDs": html => html.replace('id="S:0"', 'id="S:1"'),
  "duplicate receiver": html => html.replace("</body>", '<div hidden id="S:0">' + card() + "</div></body>"),
  "duplicate target": html => html.replace("</main>", '<template id="B:0"></template></main>'),
  "duplicate owner": html => html.replace("</main>", '<section class="home-supporting-card" aria-label="Member spotlight"></section></main>'),
  "leading-zero IDs": () => fixture({ id: "00" }),
  "negative ID": () => fixture({ id: "-1" }),
  "overlong ID": () => fixture({ id: "1000" }),
  "nondecimal ID": () => fixture({ id: "a" }),
  "unknown replacement root": html => html.replace('id="S:0">' + card(), 'id="S:0"><div>other</div>'),
  "multiple replacement roots": html => html.replace('id="S:0">', 'id="S:0"><div>extra</div>'),
  "replacement script": html => html.replace('id="S:0">', 'id="S:0"><script>alert(1)</script>'),
  "replacement active descendant": html => html.replace("Community recognition.</p>", 'Community recognition.<iframe src="/events"></iframe></p>'),
  "event handler": html => html.replace('alt="Member Spotlight cover"', 'onerror="alert(1)" alt="Member Spotlight cover"'),
  "foreign destination": html => html.replace('href="/spotlight"', 'href="https://example.invalid/"'),
  "fallback external image": html => html.replace('src="/assets/img/featured/spotlight.webp"', 'src="https://example.invalid/tracker.png"'),
  "fallback external srcset": html => html.replace('src="/assets/img/featured/spotlight.webp"', 'src="/assets/img/featured/spotlight.webp" srcset="https://example.invalid/tracker.png 100w"'),
  "fallback resource on passive tag": html => html.replace('id="spotlightTag"', 'src="https://example.invalid/tracker.png" id="spotlightTag"'),
  "unsafe fallback style": html => html.replace('id="spotlightTag"', 'style="position:fixed;inset:0" id="spotlightTag"'),
  "unknown class": html => html.replace('class="home-summary"', 'class="unknown"'),
  "unknown ID": html => html.replace('id="spotlightTitle"', 'id="foreignTitle"'),
  "duplicate card ID": html => html.replace('id="spotlightTag"', 'id="spotlightTitle"'),
  "duplicate attribute": html => html.replace('id="spotlightTag"', 'id="spotlightTag" id="other"'),
  "hidden owner": html => html.replace('<section class=', '<section hidden class='),
  "inert owner": html => html.replace('<section class=', '<section inert class='),
  "hidden replacement": html => html.replace('id="S:0">' + card(), 'id="S:0">' + card().replace('<div class=', '<div hidden class=')),
  "footer target": html => html.replace('<main id="main">', '<main id="main"><footer>').replace('</main>', '</footer></main>'),
  "header target": html => html.replace('<main id="main">', '<main id="main"><header>').replace('</main>', '</header></main>'),
  "inert target": html => html.replace('<main id="main">', '<main id="main"><template>').replace('</main>', '</template></main>'),
  "foreign namespace": html => html.replace('<main id="main">', '<main id="main"><svg>').replace('</main>', '</svg></main>'),
  "missing boundary comment": html => html.replace('<!--$?-->', ''),
  "extra pending boundary": html => html.replace('</main>', '<!--$?--></main>'),
  "missing ending comment": html => html.replace('<!--/$-->', ''),
  "clock reordered": html => html.replace('<script>' + timing + '</script>', '').replace('</body>', '<script>' + timing + '</script></body>'),
  "receiver in main": html => html.replace('</main>', '').replace('<script>' + helper, '</main><script>' + helper),
  "duplicate globally owned ID": html => html.replace('</main>', '<div id="spotlightCard"></div></main>'),
  "truncated document": html => html.slice(0, -10),
  "depth bound": html => html.replace('<main id="main">', '<main id="main">' + '<div>'.repeat(65)).replace('</main>', '</div>'.repeat(65) + '</main>'),
  "byte bound": html => html + ' '.repeat(1024 * 1024),
};
for (const [name, mutate] of Object.entries(hostile)) {
  test("stream completion rejects " + name, () => assert.equal(normalize(mutate(fixture())), null));
}

test("ordinary documents and unknown inline scripts still reach unchanged guards", async () => {
  const ordinary = '<!doctype html><html><head></head><body><main id="main">Visible</main><script>alert(1)</script></body></html>';
  assert.equal(normalize(ordinary), ordinary);
  const checkerUrl = new URL("./check-production.mjs", import.meta.url);
  const source = readFileSync(checkerUrl, "utf8").replaceAll("import.meta.url", JSON.stringify(checkerUrl.href))
    + '\nexport {productionScriptTagIsSafe, parseHtmlTagAt};\n';
  const { productionScriptTagIsSafe: safe, parseHtmlTagAt: parse } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  assert.equal(safe(parse("<script>", 0), "alert(1)"), false);
  assert.equal(safe(parse("<script>", 0), helper + '$RC("B:0","S:0")'), false);
  assert.equal(safe(parse("<script>", 0), timing), false);
});
