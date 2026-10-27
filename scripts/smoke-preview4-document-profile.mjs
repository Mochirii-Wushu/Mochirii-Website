import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Requires the reviewed, built loopback app. No production default, actions,
// provider calls, persisted HTML, credentials or writable remote fixtures.
const base = new URL(process.argv[2] || "invalid:");
if (base.origin !== "http://127.0.0.1:8765") throw new Error("Explicit reviewed loopback origin required");
const checkerUrl = new URL("./check-production.mjs", import.meta.url);
const source = readFileSync(checkerUrl, "utf8").replaceAll("import.meta.url", JSON.stringify(checkerUrl.href))
  + "\nexport {readSealedPreview4Document, readSealedPreview3Document, readActiveProductionHtml, PRODUCTION_DOCUMENT_POLICIES, productionHtmlNamespaceMatchesPath};\n";
const {readSealedPreview4Document: read4, readSealedPreview3Document: read3, readActiveProductionHtml: active, PRODUCTION_DOCUMENT_POLICIES: policies, productionHtmlNamespaceMatchesPath: namespace, normalizeProductionHomeSpotlightStreaming: complete} = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const read = (html, options) => options.resourceProfile === "home" ? read4(html, options) : read3(html, options);
let checks = 0;
const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
function mapFlight(html, transform, label) {
  let stream = "";
  const pattern = /<script>self\.__next_f\.push\(([\s\S]*?)\)<\/script>/g;
  for (const m of html.matchAll(pattern)) stream += JSON.parse(m[1])[1];
  const changed = transform(stream);
  if (label) assert.notEqual(changed, stream, label + " changes the intended Flight model");
  stream = changed;
  let used = false;
  return html.replace(pattern, () => {
    if (used) return "";
    used = true;
    return "<script>self.__next_f.push(" + JSON.stringify([1, stream]).replaceAll("<", "\\u003c") + ")</script>";
  });
}
const nativeBackgroundCandidates = [
  "/assets/home/background/wuxia-bg-640.webp 640w",
  "/assets/home/background/wuxia-bg-828.webp 828w",
  "/assets/home/background/wuxia-bg-1080.webp 1080w",
  "/assets/home/background/wuxia-bg-1200.webp 1200w",
  "/assets/home/background/wuxia-bg-1536.webp 1536w",
];
const nativeBackgroundSrcSet = nativeBackgroundCandidates.join(", ");
const swordSource = "/assets/home/transitions/sword-duel/forged-jian-1024.webp";
const heroSource = "/assets/home/hero/cherry-valley-dawn/cherry-valley-panorama-1344.webp";
function imageAttribute(tag, name) {
  return tag.match(new RegExp("\\s" + name + '="([^"]*)"', "i"))?.[1];
}
function imageAttributeChange(tag, name, value, label) {
  const pattern = new RegExp("(\\s" + name + '=")[^"]*(")', "i");
  assert.match(tag, pattern, label + " has target attribute");
  const changed = tag.replace(pattern, (_all, open, close) => open + escape(String(value)) + close);
  assert.notEqual(changed, tag, label + " changes target attribute");
  return changed;
}
function nativeBackgroundChange(html, attribute, value, label) {
  const tags = [...html.matchAll(/<img\b[^>]*>/g)].map(match => match[0])
    .filter(tag => imageAttribute(tag, "class") === "bg-photo__image");
  assert.equal(tags.length, 1, label + " has one native backdrop");
  const tag = tags[0];
  assert.equal(imageAttribute(tag, "srcSet"), nativeBackgroundSrcSet, label + " starts from all five canonical candidates");
  assert.equal(imageAttribute(tag, "src"), "/assets/bg/wuxia-bg.webp", label + " starts from original fallback");
  return html.replace(tag, imageAttributeChange(tag, attribute, value, label));
}
function flightImageChange(html, matchProps, edits, expected, label) {
  let changedCount = 0;
  const result = mapFlight(html, stream => stream.split("\n").map(line => {
    const colon = line.indexOf(":");
    if (colon < 0) return line;
    let value;
    try { value = JSON.parse(line.slice(colon + 1)); } catch { return line; }
    const before = changedCount;
    const visit = node => {
      if (Array.isArray(node)) {
        const props = node[0] === "$" && node[3] && typeof node[3] === "object" && !Array.isArray(node[3]) ? node[3] : null;
        if (props && matchProps(props)) {
          for (const [key, value] of Object.entries(edits)) props[key] = value;
          changedCount++;
        }
        for (const child of node) visit(child);
      } else if (node && typeof node === "object") for (const child of Object.values(node)) visit(child);
    };
    visit(value);
    return before === changedCount ? line : line.slice(0, colon + 1) + JSON.stringify(value);
  }).join("\n"), label + " Flight");
  assert.equal(changedCount, expected, label + " changes each actual Flight image");
  return result;
}
function coherentImageChange(html, kind, edits, label) {
  const hero = kind === "hero";
  const expected = hero ? 1 : 4;
  let changedCount = 0;
  const changedMarkup = html.replace(/<img\b[^>]*>/g, tag => {
    if (!(hero ? imageAttribute(tag, "id") === "heroImage" : imageAttribute(tag, "src") === swordSource)) return tag;
    changedCount++;
    for (const [key, value] of Object.entries(edits)) tag = imageAttributeChange(tag, key, value, label);
    return tag;
  });
  assert.equal(changedCount, expected, label + " changes each actual HTML image");
  assert.notEqual(changedMarkup, html, label + " changes HTML independently of Flight");
  return flightImageChange(changedMarkup, props => hero ? props.id === "heroImage" : props.src === swordSource, edits, expected, label);
}
const nativeResourceMutations = {
  "native candidate substitution": h => nativeBackgroundChange(h, "srcSet", nativeBackgroundSrcSet.replace("wuxia-bg-1200.webp", "unregistered.webp"), "native candidate substitution"),
  "native candidate registered-slot substitution": h => nativeBackgroundChange(h, "srcSet", nativeBackgroundSrcSet.replace("/assets/home/background/wuxia-bg-1200.webp", heroSource), "registered-slot substitution"),
  "native candidate order": h => nativeBackgroundChange(h, "srcSet", [...nativeBackgroundCandidates].reverse().join(", "), "native candidate order"),
  "native candidate duplicate": h => nativeBackgroundChange(h, "srcSet", [...nativeBackgroundCandidates, nativeBackgroundCandidates[0]].join(", "), "native candidate duplicate"),
  "native candidate omission": h => nativeBackgroundChange(h, "srcSet", nativeBackgroundCandidates.filter((_, index) => index !== 3).join(", "), "native candidate omission"),
  "native candidate descriptor": h => nativeBackgroundChange(h, "srcSet", nativeBackgroundSrcSet.replace("640w", "641w"), "native candidate descriptor"),
  "native candidate query": h => nativeBackgroundChange(h, "srcSet", nativeBackgroundSrcSet.replace("wuxia-bg-1200.webp", "wuxia-bg-1200.webp?foreign=1"), "native candidate query"),
  "native fallback registered-slot substitution": h => nativeBackgroundChange(h, "src", "/assets/home/background/wuxia-bg-1536.webp", "native fallback substitution"),
  "native fallback query": h => nativeBackgroundChange(h, "src", "/assets/bg/wuxia-bg.webp?foreign=1", "native fallback query"),
  "native fallback encoding": h => nativeBackgroundChange(h, "src", "/%61ssets/bg/wuxia-bg.webp", "native fallback encoding"),
  "native sizes": h => nativeBackgroundChange(h, "sizes", "50vw", "native sizes"),
  "native loading": h => nativeBackgroundChange(h, "loading", "lazy", "native loading"),
  "native priority": h => nativeBackgroundChange(h, "fetchPriority", "high", "native priority"),
  "coherent hero registered source": h => coherentImageChange(h, "hero", {src: "/assets/bg/wuxia-bg.webp", width: 1536, height: 1024}, "coherent hero registered source"),
  "coherent hero loading": h => coherentImageChange(h, "hero", {loading: "lazy"}, "coherent hero loading"),
  "coherent hero priority": h => coherentImageChange(h, "hero", {fetchPriority: "low"}, "coherent hero priority"),
  "coherent sword registered source": h => coherentImageChange(h, "sword", {src: heroSource, width: 1344, height: 490}, "coherent sword registered source"),
  "coherent sword loading": h => coherentImageChange(h, "sword", {loading: "lazy"}, "coherent sword loading"),
  "coherent sword priority": h => coherentImageChange(h, "sword", {fetchPriority: "high"}, "coherent sword priority"),
};
// The backdrop is rendered inside the client shell, so its image is absent from
// the captured Flight model. Coherent model controls use the actual hero and four
// sword image props, with independent HTML/Flight target-count assertions.

