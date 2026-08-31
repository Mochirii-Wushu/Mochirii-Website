import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_PUBLIC_URLS_CONFIG = new URL("../apps/web/config/public-urls.json", import.meta.url);
const DEFAULT_PUBLIC_URLS_BYTE_LIMIT = 16 * 1024;
const TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;
const DEFAULT_DIAGNOSE = process.argv.includes("--diagnose");

export const PRODUCTION_CHECK_LIMITS = Object.freeze({
  baseUrlCharacters: 2048,
  responseHeaderCharacters: 256,
  linkHeaderCharacters: 1024,
  contentDispositionCharacters: 160,
  contentLengthCharacters: 16,
  htmlBytes: 1024 * 1024,
  textBytes: 256 * 1024,
  xmlBytes: 256 * 1024,
  assetBytes: 4 * 1024 * 1024,
  assetUrlCharacters: 2048,
  publicUrlsConfigBytes: DEFAULT_PUBLIC_URLS_BYTE_LIMIT,
});

const REQUEST_HEADERS = Object.freeze({
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 MochiriiProductionSmoke/1.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
});

const MEDIA_CONTRACTS = Object.freeze({
  html: Object.freeze({
    mediaTypes: Object.freeze(["text/html"]),
    byteLimit: PRODUCTION_CHECK_LIMITS.htmlBytes,
    requireUtf8: true,
  }),
  text: Object.freeze({
    mediaTypes: Object.freeze(["text/plain"]),
    byteLimit: PRODUCTION_CHECK_LIMITS.textBytes,
    requireUtf8: true,
  }),
  xml: Object.freeze({
    mediaTypes: Object.freeze(["application/xml", "text/xml"]),
    byteLimit: PRODUCTION_CHECK_LIMITS.xmlBytes,
    requireUtf8: false,
  }),
});

const PAGE_CONTRACTS = Object.freeze([
  Object.freeze({ path: "/", media: "html" }),
  Object.freeze({ path: "/gallery", media: "html" }),
  Object.freeze({ path: "/recruitment", media: "html" }),
  Object.freeze({ path: "/join", media: "html" }),
  Object.freeze({ path: "/events", media: "html" }),
  Object.freeze({ path: "/privacy", media: "html" }),
  Object.freeze({ path: "/meta-data-deletion", media: "html" }),
  Object.freeze({ path: "/robots.txt", media: "text" }),
  Object.freeze({ path: "/sitemap.xml", media: "xml" }),
]);

class ProductionSmokeError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "ProductionSmokeError";
    this.code = code;
    this.status = Number.isSafeInteger(status) ? status : null;
  }
}

function failure(code, status) {
  return new ProductionSmokeError(code, status);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function loadDefaultProductionBaseUrl({
  configUrl = DEFAULT_PUBLIC_URLS_CONFIG,
  openImpl = openSync,
  fstatImpl = fstatSync,
  readImpl = readSync,
  closeImpl = closeSync,
} = {}) {
  let descriptor;
  try {
    descriptor = openImpl(configUrl, "r");
    const before = fstatImpl(descriptor);
    if (!before?.isFile?.()
      || !Number.isSafeInteger(before.size)
      || before.size < 1
      || before.size > DEFAULT_PUBLIC_URLS_BYTE_LIMIT) {
      throw failure("BASE_URL_REJECTED");
    }

    const bytes = new Uint8Array(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readImpl(descriptor, bytes, offset, bytes.byteLength - offset, null);
      if (!Number.isSafeInteger(count) || count < 1) throw failure("BASE_URL_REJECTED");
      offset += count;
    }
    const overflowProbe = new Uint8Array(1);
    if (readImpl(descriptor, overflowProbe, 0, 1, null) !== 0) throw failure("BASE_URL_REJECTED");

    const after = fstatImpl(descriptor);
    if (!after?.isFile?.() || after.size !== before.size) throw failure("BASE_URL_REJECTED");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) throw failure("BASE_URL_REJECTED");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || typeof parsed.siteOrigin !== "string") {
      throw failure("BASE_URL_REJECTED");
    }
    return normalizeProductionBaseUrl(parsed.siteOrigin);
  } catch {
    throw failure("BASE_URL_REJECTED");
  } finally {
    if (descriptor !== undefined) {
      try {
        closeImpl(descriptor);
      } catch {
        // Closing failure is contained by the same fixed input category.
      }
    }
  }
}

function isSafeRoutePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= PRODUCTION_CHECK_LIMITS.assetUrlCharacters
    && value.startsWith("/")
    && !value.startsWith("//")
    && !/[\\?#\s\u0000-\u001f\u007f]/.test(value);
}

export function normalizeProductionBaseUrl(value) {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > PRODUCTION_CHECK_LIMITS.baseUrlCharacters) {
    throw failure("BASE_URL_REJECTED");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw failure("BASE_URL_REJECTED");
  }

  if (!["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || (value !== parsed.origin && value !== parsed.origin + "/")
    || /[?#]/.test(parsed.href)) {
    throw failure("BASE_URL_REJECTED");
  }

  return parsed.origin;
}

function requestUrl(baseUrl, value, { asset = false } = {}) {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters) {
    throw failure(asset ? "ASSET_URL_REJECTED" : "REQUEST_URL_REJECTED");
  }
  let candidate;
  try {
    candidate = isSafeRoutePath(value) ? new URL(value, baseUrl) : new URL(value);
  } catch {
    throw failure(asset ? "ASSET_URL_REJECTED" : "REQUEST_URL_REJECTED");
  }

  if (!["http:", "https:"].includes(candidate.protocol)
    || candidate.origin !== baseUrl
    || candidate.username
    || candidate.password
    || candidate.search
    || candidate.hash
    || /[?#]/.test(candidate.href)
    || candidate.href.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters) {
    throw failure(asset ? "ASSET_URL_REJECTED" : "REQUEST_URL_REJECTED");
  }

  if (asset) {
    if (!candidate.pathname.startsWith("/assets/")
      || !candidate.pathname.toLowerCase().endsWith(".webp")
      || /[%\\]/.test(candidate.pathname)) {
      throw failure("ASSET_URL_REJECTED");
    }
  } else if (!isSafeRoutePath(candidate.pathname)) {
    throw failure("REQUEST_URL_REJECTED");
  }

  return candidate;
}

function responseMatchesRequest(response, target) {
  if (response?.redirected !== false
    || typeof response?.url !== "string"
    || response.url.length === 0
    || response.url.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters) {
    return false;
  }
  try {
    const observed = new URL(response.url);
    return !observed.username
      && !observed.password
      && !observed.search
      && !observed.hash
      && observed.href === target.href;
  } catch {
    return false;
  }
}

function productionLinkResponseHeaderRecord(value) {
  if (typeof value !== "string" || value.length === 0
    || value.length > PRODUCTION_CHECK_LIMITS.linkHeaderCharacters
    || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const fontPreload = /^<\/_next\/static\/(?:([A-Za-z0-9_-]{1,64})\/)?media\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.woff2>; rel=preload; as="font"; crossorigin=""; type="font\/woff2"$/;
  const stylePreload = /^<\/_next\/static\/(?:([A-Za-z0-9_-]{1,64})\/)?chunks\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.css>; rel=preload; as="style"$/;
  const entries = value.split(", ");
  if (entries.length < 2 || entries.length > 6
    || new Set(entries).size !== entries.length) return null;
  let nextStaticBuildId = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const match = (index < 2 ? fontPreload : stylePreload).exec(entry);
    if (!match || match[0] !== entry) return null;
    const entryBuildId = match[1] || "";
    if (nextStaticBuildId !== null && nextStaticBuildId !== entryBuildId) return null;
    nextStaticBuildId = entryBuildId;
  }
  return Object.freeze({ nextStaticBuildId });
}

function productionNextStaticBuildIdMatchesRun(client, observed) {
  if (typeof observed !== "string") return false;
  if (client.nextStaticBuildId === null) {
    client.nextStaticBuildId = observed;
    return true;
  }
  return client.nextStaticBuildId === observed;
}

function productionNextStaticNamespaceMatchesPath(client, path, observed) {
  if (typeof path !== "string" || (observed !== null && typeof observed !== "string")) return false;
  if (!client.htmlNextStaticNamespaces.has(path)) {
    client.htmlNextStaticNamespaces.set(path, observed);
  } else if (client.htmlNextStaticNamespaces.get(path) !== observed) {
    return false;
  }
  return observed === null || productionNextStaticBuildIdMatchesRun(client, observed);
}

function productionContentDispositionHeaderIsSafe(value, target, { asset = false } = {}) {
  if (value === null) return true;
  if (typeof value !== "string" || value.length === 0
    || value.length > PRODUCTION_CHECK_LIMITS.contentDispositionCharacters) return false;
  if (!asset && target.pathname !== "/robots.txt" && target.pathname !== "/sitemap.xml") {
    return value === "inline";
  }
  const filename = target.pathname.split("/").at(-1) || "";
  return /^[A-Za-z0-9._-]{1,128}$/.test(filename)
    && value === `inline; filename="${filename}"`;
}

function productionContentLengthHeaderRecord(value) {
  if (value === null) return Object.freeze({ declaredLength: null });
  if (typeof value !== "string"
    || value.length < 1
    || value.length > PRODUCTION_CHECK_LIMITS.contentLengthCharacters
    || !/^\d+$/.test(value)) return null;
  const declaredLength = Number(value);
  return Number.isSafeInteger(declaredLength)
    ? Object.freeze({ declaredLength }) : null;
}

async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // Cancellation failure must not replace the fixed fail-closed category.
  }
}

function parseMediaType(response) {
  const value = response?.headers?.get?.("content-type");
  if (typeof value !== "string"
    || value.length === 0
    || value.length > PRODUCTION_CHECK_LIMITS.responseHeaderCharacters) {
    throw failure("MEDIA_TYPE_REJECTED");
  }

  const match = /^[ \t]*([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+)(?:[ \t]*;[ \t]*charset=(utf-8|"utf-8"))?[ \t]*$/i.exec(value);
  if (!match) throw failure("MEDIA_TYPE_REJECTED");
  return { mediaType: match[1].toLowerCase(), utf8: Boolean(match[2]) };
}

async function assertMediaType(response, allowedMediaTypes, {
  requireUtf8 = false,
  allowUtf8 = true,
} = {}) {
  let parsed;
  try {
    parsed = parseMediaType(response);
  } catch (error) {
    await cancelResponseBody(response);
    throw error;
  }
  if (!allowedMediaTypes.includes(parsed.mediaType)
    || (requireUtf8 && !parsed.utf8)
    || (!allowUtf8 && parsed.utf8)) {
    await cancelResponseBody(response);
    throw failure("MEDIA_TYPE_REJECTED");
  }
  return parsed.mediaType;
}

async function readBoundedUtf8Response(response, contract) {
  await assertMediaType(response, contract.mediaTypes, { requireUtf8: contract.requireUtf8 });

  const declaredLengthText = response.headers.get("content-length");
  if (declaredLengthText !== null) {
    const contentLengthRecord = productionContentLengthHeaderRecord(declaredLengthText);
    if (!contentLengthRecord) {
      await cancelResponseBody(response);
      throw failure("BODY_LIMIT_REJECTED");
    }
    if (contentLengthRecord.declaredLength > contract.byteLimit) {
      await cancelResponseBody(response);
      throw failure("BODY_LIMIT_REJECTED");
    }
  }

  if (!response.body) return "";
  let reader;
  try {
    reader = response.body.getReader();
  } catch {
    await cancelResponseBody(response);
    throw failure("BODY_READ_REJECTED");
  }
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw failure("BODY_READ_REJECTED");
      byteLength += value.byteLength;
      if (!Number.isSafeInteger(byteLength) || byteLength > contract.byteLimit) {
        throw failure("BODY_LIMIT_REJECTED");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ProductionSmokeError) throw error;
    throw failure("BODY_READ_REJECTED");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock-release failure must not replace a fixed read category.
    }
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw failure("BODY_UTF8_REJECTED");
  }
}

