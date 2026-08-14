export const FORUMS_ORIGIN = "https://forums.mochirii.com";
export const FORUMS_DISCOURSE_CONNECT_CALLBACK = `${FORUMS_ORIGIN}/session/sso_login`;

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function approvedForumsDiscourseConnectRedirect(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8_192) return null;

  try {
    const url = new URL(value);
    if (
      url.origin !== FORUMS_ORIGIN
      || url.pathname !== "/session/sso_login"
      || url.username
      || url.password
      || url.port
      || url.hash
    ) {
      return null;
    }

    const keys = [...url.searchParams.keys()];
    if (keys.length !== 2 || keys[0] !== "sso" || keys[1] !== "sig") return null;
    const sso = url.searchParams.get("sso") || "";
    const sig = url.searchParams.get("sig") || "";
    if (!sso || sso.length > 4_096 || !BASE64_PATTERN.test(sso)) return null;
    if (!HEX_SHA256_PATTERN.test(sig)) return null;

    return url.href;
  } catch {
    return null;
  }
}
