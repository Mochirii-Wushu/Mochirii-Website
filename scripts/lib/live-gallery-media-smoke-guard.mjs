export const LIVE_GALLERY_MEDIA_SMOKE_OPT_IN =
  "MOCHIRII_ALLOW_LIVE_GALLERY_MEDIA_SMOKE_ONCE";

function canonicalWebsiteHostname(siteOrigin) {
  return new URL(siteOrigin).hostname.toLowerCase().replace(/^www\./, "");
}

export function isProductionWebsiteOrigin(baseUrl, siteOrigin) {
  const targetHostname = new URL(baseUrl).hostname.toLowerCase();
  const productionHostname = canonicalWebsiteHostname(siteOrigin);

  return targetHostname === productionHostname || targetHostname === `www.${productionHostname}`;
}

export function isReviewedWebsiteVercelPreviewOrigin(baseUrl) {
  const target = new URL(baseUrl);
  const hostname = target.hostname.toLowerCase();
  return target.protocol === "https:" &&
    !target.port &&
    /^mochirii-git-(?!main-mochirii\.vercel\.app$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-mochirii\.vercel\.app$/.test(
      hostname,
    );
}

export function enforceProductionGalleryMatrixGuard({
  baseUrl,
  siteOrigin,
  environment = process.env,
}) {
  if (!isProductionWebsiteOrigin(baseUrl, siteOrigin)) return;
  if (environment[LIVE_GALLERY_MEDIA_SMOKE_OPT_IN] === "true") return;

  throw new Error(
    `Refusing a broad gallery/browser matrix against the production Website origin. `
      + `Use a local or reviewed Preview origin for fixture-based coverage. `
      + `For one explicitly approved, bounded production run only, set `
      + `${LIVE_GALLERY_MEDIA_SMOKE_OPT_IN}=true for that process.`,
  );
}

export function resolveGalleryAuditUrl({
  baseUrl,
  siteOrigin,
  environment = process.env,
}) {
  let target;
  try {
    target = new URL(baseUrl);
  } catch {
    throw new Error("Gallery Lighthouse origin must be an absolute URL.");
  }

  if (
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  ) {
    throw new Error(
      "Gallery Lighthouse origin must contain only a scheme, host, and optional port.",
    );
  }

  const exactLocalOrigin =
    target.protocol === "http:" &&
    target.port === "8765" &&
    (target.hostname === "127.0.0.1" || target.hostname === "localhost");
  const reviewedVercelPreview = isReviewedWebsiteVercelPreviewOrigin(
    target.origin,
  );
  const productionOrigin = isProductionWebsiteOrigin(target.origin, siteOrigin);

  if (!exactLocalOrigin && !reviewedVercelPreview && !productionOrigin) {
    throw new Error(
      "Gallery Lighthouse audits require the exact local origin, a reviewed Vercel Preview, or an explicitly approved production origin.",
    );
  }

  enforceProductionGalleryMatrixGuard({
    baseUrl: target.origin,
    siteOrigin,
    environment,
  });
  return new URL("/gallery", target.origin).href;
}
