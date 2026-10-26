import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

const webPackage = new URL("../apps/web/package.json", import.meta.url);
const ts = createRequire(webPackage)("typescript");
function compile(name) {
  const url = new URL(`../apps/web/components/${name}.ts`, import.meta.url);
  // Preserve the actual worker URL while compiling the modules into isolated VMs.
  const source = readFileSync(url, "utf8").replaceAll("import.meta.url", JSON.stringify(url.href));
  const result = ts.transpileModule(source, {
    fileName: fileURLToPath(url), reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  assert.deepEqual(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error), []);
  return result.outputText;
}
const mainSource = compile("home-scene");
const workerModule = readFileSync(new URL("../apps/web/components/home-scene-worker.js", import.meta.url), "utf8");
// The standalone worker is already JavaScript. Elide only its empty module
// marker for the VM, retaining the strict execution mode of a real module.
assert.match(workerModule, /\nexport \{\};\s*$/);
const workerSource = '"use strict";\n' + workerModule.replace(/\nexport \{\};\s*$/, "\n");

class EventHub {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) {
    this.listeners.get(name)?.delete(callback);
    if (!this.listeners.get(name)?.size) this.listeners.delete(name);
  }
  emit(name, event = {}) {
    for (const callback of [...this.listeners.get(name) || []]) callback(event);
    this[`on${name}`]?.(event);
  }
}

class SceneElement extends EventHub {
  dataset = {};
  children = [];
  properties = new Map();
  style = {
    setProperty: (name, value) => this.properties.set(name, value),
    removeProperty: name => this.properties.delete(name),
  };
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) {
    delete this.dataset[name.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
  }
  append(child) { this.children.push(child); child.parent = this; }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
  getBoundingClientRect() { return this.box || { width: 1198, height: 418 }; }
  contains(target) { return this.children.includes(target); }
  closest() { return null; }
}

