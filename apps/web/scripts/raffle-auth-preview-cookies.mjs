const MAX_SET_COOKIE_HEADER_LENGTH = 16_384;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function parseSetCookieChange(header, now = Date.now()) {
  if (
    typeof header !== "string"
    || !header
    || header.length > MAX_SET_COOKIE_HEADER_LENGTH
    || CONTROL_CHARACTER_PATTERN.test(header)
  ) return null;

  const parts = header.split(";");
  const pair = parts.shift() || "";
  const separator = pair.indexOf("=");
  if (separator < 1) return null;

  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  if (!COOKIE_NAME_PATTERN.test(name)) return null;

  let deletion = value.length === 0;
  for (const part of parts) {
    const attribute = part.trim();
    if (!attribute) continue;
    const attributeSeparator = attribute.indexOf("=");
    const attributeName = (attributeSeparator === -1 ? attribute : attribute.slice(0, attributeSeparator))
      .trim()
      .toLowerCase();
    const attributeValue = attributeSeparator === -1 ? "" : attribute.slice(attributeSeparator + 1).trim();

    if (attributeName === "max-age" && /^-?\d+$/.test(attributeValue)) {
      deletion ||= Number(attributeValue) <= 0;
    }
    if (attributeName === "expires") {
      const expiry = Date.parse(attributeValue);
      deletion ||= Number.isFinite(expiry) && expiry <= now;
    }
  }

  return { name, value, deletion };
}

export function applySetCookieChanges(cookieJar, changes) {
  for (const change of changes) {
    if (change.deletion || !change.value) cookieJar.delete(change.name);
    else cookieJar.set(change.name, change.value);
  }
  return cookieJar;
}

export function hasNonemptyAuthTokenCookie(cookieJar) {
  return [...cookieJar].some(([name, value]) => /auth-token(?:\.|$)/.test(name) && Boolean(value));
}
