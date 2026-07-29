const LOCAL_ORIGIN = "https://mochirii.invalid";

export function safeInternalRedirectPath(value: unknown, fallback = "/account") {
  const candidate = String(value || "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return fallback;
  }

  try {
    const url = new URL(candidate, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function authCallbackPath(next: unknown) {
  const callback = new URL("/auth/callback", LOCAL_ORIGIN);
  callback.searchParams.set("next", safeInternalRedirectPath(next));
  return `${callback.pathname}${callback.search}`;
}
