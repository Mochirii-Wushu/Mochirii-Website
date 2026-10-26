import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { chromium, firefox, webkit } from "playwright";

const index = process.argv.indexOf("--base-url"), base = new URL(process.argv[index + 1] || "invalid:");
assert(index >= 0 && base.origin === "http://127.0.0.1:8765", "Explicit reviewed loopback origin required");
const output = path.resolve(".artifacts/operations/homepage-preview-4/pvp-fixtures");
await fs.mkdir(output, { recursive: true });
const require = createRequire(path.resolve("apps/web/package.json")), ts = require("typescript"), React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const compile = (filename, module = ts.ModuleKind.CommonJS) => ts.transpileModule(readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module, jsx: ts.JsxEmit.React, jsxFactory: "fixtureJSX" },
}).outputText;
function load(filename) {
  const mod = { exports: {} }, source = compile(filename);
  const local = specifier => specifier === "./HomePvpPlayback" ? { HomePvpPlayback: ({ children }) => React.createElement("div", { className: "home-pvp-grid" }, children) }
    : specifier === "@/lib/pvp-clips" ? load(path.resolve("apps/web/lib/pvp-clips.ts")) : require(specifier);
  runInThisContext("(function(require,module,exports,fixtureJSX){" + source + "\n})", { filename })(local, mod, mod.exports, React.createElement);
  return mod.exports;
}
const { HomePvpHighlights } = load(path.resolve("apps/web/components/home/HomePvpHighlights.tsx"));
const clips = Array.from({ length: 4 }, (_, n) => ({ id: "fixture-" + n, title: "Local playback fixture " + n,
  description: "Neutral synthetic video, not a guild clip.", durationSeconds: 2, width: 320, height: 180,
  source: `/assets/home/pvp/fixture-${n}/clip-h264.mp4`, poster: `/assets/home/pvp/fixture-${n}/poster.webp`,
  ...(n === 0 ? { captions: { source: "/assets/home/pvp/fixture-0/captions.vtt", language: "en", label: "English" }, transcript: "Fixture caption text." } : {}) }));
const markup = renderToStaticMarkup(React.createElement(HomePvpHighlights, { clips }));
const intent = "const fixtureJSX=(_tag,props)=>({props});\n" + compile("apps/web/components/home/HomePvpPlayback.tsx", ts.ModuleKind.ES2022)
  + "\nconst root=document.querySelector('.home-pvp-grid');const model=HomePvpPlayback({children:null,className:'home-pvp-grid'});root.onclick=model.props.onClick;window.disposePvp=model.props.ref(root);";
