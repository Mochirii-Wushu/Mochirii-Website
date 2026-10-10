import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./check-hosted-public-boundaries.mjs", import.meta.url), "utf8");
const start = source.indexOf("function expectHtml(");
const end = source.indexOf("function expectJson(");
assert.ok(start >= 0 && end > start);
const { expectMaintenance } = vm.runInNewContext(`${source.slice(start, end)}\n({ expectMaintenance });`);

function fixture(surface = "Social") {
  const origin = `https://${surface.toLowerCase()}.mochirii.com`;
  return { origin, surface, result: {
    status: 200, url: `${origin}/`, contentType: "text/html; charset=utf-8",
    headers: new Headers({
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
    }),
    body: `<!doctype html><html><head><title>${surface} · Coming Soon · Mōchirīī</title></head><body><header><nav aria-label="Primary"><a href="https://mochirii.com/events">Events</a></nav></header><main><h1>Mōchirīī ${surface}</h1><p>Coming Soon</p></main><footer><a href="https://mochirii.com/privacy">Privacy</a></footer></body></html>`,
  } };
}

test("explicit Social and Forums maintenance contracts accept complete static shells", () => {
  for (const surface of ["Social", "Forums"]) {
    const f = fixture(surface);
    assert.doesNotThrow(() => expectMaintenance(f.result, f.origin, f.surface));
  }
});

test("maintenance verification rejects wrong origins, fallback documents, missing shell parts and active content", () => {
  const changes = [
    (r) => { r.status = 404; },
    (r) => { r.url = "https://unrelated.example/"; },
    (r) => { r.url += "login"; },
    (r) => { r.contentType = "application/json"; },
    (r) => { r.body = r.body.replace("<!doctype html>", ""); },
    (r) => { r.body = r.body.replace("Social · Coming Soon", "Social · Welcome"); },
    (r) => { r.body = r.body.replace("<header>", "<div>"); },
    (r) => { r.body += "<footer></footer>"; },
    (r) => { r.body = r.body.replace('aria-label="Primary"', 'aria-label="Other"'); },
    (r) => { r.body = r.body.replace("https://mochirii.com/events", "/events"); },
    (r) => { r.body = r.body.replace("https://mochirii.com/privacy", "/privacy"); },
    (r) => { r.body += "<script src='/app.js'></script>"; },
    (r) => { r.body += "<iframe></iframe>"; },
    (r) => { r.body += "<form></form>"; },
    (r) => { r.body += '<button onclick="run()">Go</button>'; },
    (r) => { r.body += '<a href="javascript:run()">Go</a>'; },
    (r) => { r.body += '<meta http-equiv="refresh" content="0;url=https://unrelated.example/">'; },
    (r) => { r.body += "<meta content='0;url=https://unrelated.example/' HTTP-EQUIV=REFRESH>"; },
    (r) => { r.body += '<meta http-equiv="re&#102;resh" content="0;url=https://unrelated.example/">'; },
    (r) => { r.headers.set("refresh", "0;url=https://unrelated.example/"); },
  ];
  for (const change of changes) {
    const f = fixture(); change(f.result);
    assert.throws(() => expectMaintenance(f.result, f.origin, f.surface));
  }
});

test("maintenance verification rejects weakened or missing security headers", () => {
  for (const header of ["content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy"]) {
    const f = fixture(); f.result.headers.delete(header);
    assert.throws(() => expectMaintenance(f.result, f.origin, f.surface));
  }
  for (const directive of ["default-src", "base-uri", "form-action", "frame-ancestors"]) {
    const f = fixture(); f.result.headers.set("content-security-policy", f.result.headers.get("content-security-policy").replace(`${directive} 'none'`, `${directive} 'self'`));
    assert.throws(() => expectMaintenance(f.result, f.origin, f.surface));
  }
  const f = fixture(); f.result.headers.append("content-security-policy", "; script-src 'unsafe-inline'");
  assert.throws(() => expectMaintenance(f.result, f.origin, f.surface));
  for (const directive of ["default-src", "frame-ancestors"]) {
    const f = fixture(); f.result.headers.set("content-security-policy", `${directive.toUpperCase()} *; ${f.result.headers.get("content-security-policy")}`);
    assert.throws(() => expectMaintenance(f.result, f.origin, f.surface));
  }
});