// These doubles exercise the real controller's resource and failure paths.
// They do not implement a GLSL compiler or establish browser pixel correctness.
function workerFixture(options = {}) {
  const canvas = new SceneElement();
  const frames = new Map(), fetches = [], bitmaps = [], draws = [];
  const created = { shader: [], program: [], buffer: [], texture: [] };
  const deleted = { shader: [], program: [], buffer: [], texture: [] };
  let nextFrame = 0, contextLost = false, losses = 0, layer = 0, canvasRequests = 0;
  const allocate = (kind, attributes = {}) => {
    const value = { kind, ...attributes };
    created[kind].push(value);
    return value;
  };
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TEXTURE_2D: 8, TEXTURE_WRAP_S: 9,
    TEXTURE_WRAP_T: 10, CLAMP_TO_EDGE: 11, TEXTURE_MIN_FILTER: 12, TEXTURE_MAG_FILTER: 13,
    LINEAR: 14, RGBA: 15, UNSIGNED_BYTE: 16, BLEND: 17, SRC_ALPHA: 18,
    ONE_MINUS_SRC_ALPHA: 19, TRIANGLES: 20, NO_ERROR: 0,
    getShaderPrecisionFormat() { throw new Error("Synchronous precision query must not be used"); },
    createShader: type => allocate("shader", { type }),
    shaderSource(shader, source) { shader.source = source; },
    getShaderParameter(shader, parameter) {
      assert.equal(parameter, gl.COMPILE_STATUS);
      return options.compileFailure !== shader.type;
    },
    createProgram: () => allocate("program"),
    getProgramParameter(_program, parameter) {
      assert.equal(parameter, gl.LINK_STATUS);
      return !options.linkFailure;
    },
    createBuffer: () => allocate("buffer"),
    createTexture: () => allocate("texture"),
    getAttribLocation: () => 0,
    getUniformLocation: (_program, name) => ({ name }),
    uniform1f(location, value) { if (location.name === "uLayer") layer = value; },
    drawArrays(mode, first, count) { draws.push({ layer, mode, first, count }); },
    getError: () => options.firstFrameError ? 1 : 0,
    isContextLost: () => contextLost,
    getExtension(name) {
      assert.equal(name, "WEBGL_lose_context");
      return { loseContext() { losses++; contextLost = true; } };
    },
  };
  for (const name of ["compileShader", "attachShader", "linkProgram", "useProgram", "bindBuffer", "bufferData", "enableVertexAttribArray", "vertexAttribPointer", "bindTexture", "texParameteri", "texImage2D", "enable", "blendFunc", "uniform4fv", "viewport"]) gl[name] = () => {};
  for (const kind of Object.keys(created)) gl["delete" + kind[0].toUpperCase() + kind.slice(1)] = value => deleted[kind].push(value);
  canvas.getContext = (name, settings) => {
    canvasRequests++;
    assert.equal(name, "webgl");
    assert.equal(settings.powerPreference, "low-power");
    return options.noContext ? null : gl;
  };
  const module = { exports: {} }, messages = [];
  let output;
  const firstOutput = new Promise(resolve => { output = resolve; });
  const scope = {
    module, exports: module.exports, AbortController, setTimeout,
    postMessage(message) { messages.push(message); output(message); },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    async fetch(url, settings) {
      const index = fetches.length;
      fetches.push({ url, settings });
      return {
        ok: options.badStatus !== index,
        headers: { get: () => options.badMime === index ? "text/html" : "image/webp" },
        blob: async () => ({ index, size: options.oversizedBlob === index ? 220 * 1024 + 1 : 1000 }),
      };
    },
    async createImageBitmap(blob) {
      const bitmap = { width: options.oversizedBitmap === blob.index ? 1281 : 1280, height: 853, closed: 0, close() { this.closed++; } };
      bitmaps.push(bitmap);
      if (options.disposeDuringDecode === blob.index) scope.onmessage({ data: { type: "dispose" } });
      return bitmap;
    },
  };
  runInNewContext(workerSource, scope, { filename: "home-scene-worker.js" });
  const init = { type: "init", canvas, width: 1198, height: 418, crop: [0, 0, 1, 1], small: false };
  return {
    canvas, gl, created, deleted, bitmaps, fetches, draws, frames, messages, init,
    send: data => scope.onmessage({ data }),
    start() { scope.onmessage({ data: init }); return firstOutput; },
    get losses() { return losses; }, get canvasRequests() { return canvasRequests; },
    loseContext() { contextLost = true; },
    nextFrame(time) {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback(time);
    },
  };
}

function assertGpuReleased(fixture, { lost = false, noContext = false } = {}) {
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.canvas.listeners.size, 0);
  for (const bitmap of fixture.bitmaps) assert.equal(bitmap.closed, 1);
  for (const kind of Object.keys(fixture.created)) {
    assert.deepEqual(fixture.deleted[kind], lost ? [] : fixture.created[kind], `${kind} cleanup`);
  }
  assert.equal(fixture.losses, lost || noContext ? 0 : 1);
  for (const request of fixture.fetches) assert.equal(request.settings.signal.aborted, true);
}

test("actual worker paints three layers without querying precision, pauses and disposes once", async () => {
  const fixture = workerFixture();
  assert.equal((await fixture.start()).type, "ready");
  assert.equal(new Set(fixture.fetches.map(item => item.url)).size, 3);
  assert.deepEqual(fixture.draws.map(draw => draw.layer), [0, 1, 2]);
  assert.ok(fixture.draws.every(draw => draw.mode === fixture.gl.TRIANGLES && draw.count > 0));
  fixture.send({ type: "visible", visible: true });
  assert.equal(fixture.frames.size, 1);
  fixture.nextFrame(1000);
  assert.equal(fixture.draws.length, 6);
  fixture.send({ type: "visible", visible: false });
  assert.equal(fixture.frames.size, 0);
  fixture.send({ type: "resize", width: 960, height: 540, crop: [.1, .2, .5, .6] });
  assert.equal(fixture.canvas.width, 960);
  assert.equal(fixture.canvas.height, 540);
  fixture.send({ type: "dispose" });
  fixture.send({ type: "dispose" });
  assertGpuReleased(fixture);
});