async function fetchProductionResponse(client, value, { asset = false, label = "route" } = {}) {
  const target = requestUrl(client.baseUrl, value, { asset });
  let lastNetworkFailure = failure("NETWORK_REJECTED");

  for (let attempt = 1; attempt <= client.maxAttempts; attempt += 1) {
    let response;
    try {
      response = await client.fetchImpl(target.href, {
        headers: REQUEST_HEADERS,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      lastNetworkFailure = failure("NETWORK_REJECTED");
      if (attempt < client.maxAttempts) await client.waitImpl(500 * attempt);
      continue;
    }

    if (!responseMatchesRequest(response, target)) {
      await cancelResponseBody(response);
      throw failure("RESPONSE_URL_REJECTED");
    }
    let rejectedResponseHeader = false;
    try {
      const linkHeader = response?.headers?.get?.("link");
      const linkHeaderRecord = linkHeader === null
        ? null : productionLinkResponseHeaderRecord(linkHeader);
      const contentDisposition = response?.headers?.get?.("content-disposition");
      const contentLength = response?.headers?.get?.("content-length");
      const contentLengthRecord = productionContentLengthHeaderRecord(contentLength);
      rejectedResponseHeader = !productionContentDispositionHeaderIsSafe(
        contentDisposition, target, { asset },
      )
        || contentLengthRecord === null
        || (asset && contentLengthRecord.declaredLength !== null
          && contentLengthRecord.declaredLength > PRODUCTION_CHECK_LIMITS.assetBytes)
        || response?.headers?.has?.("refresh") === true
        || (linkHeader !== null && linkHeaderRecord === null)
        || (linkHeaderRecord !== null
          && !productionNextStaticBuildIdMatchesRun(client, linkHeaderRecord.nextStaticBuildId));
    } catch {
      rejectedResponseHeader = true;
    }
    if (rejectedResponseHeader) {
      await cancelResponseBody(response);
      throw failure("RESPONSE_HEADER_REJECTED");
    }
    if (response.status >= 300 && response.status < 400) {
      await cancelResponseBody(response);
      throw failure("REDIRECT_REJECTED", response.status);
    }
    if (response.status !== 200) {
      await cancelResponseBody(response);
      throw failure("HTTP_STATUS_REJECTED", response.status);
    }

    if (client.diagnose) client.reportDiagnostic("OK " + label + " 200");
    return response;
  }

  throw lastNetworkFailure;
}

async function fetchText(client, path, media) {
  const response = await fetchProductionResponse(client, path, { label: path });
  return readBoundedUtf8Response(response, MEDIA_CONTRACTS[media]);
}

function assertIncludes(text, pattern, label) {
  if (!pattern.test(text)) throw failure("CONTENT_" + label + "_REJECTED");
}

const PRODUCTION_RAW_TEXT_ELEMENTS = new Set([
  "script",
  "title",
]);
const PRODUCTION_NAMESPACE_RAW_TEXT_ELEMENTS = new Set([
  "iframe", "noembed", "noframes", "noscript", "script", "style", "textarea", "title", "xmp",
]);
const PRODUCTION_NAMESPACE_INERT_CONTAINERS = new Set(["select", "template"]);
const PRODUCTION_NAMESPACE_SELECT_CHILD_ELEMENTS = new Set(["hr", "optgroup", "option"]);
const PRODUCTION_NAMESPACE_RESOURCE_ATTRIBUTE_NAMES = new Set([
  "data-full", "href", "imagesrcset", "src", "srcset", "style",
]);
const PRODUCTION_NAMESPACE_SINGLE_URL_ATTRIBUTE_NAMES = new Set(["data-full", "href", "src"]);
const PRODUCTION_NAMESPACE_SRCSET_ATTRIBUTE_NAMES = new Set(["imagesrcset", "srcset"]);
const PRODUCTION_NAMESPACE_REJECTED_CONTEXT_ELEMENTS = new Set([
  "frameset", "math", "plaintext", "svg",
]);
const PRODUCTION_INERT_CONTAINERS = new Set(["template"]);
const PRODUCTION_HEAD_ELEMENTS = new Set(["link", "meta", "script", "title"]);
const PRODUCTION_DOCTYPE = "<!doctype html>";
const PRODUCTION_SAFE_COMMENT_BODIES = new Set(["", " ", "$", "/$", "$!", "$?"]);
const PRODUCTION_REJECTED_ELEMENTS = new Set([
  "area", "audio", "canvas", "datalist", "dialog", "embed", "iframe", "image", "math", "meter", "noembed",
  "marquee", "noframes", "noscript", "object", "picture", "plaintext", "progress", "select", "source", "style",
  "svg", "textarea", "track", "video", "xmp",
]);
const PRODUCTION_SAFE_AUDIO_ATTRIBUTE_NAMES = new Set([
  "aria-describedby", "aria-labelledby", "class", "controlslist", "id", "preload", "src",
]);
const PRODUCTION_HIDDEN_CLASS_NAMES = new Set([
  "bg-grain", "bg-ink", "bg-ink-2", "burger", "col-divider", "hidden", "nav",
  "official-profiles--header", "page-hero__atmos", "page-hero__fade",
  "page-hero__scrim", "responsive-gallery-media__fallback", "sr-only",
]);
const PRODUCTION_HTML_ATTRIBUTES = new Set([
  "alt", "aria-describedby", "aria-disabled", "aria-hidden", "aria-label", "aria-labelledby", "aria-modal",
  "as", "async", "class", "content", "controlslist", "crossorigin", "data-auth-signed-out", "data-caption",
  "data-close", "data-custom-recruitment-audio-player", "data-dropdown", "data-dropdown-menu", "data-full",
  "data-has-mark", "data-image-state", "data-nav", "data-nimg", "data-official-profile", "data-open",
  "data-precedence", "data-state",
  "decoding", "fetchpriority", "height", "hidden", "href", "id", "inert", "loading", "name", "nomodule",
  "imagesizes", "imagesrcset", "open", "popover", "preload", "property", "referrerpolicy", "rel", "role",
  "sizes", "src", "srcset", "style", "tabindex", "target", "type", "width",
]);
const PRODUCTION_VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);
const PRODUCTION_AMBIGUOUS_TREE_ELEMENTS = new Set([
  "caption", "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
]);
const PRODUCTION_HTML_DEPTH_LIMIT = 64;
const PRODUCTION_HTML_TAG_LIMIT = 512;
const PRODUCTION_FOOTER_ATTRIBUTE_NAMES = new Set(["class", "role"]);
const PRODUCTION_FOOTER_WRAPPER_ATTRIBUTE_NAMES = new Set(["class"]);
const PRODUCTION_FOOTER_LEGAL_ATTRIBUTE_NAMES = new Set(["aria-label", "class"]);
const PRODUCTION_FOOTER_DESCENDANT_CLASS_NAMES = new Set([
  "", "brand-name", "brand-sub", "brand-text", "dot", "footer-actions", "footer-bottom", "footer-brand",
  "footer-brand-link", "footer-brand-text", "footer-col", "footer-col-title",
  "footer-col-title official-profiles-title", "footer-cols", "footer-cta", "footer-cta-glint", "footer-desc",
  "footer-dim", "footer-emblem", "footer-legal", "footer-link", "footer-meta", "footer-nav", "footer-top",
  "footer-wrap", "official-profile-account", "official-profile-copy", "official-profile-external",
  "official-profile-link", "official-profile-list", "official-profile-platform",
  "official-profiles official-profiles--footer", "sr-only",
]);
const PRODUCTION_FOOTER_DESCENDANT_ID_NAMES = new Set(["", "copyright-text"]);
const PRODUCTION_SAFE_COMPOUND_CLASS_NAMES = new Set([
  "brand brand--mobile", "col-12 glass-card glass-card--primary glass-pad",
  "col-12 glass-card glass-card--soft glass-pad", "col-4 glass-card glass-card--soft glass-pad",
  "col-8 glass-card glass-card--primary glass-pad", "container hero-overlap",
  "displayfont_12184ccb-module__YUH9_a__variable bodyfont_24fec695-module__4PpgrG__variable",
  "footer-col-title official-profiles-title", "glass-card glass-card--primary glass-pad",
  "glass-card glass-card--primary glass-pad u-mt-24", "glass-card glass-card--soft glass-pad center-stack",
  "glass-card glass-card--strong glass-pad hero-intro",
  "glass-card glass-card--strong glass-pad hero-intro center-stack", "grid-12 grid-gap",
  "hero-cta hero-cta--primary", "hero-cta home-section-cta", "hero-cta-row u-mt-18", "home-seal-verse muted",
  "home-thumb responsive-gallery-frame", "list-stack legal-steps", "meta-text u-mt-10",
  "mobile-link is-active", "nav-item is-active", "nav-link is-active", "nav-link nav-auth-link",
  "nav-link nav-trigger", "official-profiles official-profiles--footer",
  "official-profiles official-profiles--header", "official-profiles official-profiles--mobile",
  "page-hero page-hero--tall", "page-main legal-page",
  "recruitment-audio-button recruitment-audio-button--mute",
  "recruitment-audio-button recruitment-audio-button--play",
  "recruitment-audio-shell u-full-width u-mt-12", "section-title section-title--sm",
]);
const PRODUCTION_GEOMETRY_CLASS_NAMES = new Set([
  "bg-photo", "home-bulletin__scrim", "home-door__scrim", "home-featured__scrim",
  "home-spotlight__scrim", "home-spotlight__surface-link", "home-thumb__scrim", "mobile-top",
  "nav-menu", "overlay-card__content", "overlay-card__image", "overlay-card__scrim",
  "responsive-gallery-media", "site-header", "skip-link", "spotify-embed__placeholder",
]);
const PRODUCTION_DOCUMENT_POLICIES = Object.freeze({
  deletion: Object.freeze({
    header: "951B1B5A4CD1F143B08D97FE83EA92425BCE46BB451BF00E5061E18579E5CE71",
    resources: Object.freeze([
      "EF68A8366B489129A4F89BD64001A55AD634AD15723A48DAF5E4C052ED2CE7AE",
      "ED2A94A30FFCEF523DAA23935D4327E0782719182CDEAC3EECFA14EEF2452E4E",
    ]),
  }),
  home: Object.freeze({
    variants: Object.freeze([
      Object.freeze({
        header: "675E803BB871598DAD4CE0D1A3A64CB1ED1D30FB7616932CEA63CF25A98530F0",
        resources: "3ED2476C6AE21876EADBE86B73FE0615C8FB8E1350C5E8CD9C8B34EF5B971820",
      }),
      Object.freeze({
        header: "411005B83187566BA48384F5D5211FDCA5D4A3932C9F1E1CAE8AE44B7A550B78",
        resources: "B4407357814ABF98CE52EDA66D0A472824DFBCBCD50FCFC902405D6262281761",
      }),
    ]),
  }),
  privacy: Object.freeze({
    header: "951B1B5A4CD1F143B08D97FE83EA92425BCE46BB451BF00E5061E18579E5CE71",
    resources: Object.freeze([
      "EC048124DED6CD1D564ED72BF08F5C5489559754D2C6556A7E44C2C117B591AF",
      "727E4C0D6E5C2A93C57660844BD08264A02643416CE0D63BCE58832DC2A863AA",
    ]),
  }),
  recruitment: Object.freeze({
    header: "66A0D6F526E99D38873D32D0B201816B1AF2C86151CF5CD99B1513BC6FA7B400",
    resources: Object.freeze([
      "F407952D409F3B5182F3465048F47592952C92948A4F56797886BD6194F1AAC4",
      "C92A261DD8F4354A428EFE76BA65AC19DBE81319FAC57762A97D1FB249FA238A",
    ]),
  }),
});
const TEST_DOCUMENT_POLICIES = Object.freeze({
  deletion: Object.freeze({
    header: "86F4BD56E49D759E1007911F74826C416C2D5038AF3CC00A9F7C818A29F79EE0",
    resources: "2354AEB6C7E3F5FE93409CE57430E49F75D64FC5CCF672F3CA537469A6472F3F",
  }),
  home: Object.freeze({
    variants: Object.freeze([
      Object.freeze({
        header: "86F4BD56E49D759E1007911F74826C416C2D5038AF3CC00A9F7C818A29F79EE0",
        resources: "28E5AAF90A062B6FDB43F973D00186DFB991828200350774561EBDBD303F3D3C",
      }),
      Object.freeze({
        header: "86F4BD56E49D759E1007911F74826C416C2D5038AF3CC00A9F7C818A29F79EE0",
        resources: "5A0B531E32BBAE90F0D3818C08FC76353377C347B6B7C8C80C2CA888B9F22EA8",
      }),
    ]),
  }),
  privacy: Object.freeze({
    header: "86F4BD56E49D759E1007911F74826C416C2D5038AF3CC00A9F7C818A29F79EE0",
    resources: Object.freeze([
      "109D7F534B9AEFDC3CC9D65BD6515DDB12EC5E65D28A651FB5248424B7654AD2",
      "71A9CD565A67DAA66C3229917EA748FB776DFB208A21B922647373B6F4BFD969",
    ]),
  }),
  recruitment: Object.freeze({
    header: "86F4BD56E49D759E1007911F74826C416C2D5038AF3CC00A9F7C818A29F79EE0",
    resources: "F37509273DC50F357AD2A76818C9C9E174B42A2AB092EB006A6E339B88BD3DEA",
  }),
});
const PRODUCTION_SITE_HEADER_ATTRIBUTE_NAMES = new Set(["class", "data-state", "id"]);
const PRODUCTION_NAV_GROUP_ATTRIBUTE_NAMES = new Set(["class", "data-dropdown", "data-open"]);
const PRODUCTION_NAV_MENU_ATTRIBUTE_NAMES = new Set(["class", "data-dropdown-menu", "hidden", "id"]);
const PRODUCTION_NAV_MENU_IDS = new Set(["nav-menu-culture", "nav-menu-guild", "nav-menu-updates"]);
const PRODUCTION_GALLERY_MEDIA_ATTRIBUTE_NAMES = new Set(["class", "data-image-state"]);
const PRODUCTION_SPOTLIGHT_LINK_ATTRIBUTE_NAMES = new Set(["aria-label", "class", "href"]);
const PRODUCTION_SCRIM_ATTRIBUTE_NAMES = new Set(["aria-hidden", "class"]);
const PRODUCTION_NEXT_SCRIPT_ATTRIBUTE_NAMES = Object.freeze([
  new Set(["async", "src"]),
  new Set(["async", "crossorigin", "src"]),
  new Set(["nomodule", "src"]),
]);
const PRODUCTION_NEXT_ROOT_SCRIPT_ATTRIBUTE_NAMES = new Set(["async", "id", "src"]);
const PRODUCTION_STRUCTURED_DATA_ATTRIBUTE_NAMES = new Set(["id", "type"]);
const PRODUCTION_STYLESHEET_ATTRIBUTE_NAMES = new Set(["data-precedence", "href", "rel"]);
const PRODUCTION_STYLE_PRELOAD_ATTRIBUTE_NAMES = new Set(["as", "href", "rel"]);
const PRODUCTION_CANONICAL_LINK_ATTRIBUTE_NAMES = new Set(["href", "rel"]);
const PRODUCTION_FONT_PRELOAD_ATTRIBUTE_NAMES = new Set(["as", "crossorigin", "href", "rel", "type"]);
const PRODUCTION_SCRIPT_PRELOAD_ATTRIBUTE_NAMES = new Set(["as", "fetchpriority", "href", "rel"]);
const PRODUCTION_IMAGE_PRELOAD_ATTRIBUTE_NAMES = new Set(["as", "imagesizes", "imagesrcset", "rel"]);
const PRODUCTION_PRIORITY_IMAGE_PRELOAD_ATTRIBUTE_NAMES = new Set([
  "as", "fetchpriority", "imagesizes", "imagesrcset", "rel",
]);
const PRODUCTION_DIRECT_IMAGE_PRELOAD_ATTRIBUTE_NAMES = new Set(["as", "href", "rel"]);
const PRODUCTION_BACKGROUND_IMAGE_ATTRIBUTE_NAMES = new Set([
  "alt", "class", "data-nimg", "decoding", "loading", "sizes", "src", "srcset", "style",
]);
const PRODUCTION_NEXT_IMAGE_ATTRIBUTE_NAMES = new Set([
  "alt", "class", "data-nimg", "decoding", "fetchpriority", "height", "id", "loading", "sizes",
  "src", "srcset", "style", "width",
]);
const PRODUCTION_NEXT_IMAGE_REQUIRED_ATTRIBUTE_NAMES = new Set([
  "alt", "data-nimg", "decoding", "height", "loading", "sizes", "src", "srcset", "style", "width",
]);
const PRODUCTION_GALLERY_IMAGE_ATTRIBUTE_NAMES = new Set([
  "alt", "class", "data-caption", "data-full", "decoding", "height", "loading", "src", "width",
]);
const PRODUCTION_ATMOSPHERE_IMAGE_ATTRIBUTE_NAMES = new Set([
  "alt", "aria-hidden", "class", "decoding", "id", "src",
]);
const PRODUCTION_BACKGROUND_WRAPPER_ATTRIBUTE_NAMES = new Set(["aria-hidden", "class"]);
const PRODUCTION_AUDIO_PLAYER_ATTRIBUTE_NAMES = new Set([
  "aria-describedby", "class", "data-custom-recruitment-audio-player", "data-state", "style",
]);
const PRODUCTION_SAFE_IMAGE_CLASS_NAMES = new Set([
  "", "brand-emblem", "footer-emblem", "home-bulletin__img", "home-door__img", "home-featured__img",
  "home-spotlight__img", "page-hero__img",
]);
const PRODUCTION_ANCHOR_ATTRIBUTE_NAMES = new Set([
  "aria-current", "aria-label", "class", "data-auth-signed-out", "data-has-mark", "data-nav",
  "data-official-profile", "href", "id", "referrerpolicy", "rel", "target",
]);
const PRODUCTION_SAFE_ANCHOR_CLASS_NAMES = new Set([
  "", "brand", "brand brand--mobile", "cta", "footer-brand-link", "footer-cta", "footer-link", "footer-nav",
  "hero-cta", "hero-cta hero-cta--primary", "hero-cta home-section-cta", "home-bulletin", "home-door", "home-featured",
  "home-spotlight__surface-link", "mobile-link", "mobile-link is-active", "nav-item", "nav-item is-active",
  "nav-link", "nav-link is-active", "nav-link nav-auth-link", "official-profile-link", "skip-link",
]);
const PRODUCTION_UNREVIEWED_RESOURCE_ATTRIBUTE_NAMES = new Set([
  "action", "background", "cite", "data", "formaction", "manifest", "ping", "poster", "profile", "srcdoc",
]);
const PRODUCTION_MOBILE_SHELL_ATTRIBUTE_NAMES = new Set([
  "aria-label", "aria-modal", "class", "data-open", "hidden", "id", "role",
]);
const PRODUCTION_MOBILE_SCRIM_ATTRIBUTE_NAMES = new Set(["aria-hidden", "class", "data-close"]);
const PRODUCTION_MOBILE_SHEET_ATTRIBUTE_NAMES = new Set(["class", "role"]);
const PRODUCTION_OVERLAY_ROOT_IDS = new Set([
  "lightbox", "lightboxbackdrop", "modalbackdrop", "modalroot",
]);
const PRODUCTION_BACKGROUND_IMAGE_STYLE =
  "position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;color:transparent";
const PRODUCTION_AUDIO_PLAYER_STYLE = "--audio-progress:0%;--audio-volume:100%";
const PRODUCTION_BACKGROUND_IMAGE_ASSET = "%2Fassets%2Fbg%2Fwuxia-bg.webp";
const PRODUCTION_BACKGROUND_IMAGE_WIDTHS = Object.freeze([640, 750, 828, 1080, 1200, 1920, 2048, 3840]);
const PRODUCTION_NEXT_IMAGE_WIDTH_LIST = Object.freeze([
  32, 48, 64, 96, 128, 256, 384, ...PRODUCTION_BACKGROUND_IMAGE_WIDTHS,
]);
const PRODUCTION_NEXT_IMAGE_WIDTHS = new Set(PRODUCTION_NEXT_IMAGE_WIDTH_LIST);
const PRODUCTION_NEXT_IMAGE_SIGNATURES = new Set([
  "|sealImage|%2Fassets%2Fimg%2Fbrand%2Femblem.webp|1024|1024|(max-width: 640px) 128px, 116px|lazy|",
  "brand-emblem||%2Fassets%2Fimg%2Fbrand%2Femblem.webp|44|44|44px|lazy|",
  "brand-emblem||%2Fassets%2Fimg%2Fbrand%2Femblem.webp|56|56|56px|eager|low",
  "footer-emblem||%2Fassets%2Fimg%2Fbrand%2Femblem.webp|56|56|56px|lazy|",
  "home-bulletin__img||%2Fassets%2Fimg%2Fbulletins%2Fannouncement.webp|960|600|(max-width: 900px) calc(100vw - 68px), 320px|lazy|",
  "home-bulletin__img||%2Fassets%2Fimg%2Fbulletins%2Fraffle.webp|960|600|(max-width: 900px) calc(100vw - 68px), 320px|lazy|",
  "home-door__img||%2Fassets%2Fimg%2Ftiles%2Fjoin.webp|960|600|(max-width: 900px) calc(100vw - 68px), 280px|lazy|",
  "home-door__img||%2Fassets%2Fimg%2Ftiles%2Fleaders.webp|960|600|(max-width: 900px) calc(100vw - 68px), 280px|lazy|",
  "home-door__img||%2Fassets%2Fimg%2Ftiles%2Franks.webp|960|600|(max-width: 900px) calc(100vw - 68px), 280px|lazy|",
  "home-door__img||%2Fassets%2Fimg%2Ftiles%2Ftome.webp|960|600|(max-width: 900px) calc(100vw - 68px), 280px|lazy|",
  "home-featured__img|featuredBulletinImage|%2Fassets%2Fimg%2Fbulletins%2Ffeatured.webp|1280|720|(max-width: 1232px) calc(100vw - 68px), 1120px|lazy|",
  "home-spotlight__img|spotlightImage|%2Fassets%2Fimg%2Ffeatured%2Fspotlight.webp|1536|1024|(max-width: 1232px) calc(100vw - 68px), 1120px|lazy|",
  "page-hero__img|heroImage|%2Fassets%2Fimg%2Fhero%2Fhero.webp|1536|1024|(max-width: 1232px) calc(100vw - 32px), 1200px|eager|high",
  "page-hero__img|meta-data-deletionHeroImage|%2Fassets%2Fimg%2Fgallery%2Fhero.webp|1536|1024|(max-width: 1232px) calc(100vw - 32px), 1200px|eager|high",
  "page-hero__img|privacyHeroImage|%2Fassets%2Fimg%2Fgallery%2Fhero.webp|1536|1024|(max-width: 1232px) calc(100vw - 32px), 1200px|eager|high",
  "page-hero__img|recruitmentHeroImage|%2Fassets%2Fimg%2Frecruitment%2Fhero.webp|1536|1024|(max-width: 1232px) calc(100vw - 32px), 1200px|eager|high",
]);
const PRODUCTION_IMAGE_DIMENSION_LIMIT = 4096;
const PRODUCTION_IMAGE_VALUE_LIMIT = 8192;

function asciiLower(value) {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function isHtmlSpace(character) {
  return character === "\t" || character === "\n" || character === "\f"
    || character === "\r" || character === " ";
}

function trimHtmlSpace(value) {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
}

function normalizeProductionElementText(value) {
  return trimHtmlSpace(value).replace(/[\t\n\f\r ]+/g, " ");
}

function productionTagHasEventHandler(tag) {
  return [...tag.attributeNames].some((name) => /^on[a-z]/.test(name));
}

function productionTagHasExactAttributeNames(tag, expectedNames) {
  if (tag.duplicates.size !== 0 || tag.attributeNames.size !== expectedNames.size) return false;
  return [...expectedNames].every((name) => tag.attributeNames.has(name));
}

function productionAnchorTagIsSafe(tag) {
  if (!tag.attributeNames.has("href")
    || tag.duplicates.size !== 0
    || [...tag.attributeNames].some((name) => !PRODUCTION_ANCHOR_ATTRIBUTE_NAMES.has(name))) return false;
  const href = tag.attributes.get("href") || "";
  if (href.length === 0
    || href.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters
    || /[&\\\u0000-\u001f\u007f]/.test(href)) return false;
  const target = tag.attributes.get("target");
  const rel = tag.attributes.get("rel");
  const referrerPolicy = tag.attributes.get("referrerpolicy");
  const className = tag.attributes.get("class") || "";
  if (!PRODUCTION_SAFE_ANCHOR_CLASS_NAMES.has(className)
    || (tag.attributes.has("id") && tag.attributes.get("id") !== "featuredBulletin")
    || (tag.attributes.has("aria-current") && tag.attributes.get("aria-current") !== "page")
    || (tag.attributes.has("data-auth-signed-out") && tag.attributes.get("data-auth-signed-out") !== "true")
    || (tag.attributes.has("data-has-mark") && tag.attributes.get("data-has-mark") !== "false")
    || (tag.attributes.has("data-nav") && !/^[a-z0-9/-]{1,64}$/.test(tag.attributes.get("data-nav") || ""))
    || (tag.attributes.has("data-official-profile")
      && !["facebook-page", "instagram", "tiktok", "twitch", "youtube"]
        .includes(tag.attributes.get("data-official-profile")))
    || (target !== undefined && (target !== "_blank" || rel !== "noopener noreferrer"))
    || (target === undefined && rel !== undefined)
    || (referrerPolicy !== undefined && referrerPolicy !== "no-referrer")) return false;
  if (isSafeRoutePath(href)) {
    const routeTarget = new URL(href, "https://anchor.invalid");
    return routeTarget.pathname === href && !routeTarget.search && !routeTarget.hash;
  }
  if (/^#[A-Za-z][A-Za-z0-9._:-]*$/.test(href)
    || href === "mailto:support@mochirii.com"
    || href === "mailto:support@mochirii.com?subject=M%C5%8Dchir%C4%AB%C4%AB%20data%20deletion%20request") {
    return true;
  }
  if (!/^https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~!$'()*+,;=:@%/-]*)?\/?$/.test(href)) return false;
  try {
    const target = new URL(href);
    return target.protocol === "https:"
      && !target.username
      && !target.password
      && (target.href === href || (target.href === href + "/" && href === target.origin));
  } catch {
    return false;
  }
}

function productionElementResourceAttributesAreSafe(tag) {
  if ([...tag.attributeNames].some((name) => PRODUCTION_UNREVIEWED_RESOURCE_ATTRIBUTE_NAMES.has(name))) {
    return false;
  }
  if (tag.attributeNames.has("src") && !["audio", "img", "script"].includes(tag.name)) return false;
  if (tag.attributeNames.has("srcset") && tag.name !== "img") return false;
  if (tag.attributeNames.has("href") && !["a", "link"].includes(tag.name)) return false;
  if ((tag.attributeNames.has("imagesrcset") || tag.attributeNames.has("imagesizes")) && tag.name !== "link") {
    return false;
  }
  if (tag.name !== "img" && ["height", "size", "width"].some((name) => tag.attributeNames.has(name))) {
    return false;
  }
  return !(tag.name === "input" && asciiLower(tag.attributes.get("type") || "") === "image");
}

function parseProductionNextImageUrl(value) {
  if (typeof value !== "string" || value.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters) return null;
  const match = /^\/_next\/image\?url=(%2Fassets(?:%2F[A-Za-z0-9_-][A-Za-z0-9._-]*)+\.webp)&amp;w=([1-9][0-9]{0,3})&amp;q=75$/.exec(value);
  if (!match) return null;
  const width = Number(match[2]);
  return PRODUCTION_NEXT_IMAGE_WIDTHS.has(width) ? Object.freeze({ asset: match[1], width }) : null;
}

function productionNextImageSrcsetIsSafe(value, asset, expectedWidths = null) {
  if (typeof value !== "string" || value.length === 0 || value.length > PRODUCTION_IMAGE_VALUE_LIMIT) return false;
  const candidates = value.split(", ");
  if (candidates.length > 32 || (expectedWidths && candidates.length !== expectedWidths.length)) return false;
  let previousWidth = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const separator = candidates[index].lastIndexOf(" ");
    const parsed = separator > 0 ? parseProductionNextImageUrl(candidates[index].slice(0, separator)) : null;
    const width = parsed?.width || 0;
    if (!parsed
      || parsed.asset !== asset
      || candidates[index].slice(separator + 1) !== `${width}w`
      || width <= previousWidth
      || (expectedWidths && width !== expectedWidths[index])) return false;
    previousWidth = width;
  }
  return candidates.length > 0;
}

function productionNextImageTagIsSafe(tag) {
  if (tag.duplicates.size !== 0
    || [...tag.attributeNames].some((name) => !PRODUCTION_NEXT_IMAGE_ATTRIBUTE_NAMES.has(name))
    || [...PRODUCTION_NEXT_IMAGE_REQUIRED_ATTRIBUTE_NAMES].some((name) => !tag.attributeNames.has(name))) return false;
  const width = tag.attributes.get("width") || "";
  const height = tag.attributes.get("height") || "";
  const sizes = tag.attributes.get("sizes") || "";
  const source = parseProductionNextImageUrl(tag.attributes.get("src") || "");
  const priority = tag.attributes.get("fetchpriority");
  const signature = [
    tag.attributes.get("class") || "", tag.attributes.get("id") || "", source?.asset || "",
    width, height, sizes, tag.attributes.get("loading") || "", priority || "",
  ].join("|");
  return /^[1-9][0-9]{0,3}$/.test(width)
    && /^[1-9][0-9]{0,3}$/.test(height)
    && Number(width) <= PRODUCTION_IMAGE_DIMENSION_LIMIT
    && Number(height) <= PRODUCTION_IMAGE_DIMENSION_LIMIT
    && sizes.length > 0
    && sizes.length <= 256
    && !/[&<>"'\\\u0000-\u001f\u007f]/.test(sizes)
    && tag.attributes.get("data-nimg") === "1"
    && tag.attributes.get("decoding") === "async"
    && ["eager", "lazy"].includes(tag.attributes.get("loading"))
    && (priority === undefined || priority === "high" || priority === "low")
    && PRODUCTION_SAFE_IMAGE_CLASS_NAMES.has(tag.attributes.get("class") || "")
    && source?.width === 3840
    && PRODUCTION_NEXT_IMAGE_SIGNATURES.has(signature)
    && productionNextImageSrcsetIsSafe(
      tag.attributes.get("srcset") || "", source.asset, PRODUCTION_NEXT_IMAGE_WIDTH_LIST,
    );
}

function productionRawImageTagIsSafe(tag) {
  if (productionTagHasExactAttributeNames(tag, PRODUCTION_GALLERY_IMAGE_ATTRIBUTE_NAMES)) {
    const sourceMatch = /^\/assets\/img\/gallery\/thumbs\/shot-([0-9]{2})\.webp$/.exec(
      tag.attributes.get("src") || "",
    );
    return sourceMatch !== null
      && tag.attributes.get("class") === "responsive-gallery-media__image"
      && tag.attributes.get("width") === "16"
      && tag.attributes.get("height") === "10"
      && tag.attributes.get("loading") === "lazy"
      && tag.attributes.get("decoding") === "async"
      && tag.attributes.get("data-full") === `/assets/img/gallery/shot-${sourceMatch[1]}.webp`
      && (tag.attributes.get("alt") || "").length <= 256
      && (tag.attributes.get("data-caption") || "").length <= 512;
  }
  return productionTagHasExactAttributeNames(tag, PRODUCTION_ATMOSPHERE_IMAGE_ATTRIBUTE_NAMES)
    && tag.attributes.get("id") === "recruitmentAtmosphere"
    && tag.attributes.get("src") === "/assets/img/recruitment/atmosphere.webp"
    && tag.attributes.get("alt") === ""
    && tag.attributes.get("class") === "page-hero__atmos"
    && tag.attributes.get("decoding") === "async"
    && tag.attributes.get("aria-hidden") === "true";
}

function productionAudioTagIsSafe(tag) {
  if (!productionTagHasExactAttributeNames(tag, PRODUCTION_SAFE_AUDIO_ATTRIBUTE_NAMES)) return false;
  const source = tag.attributes.get("src") || "";
  return tag.attributes.get("id") === "recruitmentAudio"
    && tag.attributes.get("class") === "recruitment-audio-native"
    && tag.attributes.get("preload") === "none"
    && tag.attributes.get("controlslist") === "nodownload"
    && tag.attributes.get("aria-labelledby") === "recruitmentAudioTitle"
    && tag.attributes.get("aria-describedby") === "recruitmentAudioDesc"
    && /^(?:\.\/|\/)assets\/audio\/[A-Za-z0-9._-]+$/.test(source);
}

function productionInlineStyleIsSafe(tag, { footerCount, insideFooter, parentTag }) {
  if (!tag.attributeNames.has("style")) return tag.name !== "img" || productionRawImageTagIsSafe(tag);
  const style = tag.attributes.get("style") || "";
  if (tag.duplicates.has("style") || style.includes("&")) return false;
  if (tag.name === "div" && style === PRODUCTION_AUDIO_PLAYER_STYLE) {
    return productionTagHasExactAttributeNames(tag, PRODUCTION_AUDIO_PLAYER_ATTRIBUTE_NAMES)
      && tag.attributes.get("class") === "recruitment-audio-player"
      && tag.attributes.get("data-custom-recruitment-audio-player") === "true"
      && tag.attributes.get("data-state") === "paused"
      && tag.attributes.get("aria-describedby") === "recruitmentAudioDesc";
  }
  if (tag.name !== "img") return false;
  if (style === "color:transparent") {
    return productionNextImageTagIsSafe(tag);
  }
  const backgroundSource = parseProductionNextImageUrl(tag.attributes.get("src") || "");
  return style === PRODUCTION_BACKGROUND_IMAGE_STYLE
    && footerCount === 0
    && !insideFooter
    && productionTagHasExactAttributeNames(tag, PRODUCTION_BACKGROUND_IMAGE_ATTRIBUTE_NAMES)
    && tag.attributes.get("alt") === ""
    && tag.attributes.get("class") === "bg-photo__image"
    && tag.attributes.get("data-nimg") === "fill"
    && tag.attributes.get("decoding") === "async"
    && tag.attributes.get("loading") === "eager"
    && tag.attributes.get("sizes") === "100vw"
    && backgroundSource?.asset === PRODUCTION_BACKGROUND_IMAGE_ASSET
    && backgroundSource.width === 3840
    && productionNextImageSrcsetIsSafe(
      tag.attributes.get("srcset") || "",
      PRODUCTION_BACKGROUND_IMAGE_ASSET,
      PRODUCTION_BACKGROUND_IMAGE_WIDTHS,
    )
    && parentTag?.name === "div"
    && productionTagHasExactAttributeNames(parentTag, PRODUCTION_BACKGROUND_WRAPPER_ATTRIBUTE_NAMES)
    && parentTag.attributes.get("class") === "bg-photo"
    && parentTag.attributes.get("aria-hidden") === "true";
}

function productionOverlayElementIsSafe(tag, parentTag, {
  ancestorTags = [], insideFooter = false,
} = {}) {
  const id = tag.attributes.get("id") || "";
  const className = tag.attributes.get("class") || "";
  if (id.includes("&") || className.includes("&")) return false;
  if (PRODUCTION_OVERLAY_ROOT_IDS.has(asciiLower(id))) return false;
  const classTokens = asciiLower(trimHtmlSpace(className)).split(/[\t\n\f\r ]+/).filter(Boolean);
  if ((classTokens.length > 1 && !PRODUCTION_SAFE_COMPOUND_CLASS_NAMES.has(className))
    || (insideFooter && classTokens.includes("home-spotlight__surface-link"))
    || classTokens.some((token) => token.startsWith("birthday-splash") || token.startsWith("lightbox"))) {
    return false;
  }
  const parentClass = parentTag?.attributes.get("class") || "";
  const hasMainAncestor = ancestorTags.some((ancestor) => ancestor.name === "main"
    && ["page-main", "page-main legal-page"].includes(ancestor.attributes.get("class") || ""));
  const hasSiteHeaderAncestor = ancestorTags.some((ancestor) => ancestor.name === "header"
    && ancestor.attributes.get("class") === "site-header");
  const hasMobileShellAncestor = ancestorTags.some((ancestor) => ancestor.name === "div"
    && ancestor.attributes.get("class") === "mobile-shell");
  if (PRODUCTION_GEOMETRY_CLASS_NAMES.has(className)) {
    if (className === "site-header") {
      return tag.name === "header"
        && productionTagHasExactAttributeNames(tag, PRODUCTION_SITE_HEADER_ATTRIBUTE_NAMES)
        && tag.attributes.get("id") === "site-header"
        && tag.attributes.get("data-state") === "top"
        && parentTag?.name === "body";
    }
    if (className === "skip-link") {
      return tag.name === "a"
        && productionTagHasExactAttributeNames(tag, new Set(["class", "href"]))
        && tag.attributes.get("href") === "#main"
        && parentTag?.name === "header"
        && parentClass === "site-header";
    }
    if (className === "bg-photo") {
      return tag.name === "div"
        && productionTagHasExactAttributeNames(tag, PRODUCTION_BACKGROUND_WRAPPER_ATTRIBUTE_NAMES)
        && tag.attributes.get("aria-hidden") === "true"
        && parentTag?.name === "body";
    }
    if (className === "nav-menu") {
      return tag.name === "div"
        && productionTagHasExactAttributeNames(tag, PRODUCTION_NAV_MENU_ATTRIBUTE_NAMES)
        && PRODUCTION_NAV_MENU_IDS.has(tag.attributes.get("id"))
        && tag.attributes.get("data-dropdown-menu") === "true"
        && tag.attributes.has("hidden")
        && parentTag?.name === "div"
        && productionTagHasExactAttributeNames(parentTag, PRODUCTION_NAV_GROUP_ATTRIBUTE_NAMES)
        && parentClass === "nav-group"
        && parentTag.attributes.get("data-dropdown") === "true"
        && parentTag.attributes.get("data-open") === "false"
        && hasSiteHeaderAncestor;
    }
    if (className === "mobile-top") {
      return tag.name === "div"
        && productionTagHasExactAttributeNames(tag, new Set(["class"]))
        && parentTag?.name === "div"
        && parentClass === "mobile-sheet"
        && hasMobileShellAncestor;
    }
    if (className === "responsive-gallery-media") {
      return tag.name === "span"
        && productionTagHasExactAttributeNames(tag, PRODUCTION_GALLERY_MEDIA_ATTRIBUTE_NAMES)
        && tag.attributes.get("data-image-state") === "loading"
        && parentTag?.name === "button"
        && parentClass === "home-thumb responsive-gallery-frame"
        && ancestorTags.some((ancestor) => ancestor.name === "div"
          && ancestor.attributes.get("class") === "home-gallery"
          && ancestor.attributes.get("id") === "galleryGrid")
        && hasMainAncestor;
    }
    if (className === "home-spotlight__surface-link") {
      return tag.name === "a"
        && productionTagHasExactAttributeNames(tag, PRODUCTION_SPOTLIGHT_LINK_ATTRIBUTE_NAMES)
        && tag.attributes.get("href") === "/spotlight"
        && parentTag?.name === "div"
        && parentClass === "home-spotlight"
        && parentTag.attributes.get("id") === "spotlightCard"
        && hasMainAncestor;
    }
    const scrimProfiles = {
      "home-bulletin__scrim": ["div", "home-bulletin__media"],
      "home-door__scrim": ["div", "home-door__media"],
      "home-featured__scrim": ["div", "home-featured"],
      "home-spotlight__scrim": ["div", "home-spotlight"],
      "home-thumb__scrim": ["span", "home-thumb responsive-gallery-frame"],
    };
    const scrimProfile = scrimProfiles[className];
    if (scrimProfile) {
      return tag.name === scrimProfile[0]
        && productionTagHasExactAttributeNames(tag, PRODUCTION_SCRIM_ATTRIBUTE_NAMES)
        && tag.attributes.get("aria-hidden") === "true"
        && parentClass === scrimProfile[1]
        && hasMainAncestor;
    }
    return false;
  }
  if (classTokens.includes("mobile-shell")) {
    return productionTagHasExactAttributeNames(tag, PRODUCTION_MOBILE_SHELL_ATTRIBUTE_NAMES)
      && className === "mobile-shell"
      && tag.attributes.get("id") === "mobile-menu"
      && tag.attributes.get("role") === "dialog"
      && tag.attributes.get("aria-modal") === "true"
      && tag.attributes.get("aria-label") === "Menu"
      && tag.attributes.has("hidden")
      && tag.attributes.get("data-open") === "false"
      && parentTag?.name === "header"
      && parentTag.attributes.get("class") === "site-header";
  }
  if (classTokens.includes("mobile-scrim")) {
    return productionTagHasExactAttributeNames(tag, PRODUCTION_MOBILE_SCRIM_ATTRIBUTE_NAMES)
      && className === "mobile-scrim"
      && tag.attributes.get("data-close") === "true"
      && tag.attributes.get("aria-hidden") === "true"
      && parentTag?.attributes.get("class") === "mobile-shell";
  }
  if (classTokens.includes("mobile-sheet")) {
    return productionTagHasExactAttributeNames(tag, PRODUCTION_MOBILE_SHEET_ATTRIBUTE_NAMES)
      && className === "mobile-sheet"
      && tag.attributes.get("role") === "document"
      && parentTag?.attributes.get("class") === "mobile-shell";
  }
  return true;
}

function productionLinkTagIsSafe(tag) {
  const rel = tag.attributes.get("rel") || "";
  const as = tag.attributes.get("as") || "";
  if (rel.includes("&") || as.includes("&")) return false;
  const normalizedRel = asciiLower(trimHtmlSpace(rel));
  const normalizedAs = asciiLower(trimHtmlSpace(as));
  const href = tag.attributes.get("href") || "";
  const nextStylesheet = /^\/_next\/static\/(?:[A-Za-z0-9_-]{1,64}\/)?chunks\/[A-Za-z0-9._-]+\.css$/;
  if (normalizedRel === "canonical") {
    return productionTagHasExactAttributeNames(tag, PRODUCTION_CANONICAL_LINK_ATTRIBUTE_NAMES)
      && /^https:\/\/mochirii\.com(?:\/[a-z0-9-]+)?$/.test(href);
  }
  if (normalizedRel === "icon" || normalizedRel === "apple-touch-icon") {
    return productionTagHasExactAttributeNames(tag, PRODUCTION_CANONICAL_LINK_ATTRIBUTE_NAMES)
      && href === (normalizedRel === "icon" ? "/favicon.ico" : "/assets/img/brand/apple-touch-icon.png");
  }
  if (normalizedRel === "stylesheet") {
    return productionTagHasExactAttributeNames(tag, PRODUCTION_STYLESHEET_ATTRIBUTE_NAMES)
      && tag.attributes.get("data-precedence") === "next"
      && nextStylesheet.test(href);
  }
  if (normalizedRel !== "preload") return false;
  if (normalizedAs === "style") {
    return productionTagHasExactAttributeNames(tag, PRODUCTION_STYLE_PRELOAD_ATTRIBUTE_NAMES)
      && nextStylesheet.test(href);
  }
  if (normalizedAs === "font") {
    return productionTagHasExactAttributeNames(tag, PRODUCTION_FONT_PRELOAD_ATTRIBUTE_NAMES)
      && tag.attributes.get("crossorigin") === ""
      && tag.attributes.get("type") === "font/woff2"
      && /^\/_next\/static\/(?:[A-Za-z0-9_-]{1,64}\/)?media\/[A-Za-z0-9._-]+\.woff2$/.test(href);
  }
  if (normalizedAs === "script") {
    return productionTagHasExactAttributeNames(tag, PRODUCTION_SCRIPT_PRELOAD_ATTRIBUTE_NAMES)
      && tag.attributes.get("fetchpriority") === "low"
      && /^\/_next\/static\/(?:[A-Za-z0-9_-]{1,64}\/)?chunks\/[A-Za-z0-9._-]+\.js$/.test(href);
  }
  if (normalizedAs !== "image") return false;
  if (tag.attributeNames.has("href")) {
    return productionTagHasExactAttributeNames(tag, PRODUCTION_DIRECT_IMAGE_PRELOAD_ATTRIBUTE_NAMES)
      && href === "/assets/img/recruitment/atmosphere.webp";
  }
  const expectedNames = tag.attributeNames.has("fetchpriority")
    ? PRODUCTION_PRIORITY_IMAGE_PRELOAD_ATTRIBUTE_NAMES
    : PRODUCTION_IMAGE_PRELOAD_ATTRIBUTE_NAMES;
  const imageSizes = tag.attributes.get("imagesizes") || "";
  const imageSrcset = tag.attributes.get("imagesrcset") || "";
  const firstCandidate = imageSrcset.split(", ")[0] || "";
  const separator = firstCandidate.lastIndexOf(" ");
  const firstSource = separator > 0 ? parseProductionNextImageUrl(firstCandidate.slice(0, separator)) : null;
  return productionTagHasExactAttributeNames(tag, expectedNames)
    && (!tag.attributeNames.has("fetchpriority") || tag.attributes.get("fetchpriority") === "high")
    && imageSizes.length > 0
    && imageSizes.length <= 256
    && !/[&<>"'\\\u0000-\u001f\u007f]/.test(imageSizes)
    && firstSource !== null
    && productionNextImageSrcsetIsSafe(imageSrcset, firstSource.asset);
}

function productionScriptTagIsSafe(tag, text) {
  if (productionTagHasExactAttributeNames(tag, PRODUCTION_STRUCTURED_DATA_ATTRIBUTE_NAMES)) {
    if (tag.attributes.get("id") !== "home-structured-data"
      || asciiLower(tag.attributes.get("type") || "") !== "application/ld+json") return false;
    try {
      const structuredData = JSON.parse(text);
      return structuredData !== null && typeof structuredData === "object" && !Array.isArray(structuredData);
    } catch {
      return false;
    }
  }

  const source = tag.attributes.get("src") || "";
  if (source) {
    if (text !== ""
      || !/^\/_next\/static\/(?:[A-Za-z0-9_-]{1,64}\/)?chunks\/[A-Za-z0-9._-]+\.js$/.test(source)) return false;
    if (productionTagHasExactAttributeNames(tag, PRODUCTION_NEXT_ROOT_SCRIPT_ATTRIBUTE_NAMES)) {
      return tag.attributes.get("id") === "_R_";
    }
    return PRODUCTION_NEXT_SCRIPT_ATTRIBUTE_NAMES.some(
      (attributeNames) => productionTagHasExactAttributeNames(tag, attributeNames),
    );
  }

  if (tag.attributeNames.size !== 0 || tag.duplicates.size !== 0) return false;
  if (text === "(self.__next_f=self.__next_f||[]).push([0])") return true;
  const prefix = "self.__next_f.push(";
  if (!text.startsWith(prefix) || !text.endsWith(")")) return false;
  try {
    const payload = JSON.parse(text.slice(prefix.length, -1));
    return Array.isArray(payload)
      && payload.length === 2
      && payload[0] === 1
      && typeof payload[1] === "string";
  } catch {
    return false;
  }
}

function canonicalizeProductionNextStaticReferences(value, buildIds) {
  let markerCount = 0;
  for (let cursor = 0; cursor < value.length;) {
    const marker = value.indexOf("/_next/static/", cursor);
    if (marker < 0) break;
    markerCount += 1;
    cursor = marker + 14;
  }
  let matchCount = 0;
  const canonical = value.replace(
    /\/_next\/static\/(?:([A-Za-z0-9_-]{1,64})\/)?(chunks|media)\//g,
    (_match, buildId, directory) => {
      matchCount += 1;
      buildIds.add(buildId || "");
      return `/_next/static/${directory}/`;
    },
  );
  return matchCount === markerCount ? canonical : null;
}

const PRODUCTION_NEXT_GENERATED_HASH_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz_-";
const PRODUCTION_NEXT_GENERATED_HASH_PREFIX_MAX = "45cn8rw14zvg_";

function productionNextGeneratedHashPrefixIsValid(value) {
  if (!/^[0-9a-z_-]{13}$/.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const candidateDigit = PRODUCTION_NEXT_GENERATED_HASH_ALPHABET.indexOf(value[index]);
    const maximumDigit = PRODUCTION_NEXT_GENERATED_HASH_ALPHABET.indexOf(
      PRODUCTION_NEXT_GENERATED_HASH_PREFIX_MAX[index],
    );
    if (candidateDigit < maximumDigit) return true;
    if (candidateDigit > maximumDigit) return false;
  }
  return true;
}

function canonicalizeProductionResourceEnvelopeShape(value, buildIds) {
  const canonical = canonicalizeProductionNextStaticReferences(value, buildIds);
  if (canonical === null) return null;
  return canonical.replace(
    /\/_next\/static\/(chunks|media)\/([A-Za-z0-9._\/-]+)/g,
    (reference, directory, pathname) => {
      const segments = pathname.split("/");
      const filename = segments.at(-1) || "";
      const generated = /^(.*[.-])?([0-9a-z_-]{13})(\.[A-Za-z0-9]{1,16})$/.exec(filename);
      if (!generated || !productionNextGeneratedHashPrefixIsValid(generated[2])) return reference;
      segments[segments.length - 1] = (generated[1] || "")
        + "__NEXT_GENERATED__" + generated[3];
      return "/_next/static/" + directory + "/" + segments.join("/");
    },
  );
}

const PRODUCTION_FLIGHT_ROOT_KEYS = Object.freeze([
  "P", "c", "q", "i", "f", "m", "G", "S", "h", "r", "s", "a", "l", "p", "d", "b",
]);
const PRODUCTION_FLIGHT_IMAGE_PROPERTY_NAMES = new Set([
  "alt", "aria-hidden", "className", "decoding", "fetchPriority", "height", "id", "loading",
  "sizes", "src", "srcSet", "width",
]);
const PRODUCTION_FLIGHT_ANCHOR_PROPERTY_NAMES = new Set([
  "aria-label", "children", "className", "href", "id", "rel", "target",
]);
const PRODUCTION_FLIGHT_ACTIVE_PROPERTY_NAMES = new Set([
  "action", "background", "cite", "dangerouslysetinnerhtml", "data", "formaction", "href",
  "httpequiv", "imagesrcset", "manifest", "ping", "poster", "profile", "src", "srcdoc", "srcset",
  "style",
]);

function parseProductionJsonWithSpans(source) {
  if (typeof source !== "string" || source.length > PRODUCTION_CHECK_LIMITS.htmlBytes) return null;
  let cursor = 0;
  let nodeCount = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

  function skipWhitespace() {
    while (cursor < source.length && /[\t\n\r ]/.test(source[cursor])) cursor += 1;
  }

  function parseString() {
    if (source[cursor] !== '"') return null;
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code === 0x22) {
        cursor += 1;
        try {
          return Object.freeze({
            end: cursor,
            start,
            type: "string",
            value: JSON.parse(source.slice(start, cursor)),
          });
        } catch {
          return null;
        }
      }
      if (code === 0x5c) {
        cursor += 1;
        if (cursor >= source.length) return null;
        if (source[cursor] === "u") {
          if (!/^[A-Fa-f0-9]{4}$/.test(source.slice(cursor + 1, cursor + 5))) return null;
          cursor += 5;
          continue;
        }
        if (!/^["\\/bfnrt]$/.test(source[cursor])) return null;
        cursor += 1;
        continue;
      }
      if (code < 0x20) return null;
      cursor += 1;
    }
    return null;
  }

  function parseValue(depth) {
    if (depth > PRODUCTION_HTML_DEPTH_LIMIT
      || ++nodeCount > PRODUCTION_CHECK_LIMITS.htmlBytes) return null;
    skipWhitespace();
    const start = cursor;
    if (source[cursor] === '"') return parseString();
    if (source[cursor] === "[") {
      cursor += 1;
      skipWhitespace();
      const items = [];
      if (source[cursor] === "]") {
        cursor += 1;
        return Object.freeze({ end: cursor, items: Object.freeze(items), start, type: "array" });
      }
      while (cursor < source.length) {
        const item = parseValue(depth + 1);
        if (item === null) return null;
        items.push(item);
        skipWhitespace();
        if (source[cursor] === "]") {
          cursor += 1;
          return Object.freeze({ end: cursor, items: Object.freeze(items), start, type: "array" });
        }
        if (source[cursor] !== ",") return null;
        cursor += 1;
      }
      return null;
    }
    if (source[cursor] === "{") {
      cursor += 1;
      skipWhitespace();
      const entries = [];
      const keys = new Set();
      if (source[cursor] === "}") {
        cursor += 1;
        return Object.freeze({ end: cursor, entries: Object.freeze(entries), start, type: "object" });
      }
      while (cursor < source.length) {
        const key = parseString();
        if (key === null || keys.has(key.value)) return null;
        keys.add(key.value);
        skipWhitespace();
        if (source[cursor] !== ":") return null;
        cursor += 1;
        const entryValue = parseValue(depth + 1);
        if (entryValue === null) return null;
        entries.push(Object.freeze({ key, value: entryValue }));
        skipWhitespace();
        if (source[cursor] === "}") {
          cursor += 1;
          return Object.freeze({
            end: cursor, entries: Object.freeze(entries), start, type: "object",
          });
        }
        if (source[cursor] !== ",") return null;
        cursor += 1;
        skipWhitespace();
      }
      return null;
    }
    for (const [literal, type, literalValue] of [
      ["true", "boolean", true],
      ["false", "boolean", false],
      ["null", "null", null],
    ]) {
      if (!source.startsWith(literal, cursor)) continue;
      cursor += literal.length;
      return Object.freeze({ end: cursor, start, type, value: literalValue });
    }
    numberPattern.lastIndex = cursor;
    const number = numberPattern.exec(source);
    if (!number) return null;
    cursor = numberPattern.lastIndex;
    return Object.freeze({
      end: cursor, start, type: "number", value: Number(number[0]),
    });
  }

  const root = parseValue(0);
  skipWhitespace();
  return root !== null && cursor === source.length ? root : null;
}

function productionJsonObjectEntry(node, name) {
  return node?.type === "object"
    ? node.entries.find((entry) => entry.key.value === name) ?? null : null;
}

function productionJsonObjectKeysMatch(node, names) {
  const expected = new Set(names);
  return node?.type === "object"
    && node.entries.length === names.length
    && expected.size === names.length
    && node.entries.every((entry) => expected.has(entry.key.value));
}

function productionJsonObjectKeyOrderMatches(node, names) {
  return node?.type === "object"
    && node.entries.length === names.length
    && node.entries.every((entry, index) => entry.key.value === names[index]);
}

function productionJsonStringIs(node, value) {
  return node?.type === "string" && node.value === value;
}

function productionFlightResourceReference(value, kind, buildIds) {
  if (typeof value !== "string" || !value.startsWith("/_next/static/")) return null;
  const canonical = canonicalizeProductionResourceEnvelopeShape(value, buildIds);
  if (canonical === null) return null;
  const pattern = kind === "script"
    ? /^\/_next\/static\/chunks\/[A-Za-z0-9._-]+\.js$/
    : kind === "style"
      ? /^\/_next\/static\/chunks\/[A-Za-z0-9._-]+\.css$/
      : /^\/_next\/static\/media\/[A-Za-z0-9._-]+\.woff2$/;
  return pattern.test(canonical) ? canonical : null;
}

export function canonicalizeProductionFlightResourceEnvelopeStream(
  value, buildIds, resourceUrls = null, canonicalDocumentUrl = null,
  normalizeHomeSpotlight = false,
) {
  if (typeof value !== "string" || value.length > PRODUCTION_CHECK_LIMITS.htmlBytes) return null;
  if (resourceUrls !== null && !Array.isArray(resourceUrls)) return null;
  if (typeof normalizeHomeSpotlight !== "boolean") return null;
  const replacements = [];
  const frames = [];
  const flightReferenceOccurrences = [];
  const spotlightAnchors = [];
  const regularRecordIds = new Set();
  const openDeferredRecordIds = new Set();
  const closedDeferredRecordIds = new Set();
  const deferredReturnRecordIds = new Set();
  let rootSeen = false;

  function productionFlightReferenceTarget(value) {
    if (typeof value !== "string" || value[0] !== "$" || value === "$" || value[1] === "$") {
      return null;
    }
    const code = value[1];
    if (["S", "T", "Z", "I", "-", "N", "u", "D", "n"].includes(code)) return null;
    const reference = ["L", "@", "h", "Q", "W", "B", "K", "i"].includes(code)
      ? value.slice(2) : value.slice(1);
    const referenceId = ["h", "Q", "W", "B", "K", "i"].includes(code)
      ? reference.split(":", 1)[0] : reference;
    const target = Number.parseInt(referenceId, 16);
    return Number.isInteger(target) && target >= 0 && target <= 0x7fffffff ? target : null;
  }

  function recordFlightReference(node, recordId) {
    if (!normalizeHomeSpotlight || node?.type !== "string") return;
    const target = productionFlightReferenceTarget(node.value);
    if (target === null) return;
    flightReferenceOccurrences.push(Object.freeze({
      recordId,
      target,
      value: node.value,
    }));
  }

  function collectFlightReferences(node, recordId) {
    if (!normalizeHomeSpotlight || node === null || typeof node !== "object") return;
    if (node.type === "array") {
      for (const item of node.items) collectFlightReferences(item, recordId);
      return;
    }
    if (node.type === "object") {
      for (const entry of node.entries) collectFlightReferences(entry.value, recordId);
      return;
    }
    recordFlightReference(node, recordId);
  }

  function decodeRecordId(recordId) {
    const canonical = /^(?:0|[1-9a-f][0-9a-f]{0,6}|[1-7][0-9a-f]{7})$/.test(recordId);
    if (!canonical) return null;
    const decoded = Number.parseInt(recordId, 16);
    return Number.isSafeInteger(decoded) && decoded >= 0 && decoded <= 0x7fffffff
      ? decoded : null;
  }

  function claimRegularRecordId(decoded) {
    if (decoded === null
      || regularRecordIds.has(decoded)
      || openDeferredRecordIds.has(decoded)
      || closedDeferredRecordIds.has(decoded)) return false;
    regularRecordIds.add(decoded);
    return true;
  }

  function openDeferredRecordId(decoded) {
    if (decoded === null
      || decoded === 0
      || regularRecordIds.has(decoded)
      || openDeferredRecordIds.has(decoded)
      || closedDeferredRecordIds.has(decoded)) return false;
    openDeferredRecordIds.add(decoded);
    return true;
  }

  function closeDeferredRecordId(decoded) {
    if (decoded === null || decoded === 0 || !openDeferredRecordIds.has(decoded)) return false;
    openDeferredRecordIds.delete(decoded);
    closedDeferredRecordIds.add(decoded);
    return true;
  }

  function claimValueRecordId(decoded) {
    return openDeferredRecordIds.has(decoded) || claimRegularRecordId(decoded);
  }

  function deferredReturnReferenceIsValid(payload, deferredRecordId) {
    if (payload === "C") return true;
    const record = parseProductionJsonWithSpans(payload.slice(1));
    if (record?.type !== "string"
      || !/^\$(?:[1-9a-f][0-9a-f]{0,6}|[1-7][0-9a-f]{7})$/.test(record.value)) return false;
    const referencedRecordId = decodeRecordId(record.value.slice(1));
    if (referencedRecordId === null || referencedRecordId === deferredRecordId) return false;
    deferredReturnRecordIds.add(referencedRecordId);
    recordFlightReference(record, deferredRecordId.toString(16));
    return true;
  }

  function replaceResource(node, kind, sourceOffset) {
    if (node?.type !== "string") return false;
    const canonical = productionFlightResourceReference(node.value, kind, buildIds);
    if (canonical === null) return false;
    if (resourceUrls !== null) {
      if (resourceUrls.length >= PRODUCTION_HTML_TAG_LIMIT * 8) return false;
      resourceUrls.push(node.value);
    }
    replacements.push(Object.freeze({
      end: sourceOffset + node.end,
      start: sourceOffset + node.start,
      value: JSON.stringify(canonical),
    }));
    return true;
  }

  function collectResourceUrl(node) {
    if (node?.type !== "string"
      || node.value.length === 0
      || node.value.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters
      || !/^\/assets(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+\.webp$/.test(node.value)) {
      return false;
    }
    if (canonicalDocumentUrl === null) return true;
    if (!(canonicalDocumentUrl instanceof URL)) return false;
    let candidate;
    try {
      candidate = new URL(node.value, canonicalDocumentUrl);
    } catch {
      return false;
    }
    if (!["http:", "https:"].includes(candidate.protocol)
      || candidate.origin !== canonicalDocumentUrl.origin
      || candidate.username
      || candidate.password
      || candidate.search
      || candidate.hash
      || candidate.pathname !== node.value
      || candidate.href.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters) {
      return false;
    }
    if (resourceUrls !== null) {
      if (resourceUrls.length >= PRODUCTION_HTML_TAG_LIMIT * 8) return false;
      resourceUrls.push(node.value);
    }
    return true;
  }

  function pushReactResourceUrl(value) {
    if (resourceUrls === null) return true;
    if (resourceUrls.length >= PRODUCTION_HTML_TAG_LIMIT * 8) return false;
    resourceUrls.push(value);
    return true;
  }

  function productionFlightReactKeyIsSafe(node) {
    return node?.type === "null"
      || (node?.type === "string"
        && node.value.length <= 1024
        && !/[\\\u0000-\u001f\u007f]/.test(node.value));
  }

  function productionFlightReactPropertiesAreUnambiguous(node) {
    if (node?.type !== "object") return false;
    const names = new Set();
    for (const entry of node.entries) {
      const name = entry.key.value;
      if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(name) || names.has(name)) return false;
      names.add(name);
    }
    return true;
  }

  function productionFlightBoundedString(node, limit = 256) {
    return node?.type === "string"
      && node.value.length <= limit
      && !/[\\\u0000-\u001f\u007f]/.test(node.value);
  }

  function productionFlightImageDimensionIsSafe(node) {
    const value = node?.type === "number"
      ? node.value
      : node?.type === "string" && /^[1-9][0-9]{0,3}$/.test(node.value)
        ? Number(node.value) : NaN;
    return Number.isSafeInteger(value) && value > 0 && value <= PRODUCTION_IMAGE_DIMENSION_LIMIT;
  }

  function productionFlightImageUrl(node, sourceOffset, { allowStaticMedia = true } = {}) {
    if (node?.type !== "string"
      || node.value.length === 0
      || node.value.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters
      || /[\\\u0000-\u001f\u007f]/.test(node.value)) return false;
    let canonical = node.value;
    if (/^\/assets(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+\.webp$/.test(node.value)) {
      // Exact public asset surface.
    } else if (allowStaticMedia
      && /^\/_next\/static\/(?:[A-Za-z0-9_-]{1,64}\/)?media\/[A-Za-z0-9._-]+\.webp$/.test(node.value)) {
      canonical = canonicalizeProductionResourceEnvelopeShape(node.value, buildIds);
      if (canonical === null
        || !/^\/_next\/static\/media\/[A-Za-z0-9._-]+\.webp$/.test(canonical)) return false;
    } else {
      const optimized = /^\/_next\/image\?url=(%2Fassets(?:%2F[A-Za-z0-9_-][A-Za-z0-9._-]*)+\.webp)&w=([1-9][0-9]{0,3})&q=75$/.exec(
        node.value,
      );
      if (!optimized || !PRODUCTION_NEXT_IMAGE_WIDTHS.has(Number(optimized[2]))) return false;
    }
    if (canonicalDocumentUrl !== null) {
      if (!(canonicalDocumentUrl instanceof URL)) return false;
      let candidate;
      try {
        candidate = new URL(node.value, canonicalDocumentUrl);
      } catch {
        return false;
      }
      if (candidate.origin !== canonicalDocumentUrl.origin
        || candidate.username
        || candidate.password
        || candidate.hash
        || candidate.href.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters) return false;
    }
    if (!pushReactResourceUrl(node.value)) return false;
    if (canonical !== node.value) {
      replacements.push(Object.freeze({
        end: sourceOffset + node.end,
        start: sourceOffset + node.start,
        value: JSON.stringify(canonical),
      }));
    }
    return true;
  }

  function productionFlightImageSrcset(node) {
    if (node === null) return true;
    if (node?.type !== "string") return false;
    const urls = productionNamespaceSrcsetUrls(node.value);
    if (urls === null) return false;
    for (const value of urls) {
      const candidate = Object.freeze({ end: 0, start: 0, type: "string", value });
      if (!productionFlightImageUrl(candidate, 0, { allowStaticMedia: false })) return false;
    }
    return true;
  }

  function productionFlightAnchorHrefIsSafe(node) {
    if (node?.type !== "string"
      || node.value.length === 0
      || node.value.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters
      || /[&\\\u0000-\u001f\u007f]/.test(node.value)) return false;
    if (isSafeRoutePath(node.value)) {
      const routeTarget = new URL(node.value, "https://anchor.invalid");
      return routeTarget.pathname === node.value
        && !routeTarget.search
        && !routeTarget.hash
        && pushReactResourceUrl(node.value);
    }
    if (node.value === "mailto:support@mochirii.com"
      || node.value === "mailto:support@mochirii.com?subject=M%C5%8Dchir%C4%AB%C4%AB%20data%20deletion%20request") {
      return pushReactResourceUrl(node.value);
    }
    if (!/^https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~!$'()*+,;=:@%\/-]*)?\/?$/.test(node.value)) {
      return false;
    }
    try {
      const target = new URL(node.value);
      return target.protocol === "https:"
        && !target.username
        && !target.password
        && (target.href === node.value || (target.href === node.value + "/" && node.value === target.origin))
        && pushReactResourceUrl(node.value);
    } catch {
      return false;
    }
  }

  function productionFlightMetadataLinkIsSafe(properties) {
    if (!productionJsonObjectKeysMatch(properties, ["href", "rel"])) return false;
    const href = productionJsonObjectEntry(properties, "href")?.value;
    const rel = productionJsonObjectEntry(properties, "rel")?.value;
    if (href?.type !== "string" || rel?.type !== "string") return false;
    if (rel.value === "icon" || rel.value === "apple-touch-icon") {
      const expected = rel.value === "icon"
        ? "/favicon.ico" : "/assets/img/brand/apple-touch-icon.png";
      return href.value === expected && pushReactResourceUrl(href.value);
    }
    if (rel.value !== "canonical"
      || !/^https:\/\/mochirii\.com(?:\/[a-z0-9-]+)*$/.test(href.value)) return false;
    try {
      const target = new URL(href.value);
      return (!canonicalDocumentUrl || target.pathname === canonicalDocumentUrl.pathname)
        && !target.search
        && !target.hash
        && pushReactResourceUrl(href.value);
    } catch {
      return false;
    }
  }

  function productionFlightStructuredDataIsSafe(properties) {
    if (!(productionJsonObjectKeysMatch(properties, ["dangerouslySetInnerHTML", "type"])
        || productionJsonObjectKeysMatch(properties, ["dangerouslySetInnerHTML", "id", "type"]))
      || !productionJsonStringIs(
        productionJsonObjectEntry(properties, "type")?.value, "application/ld+json",
      )) return false;
    const inner = productionJsonObjectEntry(properties, "dangerouslySetInnerHTML")?.value;
    if (!productionJsonObjectKeysMatch(inner, ["__html"])) return false;
    const html = productionJsonObjectEntry(inner, "__html")?.value;
    if (html?.type !== "string" || html.value.length > PRODUCTION_CHECK_LIMITS.htmlBytes) return false;
    const id = productionJsonObjectEntry(properties, "id")?.value;
    if (id !== undefined && (!productionFlightBoundedString(id, 64)
      || !/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(id.value))) return false;
    try {
      const structuredData = JSON.parse(html.value);
      return structuredData !== null && typeof structuredData === "object" && !Array.isArray(structuredData);
    } catch {
      return false;
    }
  }

  function productionFlightStringPropertyIs(properties, name, value) {
    return productionJsonStringIs(productionJsonObjectEntry(properties, name)?.value, value);
  }

  function productionFlightHomeSpotlightAncestryIsExact(ancestry) {
    if (!Array.isArray(ancestry) || ancestry.length < 4) return false;
    const [section, card, plate, title] = ancestry.slice(-4);
    const cardLabel = productionJsonObjectEntry(card.properties, "aria-label")?.value;
    return section.name === "section"
      && productionJsonObjectKeyOrderMatches(
        section.properties, ["className", "aria-label", "children"],
      )
      && productionFlightStringPropertyIs(
        section.properties, "className", "glass-card glass-card--primary glass-pad u-mt-24",
      )
      && productionFlightStringPropertyIs(section.properties, "aria-label", "Member spotlight")
      && card.name === "div"
      && productionJsonObjectKeyOrderMatches(
        card.properties, ["id", "className", "role", "aria-label", "children"],
      )
      && productionFlightStringPropertyIs(card.properties, "id", "spotlightCard")
      && productionFlightStringPropertyIs(card.properties, "className", "home-spotlight")
      && productionFlightStringPropertyIs(card.properties, "role", "group")
      && productionFlightBoundedString(cardLabel, 256)
      && cardLabel.value.startsWith("Member spotlight - ")
      && plate.name === "div"
      && productionJsonObjectKeyOrderMatches(plate.properties, ["className", "children"])
      && productionFlightStringPropertyIs(
        plate.properties, "className", "home-spotlight__plate",
      )
      && title.name === "h3"
      && productionJsonObjectKeyOrderMatches(title.properties, ["id", "className", "children"])
      && productionFlightStringPropertyIs(title.properties, "id", "spotlightTitle")
      && productionFlightStringPropertyIs(title.properties, "className", "home-title");
  }

  function collectReactResources(node, sourceOffset, recordId, ancestry = []) {
    if (node?.type === "array") {
      const [marker, element, key, properties] = node.items;
      const reactElementMarker = productionJsonStringIs(marker, "$") && element?.type === "string";
      let intrinsicName = null;
      let descendantAncestry = ancestry;
      if (reactElementMarker && !element.value.startsWith("$")) {
        if (!/^[a-z][a-z0-9-]*$/.test(element.value)) return false;
        intrinsicName = element.value;
      }
      if (intrinsicName !== null) {
        if (node.items.length !== 4
          || !productionFlightReactKeyIsSafe(key)
          || !productionFlightReactPropertiesAreUnambiguous(properties)
          || PRODUCTION_REJECTED_ELEMENTS.has(intrinsicName)
          || PRODUCTION_NAMESPACE_REJECTED_CONTEXT_ELEMENTS.has(intrinsicName)
          || PRODUCTION_AMBIGUOUS_TREE_ELEMENTS.has(intrinsicName)
          || intrinsicName === "base") return false;
        descendantAncestry = [...ancestry, Object.freeze({
          name: intrinsicName,
          properties,
        })];
        if (intrinsicName === "h3"
          && productionFlightHomeSpotlightAncestryIsExact(descendantAncestry)) {
          const children = productionJsonObjectEntry(properties, "children")?.value;
          if (children?.type === "string") {
            spotlightAnchors.push(Object.freeze({
              recordId,
              reference: children.value,
            }));
          }
        }
        const propertyNames = properties.entries.map((entry) => entry.key.value);
        if (propertyNames.some((name) => /^on[A-Za-z]/.test(name))) return false;

        if (intrinsicName === "link") {
          const resourceEntry = productionJsonObjectEntry(properties, "href");
          if (resourceEntry === null) return false;
        const exactLink = node.items.length === 4
          && productionJsonObjectKeysMatch(
            properties, ["rel", "href", "precedence", "crossOrigin", "nonce"],
          )
          && productionJsonStringIs(
            productionJsonObjectEntry(properties, "rel")?.value, "stylesheet",
          )
          && productionJsonStringIs(
            productionJsonObjectEntry(properties, "precedence")?.value, "next",
          )
          && productionJsonStringIs(
            productionJsonObjectEntry(properties, "crossOrigin")?.value, "$undefined",
          )
          && productionJsonStringIs(
            productionJsonObjectEntry(properties, "nonce")?.value, "$undefined",
          );
          if (exactLink) return replaceResource(resourceEntry.value, "style", sourceOffset);
          return productionFlightMetadataLinkIsSafe(properties);
        }

        if (intrinsicName === "script") {
          const source = productionJsonObjectEntry(properties, "src");
          if (source !== null) {
            const exactScript = productionJsonObjectKeysMatch(properties, ["src", "async", "nonce"])
              && productionJsonObjectEntry(properties, "async")?.value.type === "boolean"
              && productionJsonObjectEntry(properties, "async")?.value.value === true
              && productionJsonStringIs(
                productionJsonObjectEntry(properties, "nonce")?.value, "$undefined",
              );
            return exactScript && replaceResource(source.value, "script", sourceOffset);
          }
          return productionFlightStructuredDataIsSafe(properties);
        }

        if (intrinsicName === "img") {
          if (propertyNames.some((name) => !PRODUCTION_FLIGHT_IMAGE_PROPERTY_NAMES.has(name))) return false;
          const source = productionJsonObjectEntry(properties, "src")?.value;
          const alternate = productionJsonObjectEntry(properties, "alt")?.value;
          const sourceSet = productionJsonObjectEntry(properties, "srcSet")?.value ?? null;
          const ariaHidden = productionJsonObjectEntry(properties, "aria-hidden")?.value;
          const decoding = productionJsonObjectEntry(properties, "decoding")?.value;
          const loading = productionJsonObjectEntry(properties, "loading")?.value;
          const priority = productionJsonObjectEntry(properties, "fetchPriority")?.value;
          const width = productionJsonObjectEntry(properties, "width")?.value;
          const height = productionJsonObjectEntry(properties, "height")?.value;
          if (!productionFlightBoundedString(alternate, 512)
            || (ariaHidden !== undefined
              && !(ariaHidden?.type === "boolean" && ariaHidden.value === true)
              && !productionJsonStringIs(ariaHidden, "true"))
            || (decoding !== undefined && !productionJsonStringIs(decoding, "async"))
            || (loading !== undefined
              && !(productionJsonStringIs(loading, "eager") || productionJsonStringIs(loading, "lazy")))
            || (priority !== undefined
              && !(productionJsonStringIs(priority, "high")
                || productionJsonStringIs(priority, "low")
                || productionJsonStringIs(priority, "auto")))
            || (width !== undefined && !productionFlightImageDimensionIsSafe(width))
            || (height !== undefined && !productionFlightImageDimensionIsSafe(height))
            || ["className", "id", "sizes"].some((name) => {
              const entry = productionJsonObjectEntry(properties, name)?.value;
              return entry !== undefined && !productionFlightBoundedString(entry, 256);
            })
            || !productionFlightImageUrl(source, sourceOffset)
            || !productionFlightImageSrcset(sourceSet)) return false;
          return true;
        }

        if (intrinsicName === "a") {
          if (propertyNames.some((name) => !PRODUCTION_FLIGHT_ANCHOR_PROPERTY_NAMES.has(name))) return false;
          const href = productionJsonObjectEntry(properties, "href")?.value;
          const ariaLabel = productionJsonObjectEntry(properties, "aria-label")?.value;
          const target = productionJsonObjectEntry(properties, "target")?.value;
          const rel = productionJsonObjectEntry(properties, "rel")?.value;
          const targetUndefined = target === undefined || productionJsonStringIs(target, "$undefined");
          const relUndefined = rel === undefined || productionJsonStringIs(rel, "$undefined");
          if (!productionFlightAnchorHrefIsSafe(href)
            || (ariaLabel !== undefined
              && (!productionFlightBoundedString(ariaLabel, 256)
                || ariaLabel.value.length === 0))
            || ["className", "id"].some((name) => {
              const entry = productionJsonObjectEntry(properties, name)?.value;
              return entry !== undefined && !productionFlightBoundedString(entry, 256);
            })
            || (!targetUndefined
              && (!productionJsonStringIs(target, "_blank")
                || !productionJsonStringIs(rel, "noopener noreferrer")))
            || (targetUndefined && !relUndefined)) return false;
        } else if (propertyNames.some((name) =>
          PRODUCTION_FLIGHT_ACTIVE_PROPERTY_NAMES.has(asciiLower(name)))) {
          return false;
        }
      }
      return node.items.every((item, index) => collectReactResources(
        item,
        sourceOffset,
        recordId,
        index === 3 ? descendantAncestry : ancestry,
      ));
    }
    if (node?.type === "object") {
      return node.entries.every((entry) => collectReactResources(
        entry.value, sourceOffset, recordId, ancestry,
      ));
    }
    return true;
  }

  function readFrame(source, start) {
    const colon = source.indexOf(":", start);
    const priorLineFeed = source.indexOf("\n", start);
    if (colon < 0 || (priorLineFeed >= 0 && priorLineFeed < colon)) return null;
    const recordId = source.slice(start, colon);
    const payloadOffset = colon + 1;
    if (source[payloadOffset] !== "T") {
      const lineEnd = source.indexOf("\n", payloadOffset);
      return lineEnd < 0 ? null : Object.freeze({
        end: lineEnd + 1,
        kind: "line",
        payload: source.slice(payloadOffset, lineEnd),
        payloadOffset,
        recordId,
      });
    }

    const comma = source.indexOf(",", payloadOffset + 1);
    const headerLineFeed = source.indexOf("\n", payloadOffset + 1);
    if (comma < 0 || (headerLineFeed >= 0 && headerLineFeed < comma)) return null;
    const byteLengthText = source.slice(payloadOffset + 1, comma);
    if (!/^(?:0|[1-9a-f][0-9a-f]{0,7})$/.test(byteLengthText)) return null;
    const byteLength = Number.parseInt(byteLengthText, 16);
    if (!Number.isSafeInteger(byteLength)
      || byteLength < 0
      || byteLength > PRODUCTION_CHECK_LIMITS.htmlBytes) return null;
    let bytesRead = 0;
    let textEnd = comma + 1;
    while (bytesRead < byteLength && textEnd < source.length) {
      const first = source.charCodeAt(textEnd);
      let codeUnits = 1;
      let utf8Bytes;
      if (first <= 0x7f) {
        utf8Bytes = 1;
      } else if (first <= 0x7ff) {
        utf8Bytes = 2;
      } else if (first >= 0xd800 && first <= 0xdbff
        && textEnd + 1 < source.length
        && source.charCodeAt(textEnd + 1) >= 0xdc00
        && source.charCodeAt(textEnd + 1) <= 0xdfff) {
        codeUnits = 2;
        utf8Bytes = 4;
      } else {
        utf8Bytes = 3;
      }
      if (bytesRead > byteLength - utf8Bytes) return null;
      bytesRead += utf8Bytes;
      textEnd += codeUnits;
    }
    return bytesRead === byteLength ? Object.freeze({
      end: textEnd,
      kind: "text",
      payload: source.slice(payloadOffset, textEnd),
      payloadOffset,
      recordId,
    }) : null;
  }

  function flightReferenceIsExact(value, recordId) {
    const matches = flightReferenceOccurrences.filter((entry) => entry.value === value);
    return matches.length === 1 && matches[0].recordId === recordId;
  }

  function flightTargetIsReferencedOnce(recordId) {
    const decoded = decodeRecordId(recordId);
    return decoded !== null
      && flightReferenceOccurrences.filter((entry) => entry.target === decoded).length === 1;
  }

  function productionFlightStringIsWellFormed(value) {
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        if (index + 1 >= value.length) return false;
        const trailing = value.charCodeAt(index + 1);
        if (trailing < 0xdc00 || trailing > 0xdfff) return false;
        index += 1;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        return false;
      }
    }
    return true;
  }

  function productionFlightHomeSpotlightNameIsSafe(name) {
    return typeof name === "string"
      && name.length >= 1
      && name.length <= 120
      && name === name.trim()
      && !name.includes("  ")
      && !/[^\S ]/.test(name)
      && !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(name)
      && productionFlightStringIsWellFormed(name);
  }

  function prepareHomeSpotlightNormalization() {
    const currentRetainedOrder = Object.freeze(["20", "1e"]);
    if (spotlightAnchors.length === 1
      && spotlightAnchors[0].recordId === "1c"
      && spotlightAnchors[0].reference === "$L1e") {
      const exactReferences = [
        ["$L8", "0"],
        ["$L15", "8"],
        ["$L1c", "15"],
        ["$L1d", "15"],
        ["$L1e", "1c"],
        ["$L1f", "1d"],
        ["$L20", "1d"],
      ];
      if (exactReferences.some(([reference, source]) => !flightReferenceIsExact(reference, source))
        || ["8", "15", "1c", "1d", "1e", "1f", "20"].some(
          (recordId) => !flightTargetIsReferencedOnce(recordId),
        )) return null;

      const frameById = new Map(frames.map((frame) => [frame.recordId, frame]));
      const requiredRegularIds = ["0", "8", "15", "1c", "1d", "1e", "20"];
      if (requiredRegularIds.some((recordId) => frameById.get(recordId)?.role !== "regular")) {
        return null;
      }
      const galleryImportFrame = frameById.get("1f");
      if (galleryImportFrame?.role !== "import"
        || galleryImportFrame.record?.type !== "array"
        || galleryImportFrame.record.items.length !== 3
        || galleryImportFrame.record.items[1]?.type !== "array"
        || galleryImportFrame.record.items[1].items.length !== 3
        || !productionJsonStringIs(
          galleryImportFrame.record.items[2], "HomeGallerySpotlight",
        )) return null;

      const galleryCtaFrame = frameById.get("20");
      const galleryCtaProperties = galleryCtaFrame?.record?.items?.[3];
      if (galleryCtaFrame.record?.type !== "array"
        || galleryCtaFrame.record.items.length !== 4
        || !productionJsonStringIs(galleryCtaFrame.record.items[0], "$")
        || !productionJsonStringIs(galleryCtaFrame.record.items[1], "$L7")
        || galleryCtaFrame.record.items[2]?.type !== "null"
        || !productionJsonObjectKeyOrderMatches(
          galleryCtaProperties, ["className", "href", "children"],
        )
        || !productionFlightStringPropertyIs(
          galleryCtaProperties, "className", "hero-cta home-section-cta",
        )
        || !productionFlightStringPropertyIs(galleryCtaProperties, "href", "/gallery")
        || !productionFlightStringPropertyIs(
          galleryCtaProperties, "children", "View Guild Gallery",
        )) return null;

      const terminalFrames = frames.slice(-currentRetainedOrder.length);
      if (terminalFrames.length !== currentRetainedOrder.length
        || new Set(terminalFrames.map((frame) => frame.recordId)).size
          !== currentRetainedOrder.length
        || currentRetainedOrder.some(
          (recordId) => !terminalFrames.some((frame) => frame.recordId === recordId),
        )
        || frames.findIndex((frame) => frame.recordId === "1f")
          >= frames.findIndex((frame) => frame.recordId === "1d")
        || frames.findIndex((frame) => frame.recordId === "1d")
          >= frames.findIndex((frame) => frame.recordId === terminalFrames[0].recordId)) {
        return null;
      }

      const titleFrame = frameById.get("1e");
      const title = titleFrame.record?.type === "string" ? titleFrame.record.value : null;
      const fallbackTitle = "Member Spotlight";
      if (typeof title !== "string"
        || titleFrame.payload !== JSON.stringify(title)
        || (title !== fallbackTitle && !productionFlightHomeSpotlightNameIsSafe(title))) return null;
      replacements.push(Object.freeze({
        end: titleFrame.payloadOffset + titleFrame.record.end,
        start: titleFrame.payloadOffset + titleFrame.record.start,
        value: JSON.stringify(fallbackTitle),
      }));
      return Object.freeze({
        retainedOrder: currentRetainedOrder,
        suffixStart: terminalFrames[0].start,
      });
    }

    const retainedOrder = Object.freeze(["26", "24", "21", "1f", "23"]);
    if (spotlightAnchors.length !== 1
      || spotlightAnchors[0].recordId !== "1b"
      || spotlightAnchors[0].reference !== "$L24") return null;

    const exactReferences = [
      ["$Ld", "0"],
      ["$L12", "0"],
      ["$L13", "0"],
      ["$L1b", "d"],
      ["$L24", "1b"],
      ["$@1f", "12"],
      ["$L21", "13"],
      ["$L23", "13"],
      ["$L26", "23"],
    ];
    if (exactReferences.some(([reference, source]) => !flightReferenceIsExact(reference, source))
      || ["d", "12", "13", "1b", "24", "1f", "21", "23", "26"].some(
        (recordId) => !flightTargetIsReferencedOnce(recordId),
      )) return null;

    const frameById = new Map(frames.map((frame) => [frame.recordId, frame]));
    const requiredRegularIds = ["0", "d", "12", "13", "1b", "24", "21", "1f", "23"];
    if (requiredRegularIds.some((recordId) => frameById.get(recordId)?.role !== "regular")) {
      return null;
    }
    const importFrame = frameById.get("26");
    if (importFrame?.role !== "import"
      || importFrame.record?.type !== "array"
      || importFrame.record.items.length !== 3
      || !productionJsonStringIs(importFrame.record.items[2], "IconMark")) return null;

    const viewportFrame = frameById.get("21");
    const metadataOutletFrame = frameById.get("1f");
    const metadataFrame = frameById.get("23");
    if (viewportFrame.record?.type !== "array"
      || viewportFrame.record.items.length !== 3
      || metadataOutletFrame.record?.type !== "null"
      || metadataFrame.record?.type !== "array"
      || metadataFrame.record.items.length !== 20) return null;
    const iconElement = metadataFrame.record.items.at(-1);
    if (iconElement?.type !== "array"
      || iconElement.items.length !== 4
      || !productionJsonStringIs(iconElement.items[0], "$")
      || !productionJsonStringIs(iconElement.items[1], "$L26")
      || !productionJsonStringIs(iconElement.items[2], "19")
      || !productionJsonObjectKeyOrderMatches(iconElement.items[3], [])) return null;

    const terminalFrames = frames.slice(-retainedOrder.length);
    if (terminalFrames.length !== retainedOrder.length
      || new Set(terminalFrames.map((frame) => frame.recordId)).size !== retainedOrder.length
      || retainedOrder.some((recordId) => !terminalFrames.some((frame) => frame.recordId === recordId))
      || terminalFrames.findIndex((frame) => frame.recordId === "26")
        >= terminalFrames.findIndex((frame) => frame.recordId === "23")) {
      return null;
    }

    const titleFrame = frameById.get("24");
    const title = titleFrame.record?.type === "string" ? titleFrame.record.value : null;
    const fallbackTitle = "Member Spotlight";
    if (typeof title !== "string" || titleFrame.payload !== JSON.stringify(title)) return null;
    if (title !== fallbackTitle && !productionFlightHomeSpotlightNameIsSafe(title)) return null;
    replacements.push(Object.freeze({
      end: titleFrame.payloadOffset + titleFrame.record.end,
      start: titleFrame.payloadOffset + titleFrame.record.start,
      value: JSON.stringify(fallbackTitle),
    }));
    return Object.freeze({
      retainedOrder,
      suffixStart: terminalFrames[0].start,
    });
  }

  let sourceOffset = 0;
  let frameCount = 0;
  while (sourceOffset < value.length) {
    if (++frameCount > PRODUCTION_CHECK_LIMITS.htmlBytes) return null;
    const frame = readFrame(value, sourceOffset);
    if (frame === null || frame.end <= sourceOffset) return null;
    const { payload, payloadOffset, recordId } = frame;
    const hint = payload.startsWith("HL");
    const decodedRecordId = hint ? null : decodeRecordId(recordId);
    let frameRecord = null;
    let frameRole = "";
    if ((hint && recordId !== "") || (!hint && decodedRecordId === null)) return null;
    if (frame.kind === "text") {
      if (!claimValueRecordId(decodedRecordId)) return null;
      frameRole = "text";
    } else if (payload.startsWith("I")) {
      if (decodedRecordId === 0 || !claimRegularRecordId(decodedRecordId)) return null;
      const record = parseProductionJsonWithSpans(payload.slice(1));
      frameRecord = record;
      frameRole = "import";
      const recordOffset = payloadOffset + 1;
      if (record?.type !== "array"
        || ![3, 4].includes(record.items.length)
        || record.items[0]?.type !== "number"
        || !Number.isSafeInteger(record.items[0].value)
        || record.items[0].value < 0
        || record.items[1]?.type !== "array"
        || record.items[1].items.length < 1
        || record.items[2]?.type !== "string"
        || (record.items.length === 4
          && (record.items[3]?.type !== "number" || record.items[3].value !== 1))
        || !record.items[1].items.every((item) =>
          replaceResource(item, "script", recordOffset))) return null;
      collectFlightReferences(record, recordId);
    } else if (payload.startsWith("HL")) {
      const record = parseProductionJsonWithSpans(payload.slice(2));
      frameRecord = record;
      frameRole = "hint";
      const recordOffset = payloadOffset + 2;
      const style = record?.type === "array"
        && record.items.length === 2
        && productionJsonStringIs(record.items[1], "style");
      const font = record?.type === "array"
        && record.items.length === 3
        && productionJsonStringIs(record.items[1], "font")
        && productionJsonObjectKeysMatch(record.items[2], ["crossOrigin", "type"])
        && productionJsonStringIs(
          productionJsonObjectEntry(record.items[2], "crossOrigin")?.value, "",
        )
        && productionJsonStringIs(
          productionJsonObjectEntry(record.items[2], "type")?.value, "font/woff2",
        );
      const image = record?.type === "array"
        && record.items.length === 2
        && productionJsonStringIs(record.items[1], "image");
      if (!style && !font && !image) return null;
      if (image) {
        if (!collectResourceUrl(record.items[0])) return null;
      } else if (!replaceResource(record.items[0], style ? "style" : "font", recordOffset)) {
        return null;
      }
      collectFlightReferences(record, recordId);
    } else if (payload === "X" || payload === "x") {
      if (!openDeferredRecordId(decodedRecordId)) return null;
      frameRole = "deferred-open";
    } else if (payload.startsWith("C")) {
      if (!deferredReturnReferenceIsValid(payload, decodedRecordId)) return null;
      if (!closeDeferredRecordId(decodedRecordId)) return null;
      frameRole = "deferred-close";
    } else {
      if (!claimValueRecordId(decodedRecordId)) return null;
      const record = parseProductionJsonWithSpans(payload);
      if (record === null) return null;
      frameRecord = record;
      frameRole = "regular";
      collectFlightReferences(record, recordId);
      if (decodedRecordId === 0) {
        if (rootSeen
          || !productionJsonObjectKeyOrderMatches(record, PRODUCTION_FLIGHT_ROOT_KEYS)) return null;
        let root;
        try {
          root = JSON.parse(payload);
        } catch {
          return null;
        }
        if (root.P !== null
          || !Array.isArray(root.c)
          || typeof root.q !== "string"
          || typeof root.i !== "boolean"
          || !Array.isArray(root.f)
          || typeof root.m !== "string"
          || !Array.isArray(root.G)
          || typeof root.S !== "boolean"
          || root.h !== null
          || !["r", "s", "a", "l", "p", "d", "b"].every(
            (keyName) => typeof root[keyName] === "string",
          )
          || !/^[A-Za-z0-9_-]{21}$/.test(root.b)) return null;
        const buildId = productionJsonObjectEntry(record, "b")?.value;
        replacements.push(Object.freeze({
          end: payloadOffset + buildId.end,
          start: payloadOffset + buildId.start,
          value: '"__NEXT_BUILD_ID__"',
        }));
        for (const keyName of ["f", "G"]) {
          if (!collectReactResources(
            productionJsonObjectEntry(record, keyName)?.value, payloadOffset, recordId,
          )) return null;
        }
        rootSeen = true;
      } else if (!collectReactResources(record, payloadOffset, recordId)) {
        return null;
      }
    }
    frames.push(Object.freeze({
      decodedRecordId,
      end: frame.end,
      payload,
      payloadOffset,
      record: frameRecord,
      recordId,
      role: frameRole,
      start: sourceOffset,
    }));
    sourceOffset = frame.end;
  }
  if (!rootSeen
    || openDeferredRecordIds.size !== 0
    || [...deferredReturnRecordIds].some((recordId) =>
      !regularRecordIds.has(recordId) && !closedDeferredRecordIds.has(recordId))) return null;
  const homeSpotlightNormalization = normalizeHomeSpotlight
    ? prepareHomeSpotlightNormalization() : null;
  if (normalizeHomeSpotlight && homeSpotlightNormalization === null) return null;
  replacements.sort((left, right) => right.start - left.start);
  let canonical = value;
  let canonicalSuffixStart = homeSpotlightNormalization?.suffixStart ?? null;
  if (canonicalSuffixStart !== null) {
    for (const replacement of replacements) {
      if (replacement.start < canonicalSuffixStart && replacement.end > canonicalSuffixStart) return null;
      if (replacement.end <= canonicalSuffixStart) {
        canonicalSuffixStart += replacement.value.length - (replacement.end - replacement.start);
      }
    }
  }
  let priorStart = value.length;
  for (const replacement of replacements) {
    if (replacement.end > priorStart || replacement.start < 0 || replacement.end <= replacement.start) {
      return null;
    }
    canonical = canonical.slice(0, replacement.start)
      + replacement.value + canonical.slice(replacement.end);
    priorStart = replacement.start;
  }
  if (homeSpotlightNormalization !== null) {
    const canonicalFrames = new Map();
    let canonicalOffset = canonicalSuffixStart;
    while (canonicalOffset < canonical.length) {
      if (canonicalFrames.size >= homeSpotlightNormalization.retainedOrder.length) return null;
      const frame = readFrame(canonical, canonicalOffset);
      if (frame === null
        || frame.end <= canonicalOffset
        || canonicalFrames.has(frame.recordId)) return null;
      canonicalFrames.set(frame.recordId, canonical.slice(canonicalOffset, frame.end));
      canonicalOffset = frame.end;
    }
    if (canonicalOffset !== canonical.length
      || homeSpotlightNormalization.retainedOrder.some(
        (recordId) => !canonicalFrames.has(recordId),
      )) return null;
    canonical = canonical.slice(0, canonicalSuffixStart)
      + homeSpotlightNormalization.retainedOrder.map(
        (recordId) => canonicalFrames.get(recordId),
      ).join("");
  }
  return canonical;
}

function productionResourceEnvelopeRow(tag, text = "", context = "", buildIds = new Set()) {
  const parts = [context, tag.name];
  for (const name of [...tag.attributeNames].sort()) {
    const value = canonicalizeProductionResourceEnvelopeShape(
      tag.attributes.get(name) || "", buildIds,
    );
    if (value === null) return null;
    parts.push(`${name}=${value}`);
  }
  if (tag.name === "script") {
    const payloadText = productionScriptPayloadText(tag, text);
    if (payloadText === null) return null;
    if (payloadText !== undefined) {
      parts.push("text-kind=next-flight");
    } else {
      const canonicalText = canonicalizeProductionResourceEnvelopeShape(text, buildIds);
      if (canonicalText === null) return null;
      parts.push(`text-sha256=${createHash("sha256").update(canonicalText, "utf8").digest("hex").toUpperCase()}`);
    }
  }
  return parts.join("|");
}

function productionDocumentDigestMatches(expected, observed) {
  const values = Array.isArray(expected) ? expected : [expected];
  return values.length >= 1
    && values.length <= 2
    && new Set(values).size === values.length
    && values.every((value) => /^[A-F0-9]{64}$/.test(value))
    && values.includes(observed);
}

function productionDocumentPolicyVariants(documentPolicy) {
  const variants = Array.isArray(documentPolicy?.variants)
    ? documentPolicy.variants : [documentPolicy];
  return variants.length >= 1
    && variants.length <= 2
    && variants.every((variant) => variant !== null
      && typeof variant === "object"
      && !Array.isArray(variant)
      && Object.keys(variant).length === 2
      && Object.hasOwn(variant, "header")
      && Object.hasOwn(variant, "resources"))
    ? variants : [];
}

export function productionDocumentPolicyMatches(documentPolicy, headerSha256, resourcesSha256) {
  const variants = productionDocumentPolicyVariants(documentPolicy);
  return variants.length > 0 && variants.some((variant) =>
    productionDocumentDigestMatches(variant.header, headerSha256)
      && productionDocumentDigestMatches(variant.resources, resourcesSha256));
}

export function productionDocumentProfileMatches(profile, headerSha256, resourcesSha256) {
  return typeof profile === "string"
    && Object.hasOwn(PRODUCTION_DOCUMENT_POLICIES, profile)
    && productionDocumentPolicyMatches(
      PRODUCTION_DOCUMENT_POLICIES[profile], headerSha256, resourcesSha256,
    );
}

function productionFooterLegalLinkAncestryIsExact(elements) {
  if (elements.length !== 5) return false;
  const [footer, wrapper, bottom, legal, link] = elements;
  return footer.name === "footer"
    && productionTagHasExactAttributeNames(footer.tag, PRODUCTION_FOOTER_ATTRIBUTE_NAMES)
    && footer.tag.attributes.get("class") === "site-footer"
    && footer.tag.attributes.get("role") === "contentinfo"
    && wrapper.name === "div"
    && productionTagHasExactAttributeNames(wrapper.tag, PRODUCTION_FOOTER_WRAPPER_ATTRIBUTE_NAMES)
    && wrapper.tag.attributes.get("class") === "footer-wrap"
    && bottom.name === "div"
    && productionTagHasExactAttributeNames(bottom.tag, PRODUCTION_FOOTER_WRAPPER_ATTRIBUTE_NAMES)
    && bottom.tag.attributes.get("class") === "footer-bottom"
    && legal.name === "nav"
    && productionTagHasExactAttributeNames(legal.tag, PRODUCTION_FOOTER_LEGAL_ATTRIBUTE_NAMES)
    && legal.tag.attributes.get("class") === "footer-legal"
    && legal.tag.attributes.get("aria-label") === "Privacy and support"
    && link.name === "a";
}

function productionElementIsHidden(tag, parentHidden) {
  if (parentHidden
    || tag.attributes.has("hidden")
    || tag.attributes.has("inert")
    || tag.attributes.has("popover")) return true;
  const ariaHidden = tag.attributes.get("aria-hidden") || "";
  if (ariaHidden.includes("&") || asciiLower(trimHtmlSpace(ariaHidden)) === "true") return true;
  const ariaDisabled = tag.attributes.get("aria-disabled") || "";
  if (tag.name === "a"
    && (ariaDisabled.includes("&")
      || asciiLower(trimHtmlSpace(ariaDisabled)) === "true")) {
    return true;
  }
  if ((tag.name === "details" || tag.name === "dialog") && !tag.attributes.has("open")) return true;

  const className = tag.attributes.get("class") || "";
  const classTokens = asciiLower(trimHtmlSpace(className)).split(/[\t\n\f\r ]+/).filter(Boolean);
  if (tag.duplicates.has("class")
    || className.includes("&")
    || classTokens.some((token) => PRODUCTION_HIDDEN_CLASS_NAMES.has(token))) {
    return true;
  }

  const rawStyle = tag.attributes.get("style") || "";
  if (!rawStyle) return false;
  // Inline CSS can suppress, clip, transform, or move content through many
  // equivalent declarations. Treat every non-empty inline style as unproven
  // on the visibility path instead of maintaining a bypassable property list.
  return true;
}

function productionMetadataContent(value) {
  if (typeof value !== "string" || value.length > PRODUCTION_IMAGE_VALUE_LIMIT) return "";
  if (value.replaceAll("&amp;", "").includes("&")) return "";
  const decoded = value.replaceAll("&amp;", "&");
  return normalizeProductionElementText(decoded) === "" ? "" : decoded;
}

function findHtmlTagEnd(html, start) {
  let state = "before-name";
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (state === "quoted-value") {
      if (character === quote) {
        quote = "";
        state = "before-name";
      }
      continue;
    }
    if (character === ">") return index;
    if (state === "before-name") {
      if (isHtmlSpace(character) || character === "/") continue;
      state = "name";
      continue;
    }
    if (state === "name") {
      if (isHtmlSpace(character)) state = "after-name";
      else if (character === "/") state = "before-name";
      else if (character === "=") state = "before-value";
      continue;
    }
    if (state === "after-name") {
      if (isHtmlSpace(character)) continue;
      if (character === "/") state = "before-name";
      else if (character === "=") state = "before-value";
      else state = "name";
      continue;
    }
    if (state === "before-value") {
      if (isHtmlSpace(character)) continue;
      if (character === '"' || character === "'") {
        quote = character;
        state = "quoted-value";
      } else {
        state = "unquoted-value";
      }
      continue;
    }
    if (state === "unquoted-value" && isHtmlSpace(character)) state = "before-name";
  }
  return -1;
}

function parseHtmlTagAt(html, start) {
  let cursor = start + 1;
  let closing = false;
  if (html[cursor] === "/") {
    closing = true;
    cursor += 1;
  }
  const nameStart = cursor;
  while (cursor < html.length && !/[\t\n\f\r />]/.test(html[cursor])) cursor += 1;
  if (cursor === nameStart) return null;
  const name = asciiLower(html.slice(nameStart, cursor));
  const end = findHtmlTagEnd(html, cursor);
  if (end < 0) {
    return {
      attributeNames: new Set(),
      attributes: new Map(),
      closing,
      duplicates: new Set(),
      end: html.length,
      malformed: true,
      name,
    };
  }
  if (closing) {
    return {
      attributeNames: new Set(),
      attributes: new Map(),
      closing,
      duplicates: new Set(),
      end,
      malformed: false,
      name,
    };
  }

  const attributeNames = new Set();
  const attributes = new Map();
  const duplicates = new Set();
  while (cursor < end) {
    while (cursor < end && /[\t\n\f\r ]/.test(html[cursor])) cursor += 1;
    if (cursor >= end || html[cursor] === "/") {
      cursor += 1;
      continue;
    }
    const attributeStart = cursor;
    if (html[cursor] === "=") cursor += 1;
    while (cursor < end && !/[\t\n\f\r />=]/.test(html[cursor])) cursor += 1;
    if (cursor === attributeStart) {
      cursor += 1;
      continue;
    }
    const attributeName = asciiLower(html.slice(attributeStart, cursor));
    while (cursor < end && /[\t\n\f\r ]/.test(html[cursor])) cursor += 1;
    let value = "";
    if (html[cursor] === "=") {
      cursor += 1;
      while (cursor < end && /[\t\n\f\r ]/.test(html[cursor])) cursor += 1;
      const quote = html[cursor] === '"' || html[cursor] === "'" ? html[cursor] : "";
      if (quote) {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < end && html[cursor] !== quote) cursor += 1;
        if (cursor >= end) {
          return { attributeNames, attributes, closing, duplicates, end, malformed: true, name };
        }
        value = html.slice(valueStart, cursor);
        cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < end && !/[\t\n\f\r >]/.test(html[cursor])) cursor += 1;
        value = html.slice(valueStart, cursor);
      }
    }
    if (attributeNames.has(attributeName)) duplicates.add(attributeName);
    else attributeNames.add(attributeName);
    if (PRODUCTION_HTML_ATTRIBUTES.has(attributeName) && !attributes.has(attributeName)) {
      attributes.set(attributeName, value);
    }
  }
  return { attributeNames, attributes, closing, duplicates, end, malformed: false, name };
}