const player = compile("apps/web/components/home/pvp-player.ts", ts.ModuleKind.ES2022);
const poster = await fs.readFile("apps/web/public/assets/home/scenery/bamboo-valley-tall-1024.webp");
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local PvP fixture</title><style>body{background:#10251f;color:#fff5e4;font:16px serif;margin:24px}.home-pvp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0}img,video{display:block;width:100%;height:auto} [hidden]{display:none} a{color:inherit}video:focus{outline:3px solid gold}</style></head><body>' + markup + '<script type="module" src="/__pvp-fixture__/intent.mjs"></script></body></html>';

// No source footage or external writes: create a silent two-second native
// diagnostic locally. This does not establish real-clip or audio acceptance.
const encoder = await chromium.launch();
const encoderPage = await encoder.newPage();
const encoded = await encoderPage.evaluate(async () => {
  const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
  const context = canvas.getContext("2d"), stream = canvas.captureStream(20);
  const mime = ["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp8"].find(value => MediaRecorder.isTypeSupported(value));
  if (!mime) throw Error("Neutral fixture recorder unavailable");
  const chunks = [], recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 180000 });
  const done = new Promise(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = resolve; });
  recorder.start(); let frame = 0;
  const timer = setInterval(() => { context.fillStyle = "#245e4b"; context.fillRect(0,0,320,180); context.fillStyle = "#e3c684"; context.fillRect((frame++ * 6) % 280,65,40,40); },50);
  await new Promise(resolve => setTimeout(resolve,2100)); clearInterval(timer); recorder.stop(); await done;
  stream.getTracks().forEach(track => track.stop());
  return { mime, bytes: Array.from(new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer())) };
});
const video = Buffer.from(encoded.bytes); await encoder.close();
await fs.writeFile(path.join(output,encoded.mime.startsWith("video/mp4")?"neutral-silent-h264.mp4":"neutral-silent-vp8.webm"),video);
await fs.writeFile(path.join(output,"codec.json"),JSON.stringify({mime:encoded.mime,bytes:video.length,source:"Native MediaRecorder; synthetic silent diagnostic only"},null,2));
const results = [];
for (const engine of [chromium, firefox, webkit]) {
  let browser;
  try { browser = await engine.launch(); } catch (error) { results.push({ engine: engine.name(), status: "unavailable", reason: error.message.split("\n")[0] }); continue; }
  for (const scenario of ["normal", "motion-off", "reduced", "error", "no-js"]) {
    const ctx = await browser.newContext({ viewport: {width:390,height:844}, deviceScaleFactor:1,
      javaScriptEnabled:scenario!=="no-js", reducedMotion:scenario==="reduced"?"reduce":"no-preference", serviceWorkers:"block" });
    const requests = [], errors = [];
    await ctx.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      // WebKit uses owned blob URLs for routed native media internally. They
      // stay within this fixture's memory and never contact another origin.
      if(url.protocol==="blob:" && url.origin===base.origin)return route.continue();
      if(url.origin!==base.origin || !["GET","HEAD"].includes(request.method()))return route.abort();
      requests.push(url.pathname);
      if(url.pathname==="/__pvp-fixture__")return route.fulfill({contentType:"text/html",body:html});
      if(url.pathname==="/__pvp-fixture__/intent.mjs")return route.fulfill({contentType:"application/javascript",body:intent});
      if(url.pathname==="/__pvp-fixture__/pvp-player")return route.fulfill({contentType:"application/javascript",body:player});
      if(url.pathname.endsWith("poster.webp"))return route.fulfill({contentType:"image/webp",body:poster});
      if(url.pathname.endsWith("captions.vtt"))return route.fulfill({contentType:"text/vtt",body:"WEBVTT\n\n00:00.000 --> 00:02.000\nFixture caption text.\n"});
      if(url.pathname.endsWith(".mp4")){
        if(scenario==="error")return route.fulfill({status:404,body:"Unavailable"});
        const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers().range||"");
        if(range){const start=Number(range[1]),end=Math.min(video.length-1,range[2]?Number(range[2]):video.length-1);
          assert(start<=end);return route.fulfill({status:206,contentType:encoded.mime.split(";")[0],headers:{"accept-ranges":"bytes","content-range":`bytes ${start}-${end}/${video.length}`},body:video.subarray(start,end+1)});}
        return route.fulfill({contentType:encoded.mime.split(";")[0],headers:{"accept-ranges":"bytes"},body:video});
      }
      return route.abort();
    });
    const page=await ctx.newPage(); page.on("pageerror", error=>errors.push(error.message));
    if(scenario==="motion-off")await ctx.addInitScript(()=>localStorage.setItem("mochirii.decorative-motion.v1","off"));
    await page.goto(new URL("/__pvp-fixture__",base).href,{waitUntil:"load"});
    await page.waitForTimeout(250);
    assert(!requests.some(url=>url.endsWith(".mp4")||url.endsWith("captions.vtt")||url.endsWith("/pvp-player")),"No media/player controller before intent");
    assert.equal(await page.locator("video[src]").count(),0);
    if(scenario==="no-js") {
      assert.equal(await page.locator("a[data-pvp-play]").count(),4);
      assert.equal(await page.locator("a[data-pvp-play]").first().getAttribute("href"),clips[0].source);
    } else {
      await page.locator("a[data-pvp-play]").first().click();
      if(scenario==="error"){
        await page.waitForFunction(()=>document.querySelector("[data-pvp-status]").textContent.includes("could not be loaded"));
        assert(await page.locator(".home-pvp-play").first().isVisible());
      }else{
        await page.waitForFunction(()=>document.querySelector("video").currentTime>0 || document.querySelector("[data-pvp-status]").textContent || document.querySelector("video").error,undefined,{timeout:8000}).catch(()=>{});
        if((await page.locator("[data-pvp-status]").first().innerText()).includes("Use the player controls"))await page.locator("video").first().press("Space");
        const supported=await page.waitForFunction(()=>document.querySelector("video").currentTime>0,undefined,{timeout:8000}).then(()=>true,()=>false);
        if(!supported){
          assert.deepEqual(errors,[]);
          const diagnostic=await page.locator("video").first().evaluate((v,mime)=>({source:v.getAttribute("src"),codec:v.canPlayType(mime),error:v.error?.code,readyState:v.readyState,networkState:v.networkState,paused:v.paused,hidden:document.hidden,status:document.querySelector("[data-pvp-status]").textContent}),encoded.mime);
          await fs.writeFile(path.join(output,engine.name()+"-playback-diagnostic.json"),JSON.stringify({diagnostic,requests,errors,mime:encoded.mime},null,2));
          await page.screenshot({path:path.join(output,engine.name()+"-playback-diagnostic.png"),fullPage:true});
          assert(diagnostic.source && (!diagnostic.codec || diagnostic.error===4),"Playback failure is not established as a missing codec: "+JSON.stringify(diagnostic));
          results.push({engine:engine.name(),scenario,status:"unavailable",reason:"Synthetic native codec playback unavailable; accepted clips still pending",diagnostic});await ctx.close();continue;
        }
        assert.equal(await page.locator("video").first().evaluate(v=>v.textTracks.length),1);
        await page.locator("a[data-pvp-play]").nth(1).click();
        await page.waitForFunction(()=>document.querySelectorAll("video")[1].currentTime>0);
        assert.equal(await page.locator("video").evaluateAll(v=>v.filter(x=>!x.paused&&!x.ended).length),1);
        await page.evaluate(()=>window.disposePvp());
        assert.equal(await page.locator("video[src]").count(),0);
      }
    }
    assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(output,engine.name()+"-"+scenario+".png"),fullPage:true});
    results.push({engine:engine.name(),version:browser.version(),scenario,status:"passed",videoFixture:encoded.mime+"; silent synthetic diagnostic; actual clip/audio QA not established",requestsBeforeIntent:"no video, captions or player controller",scope:"Actual intent-handler and player-controller source; JSX construction shim and routed local fixture markup/media"});
    await ctx.close();
  }
  await browser.close();
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify(results,null,2));
}
console.log(JSON.stringify(results));