function winner(html, name) {
  let stream = "", nameLabel, cardId;
  for (const m of html.matchAll(/<script>self\.__next_f\.push\(([\s\S]*?)\)<\/script>/g)) stream += JSON.parse(m[1])[1];
  const rows = stream.trimEnd().split("\n");
  for (const line of rows) {
    const colon = line.indexOf(":"), json = line.slice(colon + 1);
    if (!json.startsWith('["$","div",null,{"className":"home-spotlight","id":"spotlightCard"')) continue;
    const node = JSON.parse(json);
    cardId = line.slice(0, colon);
    const walk = v => {
      if (Array.isArray(v)) {
        if (v[3]?.href === "/spotlight") nameLabel = v[3]["aria-label"];
        for (const child of v) walk(child);
      } else if (v && typeof v === "object") for (const child of Object.values(v)) walk(child);
    };
    walk(node);
  }
  assert.ok(cardId && nameLabel);
  const newLabel = "Open " + name + "’s Member Spotlight";
  html = html.replace(/(<h3 class="home-title" id="spotlightTitle">)[\s\S]*?(<\/h3>)/,
    (_all, open, close) => open + escape(name) + close)
    .replace('aria-label="' + escape(nameLabel) + '"', 'aria-label="' + escape(newLabel) + '"');
  return mapFlight(html, input => input.split("\n").map(line => {
    if (!line.startsWith(cardId + ":")) return line;
    const v = JSON.parse(line.slice(cardId.length + 1));
    const walk = node => {
      if (Array.isArray(node)) {
        if (node[1] === "h3" && node[3]?.id === "spotlightTitle") node[3].children = name;
        if (node[3]?.href === "/spotlight") node[3]["aria-label"] = newLabel;
        for (const child of node) walk(child);
      } else if (node && typeof node === "object") for (const child of Object.values(node)) walk(child);
    };
    walk(v);
    return cardId + ":" + JSON.stringify(v);
  }).join("\n"));
}

