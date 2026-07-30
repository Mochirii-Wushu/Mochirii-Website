const FORMAT_OR_ZERO_WIDTH_RE =
  /[\p{Cf}\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180d\u3164\ufe00-\ufe0f\uffa0]/gu;
const DOT_ESCAPE_RE =
  /%(?:25){0,2}2e|\\u\{?0*2e\}?|&(?:period|dot);|&#0*46;?|&#x0*2e;?/giu;
const DOT_WRAPPER_RE = /[\[({<]\s*(?:\.|d[\s._-]*o[\s._-]*t)\s*[\])}>]/giu;
const DOT_WORD_RE = /\bd[\s._-]*o[\s._-]*t\b/giu;
const DOT_LIKE_RE = /[\u2024\u3002\ufe52\uff0e\uff61]/gu;
const SLASH_ESCAPE_RE =
  /%(?:25){0,2}2f|\\u\{?0*2f\}?|&(?:sol|slash);|&#0*47;?|&#x0*2f;?/giu;
const COLON_ESCAPE_RE =
  /%(?:25){0,2}3a|\\u\{?0*3a\}?|&(?:colon);|&#0*58;?|&#x0*3a;?/giu;
const SCHEME_RE = /(?:^|[^a-z0-9])(?:https?|ftp):\/\//iu;
const WWW_RE = /(?:^|[^a-z0-9_-])www\./iu;
const PROTOCOL_RELATIVE_RE = /(?:^|[\s([<{])\/\/[a-z0-9]/iu;
const BARE_DOMAIN_RE =
  /(?:^|[^\p{L}\p{N}_-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:[\p{L}]{2,63}|xn--[a-z0-9-]{2,59})(?=$|[^\p{L}\p{N}_-])/iu;
const IPV4_LINK_RE =
  /(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?=$|[^0-9])/u;
const LOCALHOST_RE = /(?:^|[^a-z0-9_-])localhost(?::\d{1,5})?(?:\/|$)/iu;

export const SOCIAL_PUBLICATION_COPY_ERROR =
  "URLs and website references are not allowed in Meta publication copy.";
export const SOCIAL_PUBLICATION_COPY_ERROR_CODE =
  "social_publication_url_reference_forbidden";

export type SocialPublicationCopyValidation =
  | { ok: true; error: null; message: null }
  | {
    ok: false;
    error: typeof SOCIAL_PUBLICATION_COPY_ERROR_CODE;
    message: typeof SOCIAL_PUBLICATION_COPY_ERROR;
  };

export function normalizeSocialPublicationCopyForInspection(
  value: unknown,
): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(FORMAT_OR_ZERO_WIDTH_RE, "")
    .replace(DOT_ESCAPE_RE, ".")
    .replace(DOT_WRAPPER_RE, ".")
    .replace(DOT_WORD_RE, ".")
    .replace(DOT_LIKE_RE, ".")
    .replace(SLASH_ESCAPE_RE, "/")
    .replace(COLON_ESCAPE_RE, ":")
    .replace(/[[(<{]\s*slash\s*[\])}>]/giu, "/")
    .replace(/[[(<{]\s*colon\s*[\])}>]/giu, ":")
    .replace(/\bh\s*t\s*t\s*p\s*s?\b/giu, (value) => value.replace(/\s+/g, ""))
    .replace(/\bw\s*w\s*w\b/giu, "www")
    .replace(/m\s*o\s*c\s*h\s*i\s*r\s*i\s*i/giu, "mochirii")
    .replace(/c\s*o\s*m/giu, "com")
    .replace(/\s*([.:/])\s*/gu, "$1")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

export function socialPublicationCopyContainsUrlLikeReference(
  value: unknown,
): boolean {
  const normalized = normalizeSocialPublicationCopyForInspection(value);
  return SCHEME_RE.test(normalized) ||
    WWW_RE.test(normalized) ||
    PROTOCOL_RELATIVE_RE.test(normalized) ||
    BARE_DOMAIN_RE.test(normalized) ||
    IPV4_LINK_RE.test(normalized) ||
    LOCALHOST_RE.test(normalized);
}

export const socialPublicationCopyContainsSiteReference =
  socialPublicationCopyContainsUrlLikeReference;

export function validateSocialPublicationCopy(
  values: readonly unknown[],
): SocialPublicationCopyValidation {
  if (values.some(socialPublicationCopyContainsUrlLikeReference)) {
    return {
      ok: false,
      error: SOCIAL_PUBLICATION_COPY_ERROR_CODE,
      message: SOCIAL_PUBLICATION_COPY_ERROR,
    };
  }
  return { ok: true, error: null, message: null };
}