for (const [label, options] of [
  ["vertex compile failure", { compileFailure: 1 }],
  ["fragment compile rejection, including unsupported highp", { compileFailure: 2 }],
  ["program link failure", { linkFailure: true }],
  ["first-frame GL error", { firstFrameError: true }],
]) test(`worker ${label} reports failure and releases decoded images and GPU resources`, async () => {
  const fixture = workerFixture(options);
  assert.equal((await fixture.start()).type, "failed");
  assert.equal(fixture.bitmaps.length, 3);
  assertGpuReleased(fixture);
});

for (const [label, options] of [
  ["asset HTTP failure", { badStatus: 1 }],
  ["unexpected asset MIME", { badMime: 1 }],
  ["oversized asset body", { oversizedBlob: 1 }],
  ["oversized decoded texture after a partial upload", { oversizedBitmap: 1 }],
]) test(`${label} fails closed and releases every successfully allocated resource`, async () => {
  const fixture = workerFixture(options);
  assert.equal((await fixture.start()).type, "failed");
  assert.equal(fixture.fetches.length, 3);
  assertGpuReleased(fixture);
});

test("worker disposed before initialization allocates nothing", () => {
  const fixture = workerFixture();
  fixture.send({ type: "dispose" });
  fixture.send(fixture.init);
  assert.equal(fixture.canvasRequests, 0);
  assert.equal(fixture.fetches.length, 0);
  assert.equal(fixture.messages.length, 0);
});

test("worker disposal during decoding closes late images without reporting late readiness", async () => {
  const fixture = workerFixture({ disposeDuringDecode: 1 });
  fixture.send(fixture.init);
  await new Promise(setImmediate);
  assert.equal(fixture.bitmaps.length, 3);
  assert.equal(fixture.messages.length, 0);
  assertGpuReleased(fixture);
});

test("worker preserves visibility received during initialization", async () => {
  const fixture = workerFixture();
  const pending = fixture.start();
  fixture.send({ type: "visible", visible: true });
  assert.equal((await pending).type, "ready");
  assert.equal(fixture.frames.size, 1);
  fixture.send({ type: "dispose" });
  assertGpuReleased(fixture);
});

