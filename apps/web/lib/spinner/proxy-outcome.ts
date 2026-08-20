export type SpinnerProxyOutcome =
  | "access-denied"
  | "synchronized"
  | "not-modified"
  | "command-rejected"
  | "rate-limited"
  | "upstream-error";

export function spinnerProxyOutcomeForStatus(
  method: "GET" | "POST",
  status: number,
): SpinnerProxyOutcome | null {
  if (status === 200) return "synchronized";
  if (status === 429) return "rate-limited";
  if (method === "POST" && (status === 400 || status === 409)) {
    return "command-rejected";
  }
  return null;
}

export function spinnerNotModifiedResponseMetadata(
  headers: Pick<Headers, "get">,
): { etag: string; serverTime: string } | null {
  const etag = headers.get("etag")?.trim() || "";
  const serverTime = headers.get("x-mochirii-server-time")?.trim() || "";
  if (
    !etag || etag.length > 256 || /[\r\n]/u.test(etag) ||
    !serverTime || !Number.isFinite(Date.parse(serverTime))
  ) return null;
  return { etag, serverTime };
}