function findPlainTextElementClose(html, asciiLowerHtml, start, name) {
  const closingStart = asciiLowerHtml.indexOf("</" + name, start);
  if (closingStart < 0 || html.indexOf("<", start) !== closingStart) return null;
  const closingTag = parseHtmlTagAt(html, closingStart);
  if (!closingTag?.closing || closingTag.malformed || closingTag.name !== name) return null;
  return { closingStart, end: closingTag.end + 1 };
}

function findRawTextClose(html, asciiLowerHtml, start, name) {
  const needle = "</" + name;
  const scriptEscapeStart = name === "script" ? html.indexOf("<!--", start) : -1;
  let cursor = start;
  while (cursor < html.length) {
    const closingStart = asciiLowerHtml.indexOf(needle, cursor);
    if (closingStart < 0) return null;
    const boundary = html[closingStart + needle.length];
    if (scriptEscapeStart >= 0 && scriptEscapeStart < closingStart) return null;
    if (boundary === ">" || boundary === "/" || isHtmlSpace(boundary)) {
      const closingTag = parseHtmlTagAt(html, closingStart);
      if (closingTag?.closing && !closingTag.malformed && closingTag.name === name) {
        return { closingStart, end: closingTag.end + 1 };
      }
      return null;
    }
    cursor = closingStart + needle.length;
  }
  return null;
}