const commonMutations = {
  "header parent": h => h.replace('<header id="site-header"', '<div><header id="site-header"').replace('</header>', '</header></div>'),
  "header destination": h => h.replace('href="/events"', 'href="/privacy"'),
  "unknown attribute": h => h.replace('class="site-shell"', 'class="site-shell" data-foreign="yes"'),
  "unknown image": h => h.replace('%2Fassets%2Fimg%2Fbrand%2Femblem.webp', '%2Fassets%2Fimg%2Fbrand%2Fother.webp'),
  "footer label": h => h.replace('>Privacy</a>', '>Different</a>'),
  "hidden footer legal": h => h.replace('<nav class="footer-legal"', '<nav hidden class="footer-legal"'),
  "footer overlay": h => h.replace('<div class="footer-bottom">', '<div class="footer-bottom" style="position:fixed;inset:0">'),
  "injected script": h => h.replace('</body>', '<script>alert(1)</script></body>'),
  "injected external script": h => h.replace('</body>', '<script src="https://example.invalid/evil.js"></script></body>'),
  "unknown Next import": h => h.replace('</body>', '<script src="/_next/static/chunks/123456789abcd.js" async=""></script></body>'),
  "foreign namespace": h => h.replace('</main>', '<svg><a href="https://example.invalid/">hidden</a></svg></main>'),
  "picture remains rejected": h => h.replace('</main>', '<picture><img src="/favicon.ico"></picture></main>'),
  "event handler": h => h.replace('id="main"', 'id="main" onclick="alert(1)"'),
  "metadata substitution": h => h.replace('rel="canonical"', 'rel="other"'),
  "prototype model": h => mapFlight(h, v => v + 'ff:{"__proto__":{"src":"https://example.invalid/"}}\n', "prototype model"),
  "Flight import substitution": h => mapFlight(h, v => v.replace('"SiteRouteShell"', '"DifferentShell"'), "Flight import substitution"),
  "Flight arbitrary record": h => mapFlight(h, v => v + 'ff:["$","div",null,{"children":"Injected"}]\n', "Flight arbitrary record"),
  "document byte bound": h => h + " ".repeat(1024 * 1024),
  "depth bound": h => h.replace('</main>', '<div>'.repeat(70) + '</div>'.repeat(70) + '</main>'),
};
for (const [profile, path] of Object.entries({home: "/", recruitment: "/recruitment", privacy: "/privacy", deletion: "/meta-data-deletion"})) {
  const start = Date.now(), response = await fetch(new URL(path, base), {redirect: "error"});
  assert.equal(response.status, 200);
  let bytes = 0, parts = [];
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error("HTML response bound");
    parts.push(chunk);
  }
  const original = Buffer.concat(parts).toString("utf8");
  const html = profile === "home" ? complete(original) : original;
  assert.ok(html);
  const runtime = profile === "home" ? {requestStartedAtMs: start, responseReceivedAtMs: Date.now()} : null;
  const options = {resourceProfile: profile, homeRuntime: runtime, reportDiagnostic() {}};
  const document = read(html, options);
  assert.ok(document, profile + " reviewed source oracle"); checks++;
  assert.ok(active(html, {...options, documentPolicies: policies}), profile + " production policy binding"); checks++;
  assert.equal(active(html, {...options, documentPolicies: {...policies}}), null, profile + " rejects a substituted policy dictionary"); checks++;
  assert.equal(document.footerLinkCount("/privacy", "Privacy"), 1); checks++;
  assert.equal(document.footerLegalLinkCount, 3); checks++;
  for (const [name, mutate] of Object.entries(commonMutations)) {
    const changed = mutate(html);
    assert.notEqual(changed, html, profile + " " + name + " fixture changes source");
    assert.equal(read(changed, options), null, profile + " rejects " + name); checks++;
  }
  if (profile === "home") {
    const client = () => ({baseUrl:base.origin,htmlNextStaticNamespaces:new Map(),nextStaticBuildId:null,diagnose:false});
    assert.equal(namespace(client(), "/", html), false, "generic namespace still rejects vectors"); checks++;
    assert.equal(namespace(client(), "/", html, {documentPolicies:policies,homeRuntime:runtime}), true, "availability requires complete P4 seal"); checks++;
    assert.equal(namespace(client(), "/", html, {documentPolicies:{...policies},homeRuntime:runtime}), false, "substituted policy cannot enable vectors"); checks++;
    const unknownVector = html.replace('/assets/home/icons/arrow-right.svg','/assets/home/icons/unknown.svg');
    assert.notEqual(unknownVector, html, "unknown vector fixture changes source");
    assert.equal(namespace(client(), "/", unknownVector, {documentPolicies:policies,homeRuntime:runtime}), false, "unknown vector fails availability"); checks++;
    assert.equal(namespace(client(), "/", html, {documentPolicies:policies,homeRuntime:{requestStartedAtMs:0,responseReceivedAtMs:1}}), false, "stale interval cannot enable vectors"); checks++;
    for (const name of ["Mochi", "花 & Friends", "O'Rin", "Member Spotlight"]) {
      const changed = winner(html, name);
      assert.ok(read(changed, options), "bounded winner " + name); checks++;
    }
    for (const name of ["x".repeat(121), "bad\u202ename", " leading", "two  spaces"]) {
      const changed = winner(html, name);
      assert.notEqual(changed, html, "invalid winner fixture changes source");
      assert.equal(read(changed, options), null, "rejects invalid winner"); checks++;
    }
    for (const [label, mutate] of Object.entries({
      "unregistered vector": h => h.replace('/assets/home/icons/arrow-right.svg','/assets/home/icons/unknown.svg'),
      "vector query": h => h.replace('/assets/home/icons/arrow-right.svg','/assets/home/icons/arrow-right.svg?foreign=1'),
      "unreviewed background": h => nativeBackgroundChange(h, "src", "/assets/bg/other.webp", "unreviewed background"),
      ...nativeResourceMutations,
      "unreviewed sword image": h => h.replace('forged-jian-1024.webp','unreviewed-jian.webp'),
      "interactive decorative spark pool": h => h.replace('class="home-sword-contact"','class="home-sword-contact" tabindex="0"'),
      "unreviewed sword stage attributes": h => h.replace('class="home-sword-duel"','class="home-sword-duel" data-write="true"'),
      "stale clock": h => mapFlight(h, s => s.replace(/"referenceTime":"[^"]+"/, '"referenceTime":"2000-01-01T00:00:00.000Z"'), "stale clock"),
      "schedule substitution": h => mapFlight(h, s => s.replace('"startTime":"', '"startTime":"00:'), "schedule substitution"),
      "event date": h => h.replace(/(id="featuredBulletinDate"[^>]*>)[^<]+/, '$1wrong'),
      "event title": h => h.replace(/(id="featuredBulletinTitle"[^>]*>)[^<]+/, '$1wrong'),
      "event state": h => h.replace('>Next Event</span>', '>Current Event</span>'),
      "event cover": h => h.replace('%2Fassets%2Fimg%2Fdiscord-events%2F', '%2Fassets%2Fimg%2Fother%2F'),
      "unrelated copy": h => h.replace('Join teams, events and community activities.', 'Different content.'),
      "unrelated Flight text": h => mapFlight(h, s => s.replace('Leadership roles are open.', 'Different update.'), "unrelated Flight text"),
    })) {
      const changed = mutate(html); assert.notEqual(changed, html, label + " fixture changes source");
      assert.equal(read(changed, options), null, label); checks++;
    }
  }
  console.log(JSON.stringify({profile, checks, status: "PASS"}));
}
console.log(JSON.stringify({checks, status: "PASS", scope: "Built local source oracles and hostile pure-document mutations; no external actions"}));