test("worker context loss reports failure without deleting resources on the lost context", async () => {
  const fixture = workerFixture();
  assert.equal((await fixture.start()).type, "ready");
  fixture.send({ type: "visible", visible: true });
  fixture.loseContext();
  let prevented = false;
  fixture.canvas.emit("webglcontextlost", { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(fixture.messages.at(-1).type, "failed");
  assertGpuReleased(fixture, { lost: true });
});

test("worker without WebGL reports failure and makes no asset requests", async () => {
  const fixture = workerFixture({ noContext: true });
  assert.equal((await fixture.start()).type, "failed");
  assert.equal(fixture.fetches.length, 0);
  assertGpuReleased(fixture, { noContext: true });
});

function mainFixture(options = {}) {
  const abort = new AbortController(), node = new SceneElement();
  const section = new SceneElement(), main = new SceneElement(), shell = new SceneElement();
  const sword = new SceneElement(), poster = { kind: "existing server-rendered poster" };
  sword.dataset.sceneVisible = "true";
  sword.box = { top: 450, height: 200 };
  node.children.push(poster);
  node.closest = selector => ({ ".home-hero": section, main, ".site-shell": shell })[selector];
  main.querySelector = () => sword;
  const frames = new Map(), workers = [], window = new EventHub();
  let nextFrame = 0, transfers = 0, mainGlCalls = 0;
  const offscreen = { kind: "transferred canvas" };
  class Canvas extends SceneElement {
    transferControlToOffscreen() {
      transfers++;
      if (options.transferFailure) throw new Error("Canvas transfer failed");
      return offscreen;
    }
    getContext() { mainGlCalls++; throw new Error("Main thread must not initialize WebGL"); }
  }
  if (options.noOffscreen || options.noTransfer) delete Canvas.prototype.transferControlToOffscreen;
  const canvas = new Canvas();
  const document = { hidden: false, activeElement: null, createElement: () => canvas };
  class Worker extends EventHub {
    messages = [];
    terminations = 0;
    constructor(url, settings) {
      super();
      if (options.constructFailure) throw new Error("Worker unavailable");
      this.url = url; this.settings = settings;
      workers.push(this);
    }
    postMessage(message, transfer) {
      if (options.postFailure) throw new Error("Worker message failed");
      this.messages.push({ message, transfer });
    }
    terminate() { this.terminations++; }
  }
  const module = { exports: {} };
  runInNewContext(mainSource, {
    module, exports: module.exports, document, window, Element: SceneElement,
    HTMLCanvasElement: Canvas, OffscreenCanvas: options.noOffscreen ? undefined : class {},
    Worker: options.noWorker ? undefined : Worker, URL, setTimeout, clearTimeout,
    CSS: { supports: name => name.includes("animation-timeline") ? options.nativeTimeline !== false : true },
    matchMedia: () => ({ matches: options.small === true }), devicePixelRatio: options.dpr || 1, innerHeight: 900,
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
  }, { filename: "home-scene.ts" });
  return {
    abort, node, canvas, section, main, shell, sword, poster, offscreen, workers, window, document, frames,
    mount: () => module.exports.mountHomeScene(node, abort.signal),
    get worker() { return workers[0]; }, get transfers() { return transfers; }, get mainGlCalls() { return mainGlCalls; },
    flushFrames() {
      for (const [id, callback] of [...frames]) { frames.delete(id); callback(1000); }
    },
  };
}

function assertPosterOnly(fixture) {
  assert.deepEqual(fixture.node.children, [fixture.poster]);
  assert.equal(fixture.node.dataset.sceneReady, undefined);
  assert.equal(fixture.node.dataset.sceneActive, undefined);
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.mainGlCalls, 0);
  for (const target of [fixture.window, fixture.section, fixture.shell]) assert.equal(target.listeners.size, 0);
  assert.equal(getEventListeners(fixture.abort.signal, "abort").length, 0);
  for (const worker of fixture.workers) {
    assert.equal(worker.terminations, 1);
    assert.equal(worker.listeners.size, 0);
  }
}

test("main retains the poster until worker readiness and transfers its canvas once", async () => {
  const fixture = mainFixture();
  const pending = fixture.mount();
  assert.deepEqual(fixture.node.children, [fixture.poster]);
  assert.equal(fixture.transfers, 1);
  assert.equal(fixture.worker.settings.type, "module");
  assert.equal(typeof fixture.worker.url, "string");
  assert.ok(new URL(fixture.worker.url).pathname.endsWith("/home-scene-worker.js"));
  const init = fixture.worker.messages.find(item => item.message.type === "init");
  assert.equal(init.message.canvas, fixture.offscreen);
  assert.equal(init.transfer[0], fixture.offscreen);
  assert.equal(init.message.crop.length, 4);
  assert.ok(Array.from(init.message.crop).every(Number.isFinite));
  fixture.worker.emit("message", { data: { type: "ready" } });
  const controller = await pending;
  assert.ok(controller);
  assert.deepEqual(fixture.node.children, [fixture.poster, fixture.canvas]);
  assert.equal(fixture.canvas["aria-hidden"], "true");
  assert.equal(fixture.canvas.style.pointerEvents, "none");
  controller.dispose();
  controller.dispose();
  assertPosterOnly(fixture);
});

for (const failure of ["failed", "error", "messageerror"]) {
  test(`main ${failure} before readiness resolves to the unchanged poster`, async () => {
    const fixture = mainFixture();
    const pending = fixture.mount();
    fixture.worker.emit(failure === "failed" ? "message" : failure, { data: { type: "failed" }, preventDefault() {} });
    assert.equal(await pending, null);
    fixture.worker.emit("message", { data: { type: "ready" } });
    assertPosterOnly(fixture);
  });
  test(`main ${failure} after readiness removes the enhancement and restores the poster`, async () => {
    const fixture = mainFixture();
    const pending = fixture.mount();
    fixture.worker.emit("message", { data: { type: "ready" } });
    const controller = await pending;
    assert.ok(controller);
    controller.setVisible(true);
    fixture.worker.emit(failure === "failed" ? "message" : failure, { data: { type: "failed" }, preventDefault() {} });
    assertPosterOnly(fixture);
  });
}

test("main abort before mounting allocates no worker or transferred canvas", async () => {
  const fixture = mainFixture();
  fixture.abort.abort();
  assert.equal(await fixture.mount(), null);
  assert.equal(fixture.workers.length, 0);
  assert.equal(fixture.transfers, 0);
  assertPosterOnly(fixture);
});

for (const ready of [false, true]) test(`main abort ${ready ? "after" : "before"} worker readiness cleans up`, async () => {
  const fixture = mainFixture({ nativeTimeline: false });
  const pending = fixture.mount();
  if (ready) fixture.worker.emit("message", { data: { type: "ready" } });
  fixture.abort.abort();
  const controller = await pending;
  assert.equal(Boolean(controller), ready);
  fixture.worker.emit("message", { data: { type: "ready" } });
  assertPosterOnly(fixture);
});

for (const option of ["noWorker", "noOffscreen", "noTransfer", "constructFailure", "transferFailure", "postFailure"]) {
  test(`main ${option} uses the poster without a main-thread GL fallback`, async () => {
    const fixture = mainFixture({ [option]: true });
    assert.equal(await fixture.mount(), null);
    assertPosterOnly(fixture);
  });
}

test("main forwards bounded resize and pauses for focus, hidden state and offscreen visibility", async () => {
  const fixture = mainFixture({ dpr: 3 });
  const pending = fixture.mount();
  fixture.worker.emit("message", { data: { type: "ready" } });
  const controller = await pending;
  assert.ok(controller);
  controller.setVisible(true);
  const lastVisible = () => fixture.worker.messages.filter(item => item.message.type === "visible").at(-1).message.visible;
  assert.equal(lastVisible(), true);
  fixture.section.emit("focusin", { target: new SceneElement() });
  assert.equal(lastVisible(), false);
  fixture.section.emit("focusout", { relatedTarget: null });
  assert.equal(lastVisible(), true);
  const toggle = new SceneElement();
  toggle.closest = selector => selector === ".motion-toggle" ? toggle : null;
  fixture.section.emit("focusin", { target: toggle });
  assert.equal(lastVisible(), true);
  fixture.document.hidden = true;
  controller.setVisible(true);
  assert.equal(lastVisible(), false);
  fixture.document.hidden = false;
  controller.setVisible(false);
  assert.equal(lastVisible(), false);
  fixture.node.box = { width: 640, height: 280 };
  fixture.window.emit("resize");
  fixture.flushFrames();
  const resize = fixture.worker.messages.filter(item => item.message.type === "resize").at(-1).message;
  assert.equal(resize.width, 1280);
  assert.equal(resize.height, 560);
  assert.ok(Array.from(resize.crop).every(Number.isFinite));
  controller.dispose();
  assertPosterOnly(fixture);
});

test("main fallback scroll work is frame-coalesced and removed on disposal", async () => {
  const fixture = mainFixture({ nativeTimeline: false });
  const pending = fixture.mount();
  fixture.worker.emit("message", { data: { type: "ready" } });
  const controller = await pending;
  assert.ok(controller);
  fixture.window.emit("scroll");
  fixture.window.emit("scroll");
  assert.equal(fixture.frames.size, 1);
  fixture.flushFrames();
  assert.ok(fixture.main.properties.has("--home-sword-approach"));
  controller.dispose();
  assert.equal(fixture.main.properties.size, 0);
  assertPosterOnly(fixture);
});
