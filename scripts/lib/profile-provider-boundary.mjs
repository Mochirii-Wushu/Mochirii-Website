export const PROFILE_PROVIDER_HOST_SUFFIXES = Object.freeze([
  "byteimg.com",
  "byteimg.eu",
  "byteoversea.com",
  "cdninstagram.com",
  "facebook.com",
  "facebook.net",
  "fb.com",
  "fbcdn.net",
  "fbsbx.com",
  "ibytedtos.com",
  "instagram.com",
  "meta.com",
  "muscdn.com",
  "musical.ly",
  "tiktok.com",
  "tiktokcdn.com",
  "tiktokcdn-eu.com",
  "tiktokcdn-us.com",
  "tiktokrow-cdn.com",
  "tiktokv.com",
  "tiktokv.us",
  "ttlivecdn.com",
  "ttwstatic.com",
]);

export function isProfileProviderHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase().replace(/\.$/u, "");
  return PROFILE_PROVIDER_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}
