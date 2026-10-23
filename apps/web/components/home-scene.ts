// Home-only optional enhancement. Content and the matching poster are server-rendered.
export type HomeSceneController = { setVisible: (visible: boolean) => void; dispose: () => void };
const SCENE_VERSION = "HOME_SCENE_RENDERER_V1";
const ASSET_ROOT = "/assets/home/hero/cherry-valley-dawn/";
const vertexSource = `
precision highp float;
attribute vec2 aUV;
uniform float uTime;
uniform float uLayer;
uniform vec4 uCrop;
varying vec2 vUV;
float patch(vec2 uv,vec4 bounds){
 return smoothstep(bounds.x,bounds.x+.012,uv.x)*(1.-smoothstep(bounds.z-.012,bounds.z,uv.x))
 *smoothstep(bounds.y,bounds.y+.016,uv.y)*(1.-smoothstep(bounds.w-.016,bounds.w,uv.y));
}
void main(){
 vec2 p=aUV;
 if(uLayer<.5){
  // Root/waist edges are pinned; face, hands, sword and torso have zero weight.
  float hair=patch(aUV,vec4(.785,.337,.905,.477))*smoothstep(.785,.86,aUV.x);
  float robe=patch(aUV,vec4(.805,.487,.965,.751))*smoothstep(.805,.94,aUV.x);
  p.x+=hair*.0019*sin(uTime*1.13+aUV.y*19.)+robe*.0015*sin(uTime*.79+aUV.y*13.);
  p.y+=hair*.0007*sin(uTime*.87+aUV.x*21.)+robe*.0005*sin(uTime*.61+aUV.x*17.);
 }else{
  vec2 root=vec2(1.,.098);
  float angle=(.0032*sin(uTime*.47)+.0007*sin(uTime*1.17))*smoothstep(.01,.36,distance(aUV,root));
  vec2 q=aUV-root;
  p=root+mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*q;
 }
 vUV=aUV;
 vec2 clip=(p-uCrop.xy)/uCrop.zw;
 gl_Position=vec4(clip.x*2.-1.,1.-clip.y*2.,0.,1.);
}`;
const fragmentSource = `
precision highp float;
uniform sampler2D uTexture;
uniform float uTime;
uniform float uLayer;
varying vec2 vUV;
float waterPatch(vec2 uv,vec4 bounds){
 return smoothstep(bounds.x,bounds.x+.004,uv.x)*(1.-smoothstep(bounds.z-.004,bounds.z,uv.x))
 *smoothstep(bounds.y,bounds.y+.006,uv.y)*(1.-smoothstep(bounds.w-.006,bounds.w,uv.y));
}
void main(){
 vec2 uv=vUV;
 if(uLayer<.5){
  // Reviewed open-water patches avoid banks, boats and architecture entirely.
  float water=waterPatch(uv,vec4(.44,.60,.47,.625))
   +waterPatch(uv,vec4(.37,.64,.40,.665))+waterPatch(uv,vec4(.32,.70,.37,.735));
  uv.x+=water*.00048*sin(uv.y*160.+uTime*1.4);
  uv.y+=water*.00015*cos(uv.x*115.-uTime*.77);
 }
 gl_FragColor=texture2D(uTexture,uv);
}`;

