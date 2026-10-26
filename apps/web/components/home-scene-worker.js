// Home's existing renderer runs here so driver setup cannot block member controls.
// The app uses DOM types; avoid importing a second, conflicting global library.
const scope = globalThis;
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
 if(uLayer>.5&&uLayer<1.5){
  // Genuine-alpha source cutouts move independently above reconstructed art.
  // Fixed head, hands, weapon and torso are never part of this texture.
  float hair=patch(aUV,vec4(.785,.337,.905,.477))*smoothstep(.785,.86,aUV.x);
  float robe=patch(aUV,vec4(.805,.487,.965,.751))*smoothstep(.805,.94,aUV.x);
  p.x+=hair*.0024*(.65+.35*sin(uTime*1.13+aUV.y*19.))+robe*.0021*(.65+.35*sin(uTime*.79+aUV.y*13.));
  p.y+=hair*.0007*sin(uTime*.87+aUV.x*21.)+robe*.0005*sin(uTime*.61+aUV.x*17.);
 }else if(uLayer>1.5){
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
#ifndef GL_FRAGMENT_PRECISION_HIGH
#error Fragment highp precision is required
#endif
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
 if(uLayer>.5&&uLayer<1.5){
  uv=(uv-vec2(1196./1536.,372./1024.))/vec2(244./1536.,184./1024.);
  if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)discard;
 }
 gl_FragColor=texture2D(uTexture,uv);
}`;
const abort = new AbortController();
const textures = [];
const shaders = [];
const bitmaps = new Set();
const crop = new Float32Array(4);
let canvas = null;
let gl = null;
let program = null;
let buffer = null;
let locations = null;
let started = false;
let disposed = false;
let visible = false;
let ready = false;
let small = false;
let frame = 0;
let time = 0;
let last = 0;
function closeBitmaps() {
    for (const bitmap of bitmaps)
        bitmap.close();
    bitmaps.clear();
}
function dispose() {
    var _a;
    if (disposed)
        return;
    disposed = true;
    abort.abort();
    if (frame)
        scope.cancelAnimationFrame(frame);
    frame = 0;
    canvas === null || canvas === void 0 ? void 0 : canvas.removeEventListener("webglcontextlost", lost);
    closeBitmaps();
    if (gl && !gl.isContextLost()) {
        for (const texture of textures)
            gl.deleteTexture(texture);
        for (const shader of shaders)
            gl.deleteShader(shader);
        if (buffer)
            gl.deleteBuffer(buffer);
        if (program)
            gl.deleteProgram(program);
        (_a = gl.getExtension("WEBGL_lose_context")) === null || _a === void 0 ? void 0 : _a.loseContext();
    }
}
function fail() {
    if (disposed)
        return;
    scope.postMessage({ type: "failed" });
    dispose();
}
function lost(event) { event.preventDefault(); fail(); }
function resize(data) {
    if (!canvas || disposed)
        return;
    canvas.width = data.width;
    canvas.height = data.height;
    crop.set(data.crop);
    gl === null || gl === void 0 ? void 0 : gl.viewport(0, 0, canvas.width, canvas.height);
}
function paint() {
    if (!gl || !locations)
        return;
    gl.uniform1f(locations.time, time);
    gl.uniform4fv(locations.crop, crop);
    for (let layer = 0; layer < 3; layer++) {
        gl.uniform1f(locations.layer, layer);
        gl.bindTexture(gl.TEXTURE_2D, textures[layer]);
        gl.drawArrays(gl.TRIANGLES, 0, (small ? 32 * 20 : 48 * 32) * 6);
    }
}
function draw(now) {
    frame = 0;
    if (disposed || !visible || !ready)
        return;
    try {
        if (!last || now - last >= 1000 / 30) {
            time += last ? Math.min((now - last) / 1000, .1) : 0;
            last = now;
            paint();
        }
        frame = scope.requestAnimationFrame(draw);
    }
    catch (_a) {
        fail();
    }
}
function run() {
    if (frame)
        scope.cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    if (visible && ready && !disposed)
        frame = scope.requestAnimationFrame(draw);
}
async function init(data) {
    if (started || disposed) {
        fail();
        return;
    }
    started = true;
    canvas = data.canvas;
    small = data.small;
    try {
        if (typeof createImageBitmap !== "function" || typeof scope.requestAnimationFrame !== "function")
            throw new Error("Scene worker unavailable");
        const context = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
        if (!context)
            throw new Error("Scene context unavailable");
        gl = context;
        canvas.addEventListener("webglcontextlost", lost);
        resize(data);
        const sources = [ASSET_ROOT.replace("cherry-valley-dawn/", "cherry-valley-dawn-v2/") + "backdrop-1280.webp",
            ASSET_ROOT.replace("cherry-valley-dawn/", "cherry-valley-dawn-v2/") + "hair-fabric-alpha.webp",
            ASSET_ROOT + "branch-alpha-1280.webp"];
        const loaded = await Promise.allSettled(sources.map(async (source) => {
            var _a;
            const response = await fetch(source, { signal: abort.signal, cache: "force-cache" });
            if (!response.ok || !((_a = response.headers.get("content-type")) === null || _a === void 0 ? void 0 : _a.startsWith("image/webp")))
                throw new Error("Scene asset unavailable");
            const blob = await response.blob();
            if (blob.size > 220 * 1024)
                throw new Error("Scene asset budget exceeded");
            const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none" });
            if (disposed) {
                bitmap.close();
                throw new Error("Scene disposed");
            }
            bitmaps.add(bitmap);
            return bitmap;
        }));
        if (disposed)
            return;
        if (loaded.some(result => result.status === "rejected"))
            throw new Error("Scene asset unavailable");
        const shader = (type, source) => {
            const value = context.createShader(type);
            if (!value)
                throw new Error("Shader unavailable");
            shaders.push(value);
            context.shaderSource(value, source);
            context.compileShader(value);
            if (!context.getShaderParameter(value, context.COMPILE_STATUS))
                throw new Error("Scene shader unavailable");
            return value;
        };
        program = context.createProgram();
        if (!program)
            throw new Error("Program unavailable");
        context.attachShader(program, shader(context.VERTEX_SHADER, vertexSource));
        context.attachShader(program, shader(context.FRAGMENT_SHADER, fragmentSource));
        context.linkProgram(program);
        if (!context.getProgramParameter(program, context.LINK_STATUS))
            throw new Error("Scene program unavailable");
        context.useProgram(program);
        const vertices = [];
        const cols = small ? 32 : 48, rows = small ? 20 : 32;
        for (let y = 0; y < rows; y++)
            for (let x = 0; x < cols; x++) {
                for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 0], [1, 1], [0, 1]])
                    vertices.push((x + dx) / cols, (y + dy) / rows);
            }
        buffer = context.createBuffer();
        context.bindBuffer(context.ARRAY_BUFFER, buffer);
        context.bufferData(context.ARRAY_BUFFER, new Float32Array(vertices), context.STATIC_DRAW);
        const uv = context.getAttribLocation(program, "aUV");
        context.enableVertexAttribArray(uv);
        context.vertexAttribPointer(uv, 2, context.FLOAT, false, 0, 0);
        for (const result of loaded) {
            if (result.status !== "fulfilled")
                continue;
            const bitmap = result.value;
            await new Promise(resolve => setTimeout(resolve, 0));
            if (disposed)
                return;
            if (bitmap.width > 1280 || bitmap.height > 853)
                throw new Error("Scene texture dimensions rejected");
            const texture = context.createTexture();
            if (!texture)
                throw new Error("Texture unavailable");
            textures.push(texture);
            context.bindTexture(context.TEXTURE_2D, texture);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
            context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, bitmap);
        }
        context.enable(context.BLEND);
        context.blendFunc(context.SRC_ALPHA, context.ONE_MINUS_SRC_ALPHA);
        locations = { time: context.getUniformLocation(program, "uTime"), layer: context.getUniformLocation(program, "uLayer"), crop: context.getUniformLocation(program, "uCrop") };
        paint();
        if (context.getError() !== context.NO_ERROR)
            throw new Error("Scene first frame unavailable");
        ready = true;
        scope.postMessage({ type: "ready" });
        run();
    }
    catch (_a) {
        fail();
    }
    finally {
        closeBitmaps();
    }
}
scope.onmessage = ({ data }) => {
    if (disposed)
        return;
    try {
        switch (data.type) {
            case "init":
                void init(data);
                break;
            case "resize":
                resize(data);
                break;
            case "visible":
                visible = data.visible;
                run();
                break;
            case "dispose":
                dispose();
                break;
        }
    }
    catch (_a) {
        fail();
    }
};
export {};