function productionNamespaceTagHasUnsafeCharacterReference(tag) {
  return [...PRODUCTION_NAMESPACE_RESOURCE_ATTRIBUTE_NAMES].some((name) =>
    tag.attributeNames.has(name) && /&(?!amp;)/.test(tag.attributes.get(name) || ""));
}

function decodeProductionCssEscapes(value) {
  let output = "";
  for (let cursor = 0; cursor < value.length;) {
    if (value[cursor] !== "\\") {
      output += value[cursor];
      cursor += 1;
      continue;
    }
    cursor += 1;
    if (cursor >= value.length) {
      output += "\\";
      break;
    }
    if (value[cursor] === "\r" || value[cursor] === "\n" || value[cursor] === "\f") {
      if (value[cursor] === "\r" && value[cursor + 1] === "\n") cursor += 1;
      cursor += 1;
      continue;
    }
    const hexStart = cursor;
    while (cursor < value.length && cursor - hexStart < 6 && /[A-Fa-f0-9]/.test(value[cursor])) {
      cursor += 1;
    }
    if (cursor > hexStart) {
      const codePoint = Number.parseInt(value.slice(hexStart, cursor), 16);
      if (value[cursor] === "\r" && value[cursor + 1] === "\n") cursor += 2;
      else if (isHtmlSpace(value[cursor])) cursor += 1;
      output += codePoint === 0
        || codePoint > 0x10ffff
        || (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? "\uFFFD" : String.fromCodePoint(codePoint);
      continue;
    }
    output += value[cursor];
    cursor += 1;
  }
  return output;
}

function decodeProductionPercentEscapes(value) {
  if (typeof value !== "string" || value.length > PRODUCTION_CHECK_LIMITS.htmlBytes) return null;
  let current = value;
  for (let pass = 0; pass < 24; pass += 1) {
    let changed = false;
    const output = current.replace(/%([A-Fa-f0-9]{2})/g, (_match, digits) => {
      changed = true;
      return String.fromCodePoint(Number.parseInt(digits, 16));
    });
    if (!changed) return current;
    current = output;
  }
  return /%[A-Fa-f0-9]{2}/.test(current) ? null : current;
}

function normalizeProductionNamespacePathname(value, canonicalDocumentUrl) {
  const decoded = decodeProductionPercentEscapes(value);
  if (decoded === null
    || !decoded.startsWith("/")
    || /[\\?#\u0000-\u001f\u007f]/.test(decoded)) return null;
  try {
    const normalized = new URL(decoded, canonicalDocumentUrl.origin);
    return normalized.origin === canonicalDocumentUrl.origin
      ? normalized.pathname : null;
  } catch {
    return null;
  }
}

function productionNamespaceUrlIsSafe(value, resolutionBaseUrl, canonicalDocumentUrl, buildIds) {
  if (typeof value !== "string" || value.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters) {
    return false;
  }
  let candidate;
  try {
    candidate = new URL(value.replaceAll("&amp;", "&"), resolutionBaseUrl);
  } catch {
    return false;
  }
  if (candidate.href.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters
    || candidate.username
    || candidate.password) return false;
  if (!["http:", "https:"].includes(candidate.protocol)) return true;
  const pathname = normalizeProductionNamespacePathname(candidate.pathname, canonicalDocumentUrl);
  return pathname !== null
    && canonicalizeProductionNextStaticReferences(pathname, buildIds) !== null;
}

function productionNamespaceSrcsetUrls(value) {
  if (typeof value !== "string" || value.length === 0
    || value.length > PRODUCTION_IMAGE_VALUE_LIMIT) return null;
  const candidates = value.split(",");
  if (candidates.length < 1 || candidates.length > 32) return null;
  const urls = [];
  for (const candidate of candidates) {
    const parts = trimHtmlSpace(candidate).split(/[\t\n\f\r ]+/);
    if (parts.length < 1 || parts.length > 2 || !parts[0]) return null;
    if (parts.length === 2
      && !/^(?:[1-9][0-9]{0,4}w|(?:0|[1-9][0-9]{0,3})(?:\.[0-9]+)?x)$/.test(parts[1])) {
      return null;
    }
    urls.push(parts[0]);
  }
  return urls;
}

function productionNamespaceCssUrls(value) {
  if (typeof value !== "string" || value.length > PRODUCTION_CHECK_LIMITS.htmlBytes) return null;
  const urls = [];
  const spans = [];
  const lower = asciiLower(value);
  let cursor = 0;
  while (cursor < value.length) {
    const marker = lower.indexOf("url(", cursor);
    if (marker < 0) break;
    if (marker > 0 && /[A-Za-z0-9_-]/.test(value[marker - 1])) {
      cursor = marker + 4;
      continue;
    }
    let valueCursor = marker + 4;
    while (isHtmlSpace(value[valueCursor])) valueCursor += 1;
    let urlValue = "";
    if (value[valueCursor] === '"' || value[valueCursor] === "'") {
      const quote = value[valueCursor];
      valueCursor += 1;
      const closeQuote = value.indexOf(quote, valueCursor);
      if (closeQuote < 0) return null;
      urlValue = value.slice(valueCursor, closeQuote);
      valueCursor = closeQuote + 1;
      while (isHtmlSpace(value[valueCursor])) valueCursor += 1;
      if (value[valueCursor] !== ")") return null;
    } else {
      const close = value.indexOf(")", valueCursor);
      if (close < 0) return null;
      urlValue = trimHtmlSpace(value.slice(valueCursor, close));
      if (/[\t\n\f\r ()'\"]/.test(urlValue)) return null;
      valueCursor = close;
    }
    urls.push(urlValue);
    spans.push([marker, valueCursor + 1]);
    cursor = valueCursor + 1;
  }

  let remainder = "";
  let remainderCursor = 0;
  for (const [start, end] of spans) {
    remainder += value.slice(remainderCursor, start);
    remainderCursor = end;
  }
  remainder += value.slice(remainderCursor);
  if (remainder.includes("\\") || asciiLower(remainder).includes("_next")) return null;
  return urls;
}

function productionFlightPayloadIsSafe(value) {
  const lower = asciiLower(value);
  const markup = /[<>]|&(?:lt|gt|#(?:0*60|0*62)|#x(?:0*3c|0*3e));?/i;
  return !(lower.includes("dangerouslysetinnerhtml") && markup.test(value))
    && !/(?:^|[\[,{:])[\t\n\f\r ]*["']base["'](?=[\t\f ]*(?:[,}\]\r\n]|$))/i.test(value)
    && !lower.includes("http-equiv")
    && !lower.includes("httpequiv")
    && !lower.includes("srcdoc")
    && !/\\[0-9A-Fa-f]/.test(value);
}

function decodeProductionJavaScriptEscapes(value) {
  let current = value;
  for (let pass = 0; pass < 24; pass += 1) {
    let output = "";
    for (let cursor = 0; cursor < current.length;) {
      if (current[cursor] !== "\\") {
        output += current[cursor];
        cursor += 1;
        continue;
      }
      cursor += 1;
      if (cursor >= current.length) {
        output += "\\";
        break;
      }
      if (current[cursor] === "\r" || current[cursor] === "\n") {
        if (current[cursor] === "\r" && current[cursor + 1] === "\n") cursor += 1;
        cursor += 1;
        continue;
      }
      if (current[cursor] === "x" && /^[A-Fa-f0-9]{2}/.test(current.slice(cursor + 1))) {
        output += String.fromCodePoint(Number.parseInt(current.slice(cursor + 1, cursor + 3), 16));
        cursor += 3;
        continue;
      }
      if (current[cursor] === "u" && current[cursor + 1] === "{") {
        const close = current.indexOf("}", cursor + 2);
        const digits = close < 0 ? "" : current.slice(cursor + 2, close);
        const codePoint = /^[A-Fa-f0-9]{1,6}$/.test(digits) ? Number.parseInt(digits, 16) : -1;
        if (codePoint >= 0 && codePoint <= 0x10ffff
          && !(codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          output += String.fromCodePoint(codePoint);
          cursor = close + 1;
          continue;
        }
      }
      if (current[cursor] === "u" && /^[A-Fa-f0-9]{4}/.test(current.slice(cursor + 1))) {
        output += String.fromCodePoint(Number.parseInt(current.slice(cursor + 1, cursor + 5), 16));
        cursor += 5;
        continue;
      }
      const escaped = current[cursor];
      const controls = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
      output += controls[escaped] ?? escaped;
      cursor += 1;
    }
    if (output === current) break;
    current = output;
  }
  return current;
}

function productionFlightPayloadVariants(value) {
  const variants = new Set([value]);
  let current = value;
  for (let pass = 0; pass < 24; pass += 1) {
    const javascriptDecoded = decodeProductionJavaScriptEscapes(current);
    const percentDecoded = decodeProductionPercentEscapes(javascriptDecoded);
    if (percentDecoded === null) return null;
    variants.add(javascriptDecoded);
    variants.add(percentDecoded);
    if (percentDecoded === current) return variants;
    current = percentDecoded;
  }
  return null;
}

function productionScriptPayloadText(tag, text) {
  if (productionTagHasExactAttributeNames(tag, PRODUCTION_STRUCTURED_DATA_ATTRIBUTE_NAMES)
    || tag.attributes.get("src")
    || text === "(self.__next_f=self.__next_f||[]).push([0])") return undefined;
  const prefix = "self.__next_f.push(";
  if (!text.startsWith(prefix) || !text.endsWith(")")) return null;
  try {
    const payload = JSON.parse(text.slice(prefix.length, -1));
    return Array.isArray(payload)
      && payload.length === 2
      && payload[0] === 1
      && typeof payload[1] === "string"
      ? payload[1] : null;
  } catch {
    return null;
  }
}

function readActiveProductionNextStaticNamespace(html, {
  documentUrl, reportDiagnostic = () => undefined,
} = {}) {
  if (typeof html !== "string") return null;
  const asciiLowerHtml = asciiLower(html);
  if (!asciiLowerHtml.startsWith(PRODUCTION_DOCTYPE)) return null;
  let canonicalDocumentUrl;
  try {
    canonicalDocumentUrl = new URL(documentUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(canonicalDocumentUrl.protocol)
    || canonicalDocumentUrl.username
    || canonicalDocumentUrl.password
    || canonicalDocumentUrl.search
    || canonicalDocumentUrl.hash
    || canonicalDocumentUrl.href.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters) return null;
  const deferRecruitmentAudioFallback = canonicalDocumentUrl.pathname === "/recruitment";
  let effectiveDocumentUrl = canonicalDocumentUrl;
  const activeUrlValues = [];
  let activeFlightInitializerSeen = false;
  let activeFlightPayloadSeen = false;
  let activeFlightPayloadStream = "";
  let deferredAudioBaseSeen = false;
  const inertContainers = [];
  const nextStaticBuildIds = new Set();
  let cursor = PRODUCTION_DOCTYPE.length;
  let activeAudioDepth = 0;
  let startTagCount = 0;

  function diagnose(category) {
    reportDiagnostic("HTML namespace parser " + category);
  }

  function recordActive(value) {
    const accepted = canonicalizeProductionNextStaticReferences(value, nextStaticBuildIds) !== null;
    if (!accepted) diagnose("REFERENCE");
    return accepted;
  }

  function recordActiveUrl(value) {
    if (activeUrlValues.length >= PRODUCTION_HTML_TAG_LIMIT * 8) return false;
    activeUrlValues.push(value);
    const accepted = productionNamespaceUrlIsSafe(
      value, effectiveDocumentUrl, canonicalDocumentUrl, nextStaticBuildIds,
    );
    if (!accepted) diagnose("URL");
    return accepted;
  }

  function recordActiveCss(value) {
    const decoded = decodeProductionCssEscapes(value.replaceAll("&amp;", "&"));
    if (!recordActive(decoded)) return false;
    const urls = productionNamespaceCssUrls(decoded);
    if (urls === null || !urls.every(recordActiveUrl)) {
      diagnose("CSS");
      return false;
    }
    return true;
  }

  function recordActiveTag(tag, rawTag) {
    if (productionNamespaceTagHasUnsafeCharacterReference(tag)) {
      diagnose("CHARACTER_REFERENCE");
      return false;
    }
    if (!recordActive(rawTag)) return false;
    for (const name of PRODUCTION_NAMESPACE_SINGLE_URL_ATTRIBUTE_NAMES) {
      if (tag.attributeNames.has(name) && !recordActiveUrl(tag.attributes.get(name) || "")) return false;
    }
    for (const name of PRODUCTION_NAMESPACE_SRCSET_ATTRIBUTE_NAMES) {
      if (!tag.attributeNames.has(name)) continue;
      const urls = productionNamespaceSrcsetUrls(tag.attributes.get(name));
      if (urls === null || !urls.every(recordActiveUrl)) return false;
    }
    const style = tag.attributes.get("style");
    return style === undefined || recordActiveCss(style);
  }

  function recordActiveScript(tag, rawText) {
    if (!productionScriptTagIsSafe(tag, rawText)) {
      diagnose("SCRIPT");
      return false;
    }
    const payloadText = productionScriptPayloadText(tag, rawText);
    if (payloadText === null) {
      diagnose("PAYLOAD");
      return false;
    }
    if (payloadText === undefined) {
      if (rawText === "(self.__next_f=self.__next_f||[]).push([0])") {
        if (activeFlightInitializerSeen || activeFlightPayloadSeen) {
          diagnose("PAYLOAD_INITIALIZER");
          return false;
        }
        activeFlightInitializerSeen = true;
      }
      return recordActive(rawText);
    }
    if (!activeFlightInitializerSeen) {
      diagnose("PAYLOAD_INITIALIZER");
      return false;
    }
    activeFlightPayloadSeen = true;
    if (activeFlightPayloadStream.length
      > PRODUCTION_CHECK_LIMITS.htmlBytes - payloadText.length) {
      diagnose("PAYLOAD_BOUND");
      return false;
    }
    activeFlightPayloadStream += payloadText;
    if (deferredAudioBaseSeen) {
      diagnose("PAYLOAD_BASE");
      return false;
    }
    return true;
  }

  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) {
      if (inertContainers.length === 0 && !recordActive(html.slice(cursor))) return null;
      break;
    }
    if (start > cursor
      && inertContainers.length === 0
      && !recordActive(html.slice(cursor, start))) return null;
    if (html.startsWith("<!--", start)) {
      const commentEnd = html.indexOf("-->", start + 4);
      if (commentEnd < 0
        || !PRODUCTION_SAFE_COMMENT_BODIES.has(html.slice(start + 4, commentEnd))) return null;
      cursor = commentEnd + 3;
      continue;
    }
    if (html[start + 1] === "!" || html[start + 1] === "?") return null;

    const tag = parseHtmlTagAt(html, start);
    if (!tag) {
      if (inertContainers.length === 0 && !recordActive("<")) return null;
      cursor = start + 1;
      continue;
    }
    if (tag.malformed) return null;
    const rawTag = html.slice(start, tag.end + 1);
    cursor = tag.end + 1;

    if (tag.closing) {
      if (tag.name === "audio" && activeAudioDepth === 1) activeAudioDepth = 0;
      if (PRODUCTION_NAMESPACE_INERT_CONTAINERS.has(tag.name)) {
        if (inertContainers.at(-1) !== tag.name) return null;
        inertContainers.pop();
      }
      continue;
    }
    if (++startTagCount > PRODUCTION_HTML_TAG_LIMIT
      || productionTagHasEventHandler(tag)
      || (!productionElementResourceAttributesAreSafe(tag)
        && !(deferRecruitmentAudioFallback && activeAudioDepth === 1 && tag.name === "base"))
      || PRODUCTION_AMBIGUOUS_TREE_ELEMENTS.has(tag.name)
      || PRODUCTION_NAMESPACE_REJECTED_CONTEXT_ELEMENTS.has(tag.name)) return null;

    if (inertContainers.at(-1) === "select") {
      if (!PRODUCTION_NAMESPACE_SELECT_CHILD_ELEMENTS.has(tag.name)) return null;
      continue;
    }

    if (PRODUCTION_NAMESPACE_INERT_CONTAINERS.has(tag.name)) {
      if ((tag.name === "template"
          && [...tag.attributeNames].some((name) => name.startsWith("shadowroot")))
        || inertContainers.length >= PRODUCTION_HTML_DEPTH_LIMIT
        || (tag.name === "select" && !recordActiveTag(tag, rawTag))) return null;
      inertContainers.push(tag.name);
      continue;
    }

    if (PRODUCTION_NAMESPACE_RAW_TEXT_ELEMENTS.has(tag.name)) {
      const rawTextClose = findRawTextClose(html, asciiLowerHtml, cursor, tag.name);
      if (!rawTextClose) return null;
      if (inertContainers.length === 0) {
        const rawText = html.slice(cursor, rawTextClose.closingStart);
        if (!recordActiveTag(tag, rawTag)
          || (tag.name === "script"
            ? !recordActiveScript(tag, rawText)
            : (!recordActive(rawText)
              || (tag.name === "style"
                && !recordActiveCss(rawText))))) return null;
      }
      cursor = rawTextClose.end;
      continue;
    }
    if (inertContainers.length > 0) continue;
    if (tag.name === "audio") {
      if (activeAudioDepth !== 0) return null;
      activeAudioDepth = 1;
    }
    if ((tag.name === "base" && !(deferRecruitmentAudioFallback && activeAudioDepth === 1))
      || (tag.name === "meta" && tag.attributeNames.has("http-equiv"))
      || !recordActiveTag(tag, rawTag)
      || (tag.name === "link" && !productionLinkTagIsSafe(tag))) return null;
    if (tag.name === "base") {
      const href = tag.attributes.get("href") || "";
      if (activeFlightPayloadSeen || deferredAudioBaseSeen || !href) return null;
      try {
        const candidate = new URL(href.replaceAll("&amp;", "&"), effectiveDocumentUrl);
        if (!["http:", "https:"].includes(candidate.protocol)
          || candidate.username
          || candidate.password
          || candidate.href.length > PRODUCTION_CHECK_LIMITS.assetUrlCharacters) return null;
        effectiveDocumentUrl = candidate;
        deferredAudioBaseSeen = true;
        if (!activeUrlValues.every((value) => productionNamespaceUrlIsSafe(
          value, effectiveDocumentUrl, canonicalDocumentUrl, nextStaticBuildIds,
        ))) return null;
      } catch {
        return null;
      }
    }
  }

  if (inertContainers.length > 0 || activeAudioDepth !== 0) {
    diagnose("INERT_STATE");
    return null;
  }
  if (activeFlightPayloadSeen) {
    const structuralResourceUrls = [];
    if (canonicalizeProductionFlightResourceEnvelopeStream(
      activeFlightPayloadStream, nextStaticBuildIds, structuralResourceUrls, canonicalDocumentUrl,
    ) === null || !structuralResourceUrls.every(recordActiveUrl)) {
      diagnose("PAYLOAD_MODEL");
      return null;
    }
    const flightPayloadVariants = productionFlightPayloadVariants(
      activeFlightPayloadStream,
    );
    if (flightPayloadVariants === null) {
      diagnose("PAYLOAD_ENCODING");
      return null;
    }
    for (const value of flightPayloadVariants) {
      if (!productionFlightPayloadIsSafe(value)) {
        diagnose("PAYLOAD_ACTIVE_CONTENT");
        return null;
      }
    }
  }
  if (nextStaticBuildIds.size > 1) {
    diagnose("MIXED_NAMESPACE");
    return null;
  }
  return Object.freeze({
    nextStaticBuildId: nextStaticBuildIds.size === 1 ? [...nextStaticBuildIds][0] : null,
  });
}

function readActiveProductionHtml(html, {
  allowPlainAudio = false, documentPolicies, reportDiagnostic = () => undefined, resourceProfile = "",
} = {}) {
  if (typeof html !== "string") return null;
  const documentPolicy = documentPolicies?.[resourceProfile];
  if (!documentPolicy) return null;
  const asciiLowerHtml = asciiLower(html);
  if (!asciiLowerHtml.startsWith(PRODUCTION_DOCTYPE)) return null;
  const tags = [];
  const titles = [];
  const activeText = [];
  const inertContainers = [];
  const visibilityElements = [];
  const footerElements = [];
  const resourceEnvelope = [];
  let resourceFlightPayloadStream = "";
  let resourceFlightEnvelopeIndex = -1;
  const nextStaticBuildIds = new Set();
  let footerCount = 0;
  let startTagCount = 0;
  let htmlElementSeen = false;
  let headElementSeen = false;
  let headElementClosed = false;
  let bodyElementSeen = false;
  let bodyElementClosed = false;
  let htmlElementClosed = false;
  let siteHeaderCount = 0;
  let siteHeaderStart = -1;
  let siteHeaderSha256 = "";
  let cursor = PRODUCTION_DOCTYPE.length;

  function appendText(value) {
    if (trimHtmlSpace(value) !== ""
      && !visibilityElements.some((element) => element.name === "body")) return false;
    const inert = inertContainers.length > 0;
    const hidden = visibilityElements.at(-1)?.hidden === true;
    if (!inert) {
      for (let index = footerElements.length - 1; index >= 0; index -= 1) {
        const anchor = footerElements[index].anchor;
        if (anchor) {
          anchor.rawText += value;
          if (!hidden) anchor.text += value;
          break;
        }
      }
    }
    if (inert || hidden) return true;
    activeText.push(value);
    return true;
  }

  function closeVisibilityElement(name) {
    if (visibilityElements.at(-1)?.name !== name) return false;
    visibilityElements.pop();
    return true;
  }

  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) {
      if (!appendText(html.slice(cursor))) return null;
      break;
    }
    if (start > cursor && !appendText(html.slice(cursor, start))) return null;
    if (html.startsWith("<!--", start)) {
      const commentEnd = html.indexOf("-->", start + 4);
      if (commentEnd < 0) return null;
      const commentBody = html.slice(start + 4, commentEnd);
      if (!PRODUCTION_SAFE_COMMENT_BODIES.has(commentBody)) return null;
      cursor = commentEnd + 3;
      continue;
    }
    if (html[start + 1] === "!" || html[start + 1] === "?") return null;

    const tag = parseHtmlTagAt(html, start);
    if (!tag) {
      if (!appendText("<")) return null;
      cursor = start + 1;
      continue;
    }
    if (tag.malformed) return null;
    cursor = tag.end + 1;
    if (PRODUCTION_AMBIGUOUS_TREE_ELEMENTS.has(tag.name)) return null;
    if (!tag.closing && ++startTagCount > PRODUCTION_HTML_TAG_LIMIT) return null;
    if (!tag.closing && productionTagHasEventHandler(tag)) return null;
    if (!tag.closing && !productionElementResourceAttributesAreSafe(tag)) return null;
    if (!tag.closing && footerElements.length > 0
      && (!PRODUCTION_FOOTER_DESCENDANT_CLASS_NAMES.has(tag.attributes.get("class") || "")
        || !PRODUCTION_FOOTER_DESCENDANT_ID_NAMES.has(tag.attributes.get("id") || ""))) return null;
    if (!tag.closing && tag.name === "a" && !productionAnchorTagIsSafe(tag)) return null;
    const parentTag = visibilityElements.at(-1)?.tag;
    if (!tag.closing && !productionInlineStyleIsSafe(tag, {
      footerCount,
      insideFooter: footerElements.length > 0,
      parentTag,
    })) return null;
    if (!tag.closing && !productionOverlayElementIsSafe(
      tag, parentTag, {
        ancestorTags: visibilityElements.map((element) => element.tag),
        insideFooter: footerElements.length > 0,
      },
    )) return null;
    if (!tag.closing && tag.name === "link") {
      if (inertContainers.length > 0 || !productionLinkTagIsSafe(tag)) return null;
      const context = visibilityElements.some((element) => element.name === "head") ? "head" : "body";
      const row = productionResourceEnvelopeRow(tag, "", context, nextStaticBuildIds);
      if (row === null) return null;
      resourceEnvelope.push(row);
    }
    if (!tag.closing && tag.name === "meta" && tag.attributeNames.has("http-equiv")) return null;
    if (!tag.closing && tag.name === "meta"
      && ["name", "property"].some((name) => (tag.attributes.get(name) || "").includes("&"))) {
      return null;
    }
    if (!tag.closing && tag.name === "audio" && allowPlainAudio) {
      if (inertContainers.length > 0
        || footerElements.length > 0
        || !bodyElementSeen
        || !visibilityElements.some((element) => element.name === "body")
        || !productionAudioTagIsSafe(tag)) return null;
      const audioClose = findPlainTextElementClose(html, asciiLowerHtml, cursor, "audio");
      if (!audioClose) return null;
      cursor = audioClose.end;
      continue;
    }
    if (!tag.closing && PRODUCTION_REJECTED_ELEMENTS.has(tag.name)) return null;
    if (!tag.closing
      && footerElements.at(-1)?.name === "nav"
      && footerElements.at(-1)?.tag.attributes.get("class") === "footer-legal"
      && tag.name !== "a") return null;

    if (tag.closing) {
      if (inertContainers.at(-1) === tag.name) {
        inertContainers.pop();
        continue;
      } else if (inertContainers.length > 0) {
        continue;
      } else if (footerElements.length > 0) {
        if (footerElements.at(-1).name !== tag.name) return null;
        footerElements.pop();
      }
      const structuralTop = visibilityElements.at(-1)?.name;
      const closingElement = visibilityElements.at(-1);
      if (tag.name === "header" && closingElement?.tag.attributes.get("class") === "site-header") {
        if (siteHeaderStart < 0 || siteHeaderSha256) return null;
        siteHeaderSha256 = createHash("sha256").update(html.slice(siteHeaderStart, cursor), "utf8")
          .digest("hex").toUpperCase();
      }
      if (tag.name === "head") {
        if (!headElementSeen || headElementClosed || structuralTop !== "head") return null;
        headElementClosed = true;
      } else if (tag.name === "body") {
        if (!bodyElementSeen || bodyElementClosed || structuralTop !== "body") return null;
        bodyElementClosed = true;
      } else if (tag.name === "html") {
        if (!htmlElementSeen || htmlElementClosed || !bodyElementClosed || structuralTop !== "html") return null;
        htmlElementClosed = true;
      }
      if (!closeVisibilityElement(tag.name)) return null;
      continue;
    }

    const structuralParent = visibilityElements.at(-1)?.name;
    const headOpen = visibilityElements.some((element) => element.name === "head");
    const bodyOpen = visibilityElements.some((element) => element.name === "body");
    if (tag.name === "html") {
      if (htmlElementSeen || visibilityElements.length !== 0) return null;
      htmlElementSeen = true;
    } else if (tag.name === "head") {
      if (!htmlElementSeen || headElementSeen || bodyElementSeen
        || htmlElementClosed || structuralParent !== "html") return null;
      headElementSeen = true;
    } else if (tag.name === "body") {
      if (!htmlElementSeen || !headElementSeen || !headElementClosed || bodyElementSeen
        || htmlElementClosed || structuralParent !== "html" || tag.attributes.has("class")) return null;
      bodyElementSeen = true;
    } else if (headOpen) {
      if (headElementClosed || structuralParent !== "head" || !PRODUCTION_HEAD_ELEMENTS.has(tag.name)) return null;
    } else if (!bodyOpen || bodyElementClosed || htmlElementClosed) {
      return null;
    }

    if (tag.name === "header" && tag.attributes.get("class") === "site-header") {
      if (siteHeaderCount !== 0 || structuralParent !== "body") return null;
      siteHeaderCount += 1;
      siteHeaderStart = start;
    }

    if (tag.name === "frameset") return null;
    if (PRODUCTION_RAW_TEXT_ELEMENTS.has(tag.name)) {
      if (footerElements.length > 0) return null;
      const rawTextClose = findRawTextClose(html, asciiLowerHtml, cursor, tag.name);
      if (!rawTextClose) return null;
      const rawText = html.slice(cursor, rawTextClose.closingStart);
      if (tag.name === "script"
        && (inertContainers.length > 0 || !productionScriptTagIsSafe(tag, rawText))) return null;
      if (tag.name === "script") {
        const payloadText = productionScriptPayloadText(tag, rawText);
        if (payloadText === null
          || (payloadText !== undefined
            && resourceFlightPayloadStream.length
              > PRODUCTION_CHECK_LIMITS.htmlBytes - payloadText.length)) return null;
        if (payloadText !== undefined) {
          const row = productionResourceEnvelopeRow(
            tag, rawText, headOpen ? "head" : "body", nextStaticBuildIds,
          );
          if (row === null) return null;
          if (resourceFlightEnvelopeIndex < 0) {
            resourceFlightEnvelopeIndex = resourceEnvelope.length;
            resourceEnvelope.push(row);
          } else if (resourceEnvelope.length !== resourceFlightEnvelopeIndex + 1
            || resourceEnvelope[resourceFlightEnvelopeIndex] !== row) {
            return null;
          }
          resourceFlightPayloadStream += payloadText;
        } else {
          const row = productionResourceEnvelopeRow(
            tag, rawText, headOpen ? "head" : "body", nextStaticBuildIds,
          );
          if (row === null) return null;
          resourceEnvelope.push(row);
        }
      }
      if (tag.name === "title"
        && headOpen
        && inertContainers.length === 0
        && !visibilityElements.at(-1)?.hidden) {
        titles.push(rawText);
      }
      cursor = rawTextClose.end;
      continue;
    }
    if (PRODUCTION_INERT_CONTAINERS.has(tag.name)) {
      if ([...tag.attributeNames].some((name) => name.startsWith("shadowroot"))) return null;
      if (footerElements.length > 0) return null;
      if (inertContainers.length >= PRODUCTION_HTML_DEPTH_LIMIT) return null;
      inertContainers.push(tag.name);
      continue;
    }
    if (inertContainers.length > 0) continue;
    if (tag.name === "base") return null;
    const hidden = productionElementIsHidden(tag, visibilityElements.at(-1)?.hidden === true);
    const insideFooter = footerElements.length > 0 || tag.name === "footer";
    for (let index = footerElements.length - 1; index >= 0; index -= 1) {
      const anchor = footerElements[index].anchor;
      if (anchor) {
        anchor.hasElementChild = true;
        break;
      }
    }
    let tagRecord = null;
    if (tag.name === "footer") {
      if (footerElements.length > 0
        || visibilityElements.at(-1)?.name !== "body"
        || tag.duplicates.has("class")
        || tag.attributes.get("class") !== "site-footer") return null;
      footerCount += 1;
      footerElements.push({ anchor: null, hidden, name: "footer", tag });
    } else if (footerElements.length > 0 && !PRODUCTION_VOID_ELEMENTS.has(tag.name)) {
      if (tag.name === "a" && footerElements.some((element) => element.anchor !== null)) return null;
      footerElements.push({ anchor: null, hidden, name: tag.name, tag });
    }
    if (tag.name === "link" || tag.name === "meta" || tag.name === "a") {
      if (tags.length >= PRODUCTION_HTML_TAG_LIMIT) return null;
      tagRecord = {
        ...tag,
        footerLegalLinkAncestryExact: tag.name === "a"
          && productionFooterLegalLinkAncestryIsExact(footerElements),
        hasElementChild: false,
        hidden,
        insideHead: headOpen,
        insideFooter,
        rawText: "",
        text: "",
      };
      tags.push(tagRecord);
      if (tag.name === "a" && footerElements.length > 0) {
        footerElements.at(-1).anchor = tagRecord;
      }
    }
    if (!PRODUCTION_VOID_ELEMENTS.has(tag.name)) {
      visibilityElements.push({ hidden, name: tag.name, tag });
    }
  }

  if (resourceFlightEnvelopeIndex >= 0) {
    const canonicalFlightPayloadStream = canonicalizeProductionFlightResourceEnvelopeStream(
      resourceFlightPayloadStream, nextStaticBuildIds, null, null, resourceProfile === "home",
    );
    if (canonicalFlightPayloadStream === null) {
      reportDiagnostic("HTML document parser FLIGHT_STREAM");
      return null;
    }
    resourceEnvelope[resourceFlightEnvelopeIndex] += `|stream-sha256=${createHash("sha256")
      .update(canonicalFlightPayloadStream, "utf8").digest("hex").toUpperCase()}`;
  }
  const resourceEnvelopeSha256 = createHash("sha256").update(JSON.stringify(resourceEnvelope), "utf8")
    .digest("hex").toUpperCase();
  const structureAccepted = inertContainers.length === 0
    && footerElements.length === 0
    && visibilityElements.length === 0
    && htmlElementSeen && headElementSeen && headElementClosed
    && bodyElementSeen && bodyElementClosed && htmlElementClosed
    && siteHeaderCount === 1 && nextStaticBuildIds.size <= 1;
  const policyVariants = productionDocumentPolicyVariants(documentPolicy);
  const headerAccepted = policyVariants.some((variant) =>
    productionDocumentDigestMatches(variant.header, siteHeaderSha256));
  const resourcesAccepted = policyVariants.some((variant) =>
    productionDocumentDigestMatches(variant.resources, resourceEnvelopeSha256));
  const envelopeAccepted = productionDocumentPolicyMatches(
    documentPolicy, siteHeaderSha256, resourceEnvelopeSha256,
  );
  if (!structureAccepted || !envelopeAccepted) {
    if (!structureAccepted) reportDiagnostic("HTML document parser STRUCTURE");
    else if (!headerAccepted) reportDiagnostic("HTML document parser HEADER_DIGEST");
    else if (!resourcesAccepted) reportDiagnostic("HTML document parser RESOURCE_DIGEST");
    else reportDiagnostic("HTML document parser ENVELOPE_PAIR");
    return null;
  }
  return Object.freeze({
    activeText: activeText.join(" "),
    footerCount,
    footerLegalLinkCount: tags.filter((tag) => tag.footerLegalLinkAncestryExact).length,
    nextStaticBuildId: nextStaticBuildIds.size === 1 ? [...nextStaticBuildIds][0] : null,
    title() {
      return titles.length === 1 ? titles[0] : "";
    },
    link(rel) {
      const matches = [];
      for (const tag of tags) {
        if (tag.name !== "link" || !tag.insideHead || tag.hidden) continue;
        if (tag.duplicates.has("rel") || tag.duplicates.has("href")) return "";
        const relTokens = asciiLower(tag.attributes.get("rel") || "")
          .split(/[\t\n\f\r ]+/)
          .filter(Boolean);
        if (relTokens.includes(asciiLower(rel))) matches.push(tag.attributes.get("href") || "");
      }
      return matches.length === 1 ? matches[0] : "";
    },
    meta(attribute, value) {
      const matches = [];
      for (const tag of tags) {
        if (tag.name !== "meta" || !tag.insideHead || tag.hidden) continue;
        if (tag.duplicates.has(attribute) || tag.duplicates.has("content")) return "";
        if (asciiLower(tag.attributes.get(attribute) || "") === asciiLower(value)) {
          const content = productionMetadataContent(tag.attributes.get("content") || "");
          if (!content) return "";
          matches.push(content);
        }
      }
      return matches.length === 1 ? matches[0] : "";
    },
    footerLinkCount(href, label) {
      let count = 0;
      for (const tag of tags) {
        if (tag.name !== "a" || !tag.insideFooter) continue;
        const observedHref = tag.attributes.get("href") || "";
        const observedLabel = normalizeProductionElementText(tag.text);
        const observedRawLabel = normalizeProductionElementText(tag.rawText);
        if (observedHref !== href && observedLabel !== label && observedRawLabel !== label) continue;
        if (tag.hidden
          || !tag.footerLegalLinkAncestryExact
          || !productionTagHasExactAttributeNames(tag, new Set(["href"]))
          || tag.hasElementChild
          || observedHref !== href
          || observedLabel !== label
          || observedRawLabel !== label) return 0;
        count += 1;
      }
      return count;
    },
  });
}

function productionHtmlNamespaceMatchesPath(client, path, html) {
  const document = readActiveProductionNextStaticNamespace(html, {
    documentUrl: new URL(path, client.baseUrl).href,
    reportDiagnostic: client.diagnose ? client.reportDiagnostic : () => undefined,
  });
  return document !== null
    && productionNextStaticNamespaceMatchesPath(client, path, document.nextStaticBuildId);
}

async function checkUrlAvailability(client) {
  for (const contract of PAGE_CONTRACTS) {
    const body = await fetchText(client, contract.path, contract.media);
    if (contract.media === "html") {
      if (!productionHtmlNamespaceMatchesPath(client, contract.path, body)) {
        if (client.diagnose) client.reportDiagnostic("HTML namespace rejected " + contract.path);
        throw failure("HTML_DOCUMENT_REJECTED");
      }
    }
  }
}

async function checkMetadata(client, documentPolicies) {
  const home = await fetchText(client, "/", "html");
  if (!productionHtmlNamespaceMatchesPath(client, "/", home)) {
    if (client.diagnose) client.reportDiagnostic("HTML metadata namespace rejected /");
    throw failure("HTML_DOCUMENT_REJECTED");
  }
  const homeDocument = readActiveProductionHtml(home, {
    documentPolicies,
    reportDiagnostic: client.diagnose ? client.reportDiagnostic : () => undefined,
    resourceProfile: "home",
  });
  if (!homeDocument
    || !productionNextStaticNamespaceMatchesPath(client, "/", homeDocument.nextStaticBuildId)) {
    if (client.diagnose) {
      const prior = client.htmlNextStaticNamespaces.get("/");
      const comparison = !homeDocument ? "DOCUMENT_REJECTED"
        : prior === homeDocument.nextStaticBuildId ? "MATCH"
          : `${prior === null ? "ABSENT" : "PRESENT"}_${homeDocument.nextStaticBuildId === null ? "ABSENT" : "PRESENT"}`;
      client.reportDiagnostic("HTML metadata namespace rejected / " + comparison);
    }
    throw failure("HTML_DOCUMENT_REJECTED");
  }
  assertIncludes(homeDocument.title(), /Where Winds Meet/i, "HOMEPAGE_TITLE");
  if (!homeDocument.meta("name", "description")) throw failure("CONTENT_HOMEPAGE_DESCRIPTION_REJECTED");
  if (homeDocument.link("canonical") !== client.siteOrigin) {
    throw failure("CONTENT_HOMEPAGE_CANONICAL_REJECTED");
  }
  if (!homeDocument.meta("property", "og:title")) throw failure("CONTENT_HOMEPAGE_OG_TITLE_REJECTED");
  if (homeDocument.footerCount !== 1
    || homeDocument.footerLegalLinkCount !== 3
    || homeDocument.footerLinkCount("/privacy", "Privacy") !== 1
    || homeDocument.footerLinkCount("/meta-data-deletion", "Data Deletion") !== 1
    || homeDocument.footerLinkCount("mailto:support@mochirii.com", "support@mochirii.com") !== 1) {
    throw failure("CONTENT_HOMEPAGE_FOOTER_REJECTED");
  }

  const ogImage = homeDocument.meta("property", "og:image");
  if (!ogImage) throw failure("CONTENT_HOMEPAGE_OG_IMAGE_REJECTED");
  const canonicalOgImage = requestUrl(client.siteOrigin, ogImage, { asset: true });
  if (canonicalOgImage.href !== ogImage) throw failure("ASSET_URL_REJECTED");
  const ogResponse = await fetchProductionResponse(client, canonicalOgImage.pathname, {
    asset: true,
    label: "homepage OG image",
  });
  await assertMediaType(ogResponse, ["image/webp"], { allowUtf8: false });
  await cancelResponseBody(ogResponse);

  const recruitment = await fetchText(client, "/recruitment", "html");
  if (!productionHtmlNamespaceMatchesPath(client, "/recruitment", recruitment)) {
    if (client.diagnose) client.reportDiagnostic("HTML metadata namespace rejected /recruitment");
    throw failure("HTML_DOCUMENT_REJECTED");
  }
  const recruitmentDocument = readActiveProductionHtml(recruitment, {
    allowPlainAudio: true,
    documentPolicies,
    reportDiagnostic: client.diagnose ? client.reportDiagnostic : () => undefined,
    resourceProfile: "recruitment",
  });
  if (!recruitmentDocument
    || !productionNextStaticNamespaceMatchesPath(
      client, "/recruitment", recruitmentDocument.nextStaticBuildId,
    )) {
    if (client.diagnose) client.reportDiagnostic("HTML metadata namespace rejected /recruitment");
    throw failure("HTML_DOCUMENT_REJECTED");
  }
  assertIncludes(recruitmentDocument.activeText, /Recruitment/i, "RECRUITMENT_PAGE");
  if (recruitmentDocument.link("canonical") !== client.siteOrigin + "/recruitment") {
    throw failure("CONTENT_RECRUITMENT_CANONICAL_REJECTED");
  }

  const privacy = await fetchText(client, "/privacy", "html");
  if (!productionHtmlNamespaceMatchesPath(client, "/privacy", privacy)) {
    if (client.diagnose) client.reportDiagnostic("HTML metadata namespace rejected /privacy");
    throw failure("HTML_DOCUMENT_REJECTED");
  }
  const privacyDocument = readActiveProductionHtml(privacy, {
    documentPolicies,
    reportDiagnostic: client.diagnose ? client.reportDiagnostic : () => undefined,
    resourceProfile: "privacy",
  });
  if (!privacyDocument
    || !productionNextStaticNamespaceMatchesPath(
      client, "/privacy", privacyDocument.nextStaticBuildId,
    )) {
    if (client.diagnose) client.reportDiagnostic("HTML metadata namespace rejected /privacy");
    throw failure("HTML_DOCUMENT_REJECTED");
  }
  assertIncludes(privacyDocument.activeText, /Website scope|privacy questions/i, "PRIVACY_PAGE");
  if (privacyDocument.link("canonical") !== client.siteOrigin + "/privacy") {
    throw failure("CONTENT_PRIVACY_CANONICAL_REJECTED");
  }

  const deletion = await fetchText(client, "/meta-data-deletion", "html");
  if (!productionHtmlNamespaceMatchesPath(client, "/meta-data-deletion", deletion)) {
    if (client.diagnose) {
      client.reportDiagnostic("HTML metadata namespace rejected /meta-data-deletion");
    }
    throw failure("HTML_DOCUMENT_REJECTED");
  }
  const deletionDocument = readActiveProductionHtml(deletion, {
    documentPolicies,
    reportDiagnostic: client.diagnose ? client.reportDiagnostic : () => undefined,
    resourceProfile: "deletion",
  });
  if (!deletionDocument
    || !productionNextStaticNamespaceMatchesPath(
      client, "/meta-data-deletion", deletionDocument.nextStaticBuildId,
    )) {
    if (client.diagnose) {
      client.reportDiagnostic("HTML metadata namespace rejected /meta-data-deletion");
    }
    throw failure("HTML_DOCUMENT_REJECTED");
  }
  assertIncludes(deletionDocument.activeText, /Data Deletion Requests|How to make a request/i, "DELETION_PAGE");
  if (deletionDocument.link("canonical") !== client.siteOrigin + "/meta-data-deletion") {
    throw failure("CONTENT_DELETION_CANONICAL_REJECTED");
  }
}

function replaceXmlComments(value) {
  let output = "";
  let cursor = 0;
  let insideTag = false;
  let quote = "";
  while (cursor < value.length) {
    if (!insideTag && value.startsWith("<!--", cursor)) {
      const end = value.indexOf("-->", cursor + 4);
      const comment = end < 0 ? "" : value.slice(cursor + 4, end);
      if (end < 0 || comment.includes("--") || comment.endsWith("-")) return null;
      output += " ";
      cursor = end + 3;
      continue;
    }
    if (insideTag && value.startsWith("<!--", cursor)) return null;

    const character = value[cursor];
    output += character;
    cursor += 1;
    if (!insideTag) {
      if (character === "<") insideTag = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      insideTag = false;
    }
  }
  return insideTag || quote ? null : output;
}

function productionSitemapLocations(value, siteOrigin) {
  if (typeof value !== "string") return null;
  const xml = replaceXmlComments(value);
  if (xml === null) return null;

  const whitespace = "[\\t\\n\\r ]*";
  const entry = "<url>" + whitespace + "<loc>[^<>&]{1,2048}</loc>" + whitespace + "</url>";
  const documentPattern = new RegExp(
    "^(?:"
      + "<\\?xml[\\t\\n\\r ]+version=\\\"1\\.0\\\"[\\t\\n\\r ]+encoding=\\\"UTF-8\\\"\\?>" + whitespace
      + "|" + whitespace + ")"
      + "<urlset[\\t\\n\\r ]+xmlns=\\\"http://www\\.sitemaps\\.org/schemas/sitemap/0\\.9\\\">"
      + whitespace + "(?:" + entry + whitespace + ")+</urlset>" + whitespace + "$",
  );
  if (!documentPattern.test(xml)) return null;

  const entryPattern = new RegExp(
    "<url>" + whitespace + "<loc>([^<>&]{1,2048})</loc>" + whitespace + "</url>",
    "g",
  );
  const locations = [];
  for (const match of xml.matchAll(entryPattern)) {
    let candidate;
    try {
      candidate = requestUrl(siteOrigin, match[1]);
    } catch {
      return null;
    }
    if (candidate.href !== match[1]) return null;
    locations.push(match[1]);
  }
  if (locations.length === 0 || new Set(locations).size !== locations.length) return null;
  return new Set(locations);
}

function productionRobotsSitemaps(value) {
  if (typeof value !== "string" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
  const sitemaps = [];
  for (const rawLine of value.split(/\r\n|\n|\r/)) {
    const comment = rawLine.indexOf("#");
    const line = trimHtmlSpace(comment < 0 ? rawLine : rawLine.slice(0, comment));
    if (!line) continue;
    const directive = /^([A-Za-z][A-Za-z-]*):[\t ]*(.*)$/.exec(line);
    if (!directive || asciiLower(directive[1]) !== "sitemap") continue;
    sitemaps.push(trimHtmlSpace(directive[2]));
  }
  return sitemaps;
}

async function checkDiscoveryFiles(client) {
  const sitemap = await fetchText(client, "/sitemap.xml", "xml");
  const locations = productionSitemapLocations(sitemap, client.siteOrigin);
  if (!locations) throw failure("CONTENT_SITEMAP_DOCUMENT_REJECTED");
  if (!locations.has(client.siteOrigin + "/gallery")) throw failure("CONTENT_SITEMAP_GALLERY_REJECTED");
  if (!locations.has(client.siteOrigin + "/privacy")) throw failure("CONTENT_SITEMAP_PRIVACY_REJECTED");
  if (!locations.has(client.siteOrigin + "/meta-data-deletion")) {
    throw failure("CONTENT_SITEMAP_DELETION_REJECTED");
  }

  const robots = await fetchText(client, "/robots.txt", "text");
  const sitemaps = productionRobotsSitemaps(robots);
  if (!sitemaps
    || sitemaps.length !== 1
    || sitemaps[0] !== client.siteOrigin + "/sitemap.xml") {
    throw failure("CONTENT_ROBOTS_SITEMAP_REJECTED");
  }
}

async function checkProductionWithDocumentPolicies({
  baseUrl = process.env.MOCHIRII_PRODUCTION_BASE_URL || undefined,
  defaultBaseUrlLoader = loadDefaultProductionBaseUrl,
  fetchImpl = globalThis.fetch,
  waitImpl = wait,
  maxAttempts = MAX_ATTEMPTS,
  diagnose = false,
  reportDiagnostic = () => undefined,
} = {}, documentPolicies) {
  if (typeof defaultBaseUrlLoader !== "function"
    || typeof fetchImpl !== "function"
    || typeof waitImpl !== "function"
    || !Number.isInteger(maxAttempts)
    || maxAttempts < 1
    || maxAttempts > MAX_ATTEMPTS
    || typeof reportDiagnostic !== "function") {
    throw failure("CLIENT_CONTRACT_REJECTED");
  }
  let siteOrigin;
  try {
    siteOrigin = normalizeProductionBaseUrl(defaultBaseUrlLoader());
  } catch {
    throw failure("BASE_URL_REJECTED");
  }
  const selectedBaseUrl = baseUrl === undefined ? siteOrigin : baseUrl;
  const normalizedBaseUrl = normalizeProductionBaseUrl(selectedBaseUrl);

  const client = {
    baseUrl: normalizedBaseUrl,
    siteOrigin,
    fetchImpl,
    waitImpl,
    maxAttempts,
    diagnose: diagnose === true,
    htmlNextStaticNamespaces: new Map(),
    nextStaticBuildId: null,
    reportDiagnostic,
  };
  await checkUrlAvailability(client);
  await checkMetadata(client, documentPolicies);
  await checkDiscoveryFiles(client);
  return Object.freeze({ ok: true });
}

export async function checkProduction(options = {}) {
  return checkProductionWithDocumentPolicies(options, PRODUCTION_DOCUMENT_POLICIES);
}

export async function checkProductionWithTestFixtures(options = {}) {
  return checkProductionWithDocumentPolicies(options, TEST_DOCUMENT_POLICIES);
}

export function formatProductionFailure(error) {
  const code = error instanceof ProductionSmokeError ? error.code : "UNEXPECTED_REJECTED";
  const status = error instanceof ProductionSmokeError ? error.status : null;
  return status === null
    ? "Production smoke check failed [" + code + "]."
    : "Production smoke check failed [" + code + "] (HTTP " + status + ").";
}

export async function run({
  baseUrl = process.env.MOCHIRII_PRODUCTION_BASE_URL || undefined,
  defaultBaseUrlLoader = loadDefaultProductionBaseUrl,
  fetchImpl = globalThis.fetch,
  waitImpl = wait,
  maxAttempts = MAX_ATTEMPTS,
  diagnose = DEFAULT_DIAGNOSE,
  reportDiagnostic = (message) => console.log(message),
  reportFailure = (message) => console.error(message),
  reportSuccess = (message) => console.log(message),
} = {}) {
  try {
    await checkProduction({
      baseUrl,
      defaultBaseUrlLoader,
      fetchImpl,
      waitImpl,
      maxAttempts,
      diagnose,
      reportDiagnostic,
    });
    reportSuccess("Production smoke check OK.");
    return 0;
  } catch (error) {
    reportFailure(formatProductionFailure(error));
    return 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedUrl === import.meta.url) {
  process.exitCode = await run();
}