export async function mountHomeScene(node: HTMLElement, signal: AbortSignal): Promise<HomeSceneController | null> {
  if (signal.aborted || typeof createImageBitmap !== "function") return null;
  if (typeof CSS === "undefined" || !CSS.supports("mask-image", "linear-gradient(#000,#000)")) return null;
  const small = matchMedia("(max-width: 680px)").matches;
  // The mobile crop uses only 58% of the artboard width. Keep enough texels
  // for its high-DPR poster; simplify the mesh rather than blurring the scene.
  const width = 1280;
  const canvas = document.createElement("canvas");
  canvas.className = "home-scene-canvas";
  canvas.dataset.sceneVersion = SCENE_VERSION;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.pointerEvents = "none";
  const context = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!context) return null;
  const gl = context;
  if (!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  const textures: WebGLTexture[] = [];
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let disposed = false;
  let frame = 0;
  let scrollFrame = 0;
  let visible = false;
  let focused = false;
  let time = 0;
  let last = 0;
  const section = node.closest<HTMLElement>(".home-hero");
  focused = !!section?.contains(document.activeElement) && !document.activeElement?.closest(".motion-toggle");
  const main = node.closest<HTMLElement>("main");
  const shell = node.closest<HTMLElement>(".site-shell");
  const event = main?.querySelector<HTMLElement>(".home-event-section");
  const nativeTimeline = CSS.supports("animation-timeline: view()");
  const crop = new Float32Array(4);
  let locations: { time: WebGLUniformLocation | null; layer: WebGLUniformLocation | null; crop: WebGLUniformLocation | null } | null = null;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(scrollFrame);
    window.removeEventListener("resize", resize);
    window.removeEventListener("scroll", requestScroll);
    shell?.removeEventListener("motionvisibility", requestScroll);
    section?.removeEventListener("focusin", focusIn);
    section?.removeEventListener("focusout", focusOut);
    canvas.removeEventListener("webglcontextlost", lost);
    signal.removeEventListener("abort", dispose);
    node.removeAttribute("data-scene-ready");
    node.removeAttribute("data-scene-active");
    main?.style.removeProperty("--home-scene-progress");
    main?.style.removeProperty("--home-scene-emphasis");
    canvas.remove();
    if (!gl.isContextLost()) {
      for (const texture of textures) gl.deleteTexture(texture);
      for (const shader of shaders) gl.deleteShader(shader);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  };
  function lost(e: Event) { e.preventDefault(); dispose(); }
  function scroll() {
    scrollFrame = 0;
    if (disposed || nativeTimeline || !main || !event || event.dataset.sceneVisible !== "true") return;
    const box = event.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (innerHeight - box.top) / (innerHeight + box.height)));
    main.style.setProperty("--home-scene-progress", progress.toFixed(4));
    main.style.setProperty("--home-scene-emphasis", Math.sin(progress * Math.PI).toFixed(4));
  }
  function requestScroll() { if (!disposed && !nativeTimeline && !scrollFrame) scrollFrame = requestAnimationFrame(scroll); }
  function resize() {
    if (disposed) return;
    const box = node.getBoundingClientRect();
    const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(box.width * scale));
    canvas.height = Math.max(1, Math.round(box.height * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (matchMedia("(max-width: 680px)").matches) {
      crop.set([640 / 1536, 215 / 1024, 896 / 1536, 560 / 1024]);
    } else {
      const fit = Math.max(box.width / 1536, box.height / 560);
      const w = box.width / fit, h = box.height / fit;
      crop.set([(1536 - w) * .5 / 1536, (215 + (560 - h) * .45) / 1024, w / 1536, h / 1024]);
    }
    requestScroll();
  }
  function draw(now: number) {
    frame = 0;
    if (disposed || !visible || focused || document.hidden || !locations) return;
    if (!last || now - last >= 1000 / 30) {
      time += last ? Math.min((now - last) / 1000, .1) : 0;
      last = now;
      paint();
    }
    frame = requestAnimationFrame(draw);
  }
  function paint() {
    if (!locations) return;
    gl.uniform1f(locations.time, time);
    gl.uniform4fv(locations.crop, crop);
    for (let layer = 0; layer < 2; layer++) {
      gl.uniform1f(locations.layer, layer);
      gl.bindTexture(gl.TEXTURE_2D, textures[layer]);
      gl.drawArrays(gl.TRIANGLES, 0, (small ? 32 * 20 : 48 * 32) * 6);
    }
  }
  function run() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    const active = visible && !focused && !document.hidden && !disposed;
    node.dataset.sceneActive = String(active);
    if (active) frame = requestAnimationFrame(draw);
  }
  function focusIn(e: FocusEvent) {
    // The explicit On control should demonstrate the enabled scene. Other
    // focused hero actions pause ambient decoration while they are used.
    focused = !(e.target instanceof Element && e.target.closest(".motion-toggle"));
    run();
  }
  function focusOut(e: FocusEvent) { if (!section?.contains(e.relatedTarget as Node | null)) { focused = false; run(); } }
  try {
    const loaded = await Promise.allSettled(["clean-plate-", "branch-alpha-"].map(async prefix => {
      const response = await fetch(ASSET_ROOT + prefix + width + ".webp", { signal, cache: "force-cache" });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/webp")) throw new Error("Scene asset unavailable");
      const blob = await response.blob();
      if (blob.size > 220 * 1024) throw new Error("Scene asset budget exceeded");
      return createImageBitmap(blob, { premultiplyAlpha: "none" });
    }));
    const bitmaps = loaded.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    if (loaded.some(result => result.status === "rejected")) {
      bitmaps.forEach(bitmap => bitmap.close());
      throw new Error("Scene asset unavailable");
    }
    try {
      if (signal.aborted) { dispose(); return null; }
      const shader = (type: number, source: string) => {
        const value = gl.createShader(type);
        if (!value) throw new Error("Shader unavailable");
        shaders.push(value); gl.shaderSource(value, source); gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error("Scene shader unavailable");
        return value;
      };
      program = gl.createProgram();
      if (!program) throw new Error("Program unavailable");
      gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Scene program unavailable");
      gl.useProgram(program);
      const vertices: number[] = [];
      const cols = small ? 32 : 48, rows = small ? 20 : 32;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 0], [1, 1], [0, 1]]) vertices.push((x + dx) / cols, (y + dy) / rows);
      }
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      const uv = gl.getAttribLocation(program, "aUV");
      gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
      for (const bitmap of bitmaps) {
        // Upload each decoded layer in a separate task. Two uploads plus shader
        // setup otherwise form one blocking task on the mobile CPU profile.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (signal.aborted || disposed) { dispose(); return null; }
        if (bitmap.width > 1280 || bitmap.height > 853) throw new Error("Scene texture dimensions rejected");
        const texture = gl.createTexture();
        if (!texture) throw new Error("Texture unavailable");
        textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      }
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      locations = { time: gl.getUniformLocation(program, "uTime"), layer: gl.getUniformLocation(program, "uLayer"), crop: gl.getUniformLocation(program, "uCrop") };
    } finally { bitmaps.forEach(bitmap => bitmap.close()); }
    canvas.addEventListener("webglcontextlost", lost);
    signal.addEventListener("abort", dispose, { once: true });
    window.addEventListener("resize", resize, { passive: true });
    if (!nativeTimeline) {
      window.addEventListener("scroll", requestScroll, { passive: true });
      shell?.addEventListener("motionvisibility", requestScroll);
    }
    section?.addEventListener("focusin", focusIn);
    section?.addEventListener("focusout", focusOut);
    resize();
    paint();
    if (gl.getError() !== gl.NO_ERROR) throw new Error("Scene first frame unavailable");
    node.append(canvas);
    node.dataset.sceneReady = "true";
    return { setVisible(value) { visible = value; run(); requestScroll(); }, dispose };
  } catch { dispose(); return null; }
}
