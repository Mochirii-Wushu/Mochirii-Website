export const FORUMS_CONNECT_REQUEST_STORAGE_KEY = "mochirii:forums-connect-request:v1";
export const FORUMS_CONNECT_LOGIN_HREF = "/auth?redirect=%2Fforums%2Fconnect";

export type OpaqueForumsConnectRequest = Readonly<{
  sso: string;
  sig: string;
}>;

type SearchParamsReader = Readonly<{
  getAll: (name: string) => string[];
  keys: () => IterableIterator<string>;
}>;

type BrowserRequestStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}>;

export function plausibleOpaqueForumsConnectRequest(
  sso: unknown,
  sig: unknown,
): OpaqueForumsConnectRequest | null {
  if (
    typeof sso !== "string"
    || sso.length === 0
    || sso.length > 4_096
    || typeof sig !== "string"
    || !/^[0-9a-f]{64}$/.test(sig)
  ) {
    return null;
  }
  return { sso, sig };
}

export function opaqueForumsConnectRequestFromSearch(searchParams: SearchParamsReader) {
  const keys = [...searchParams.keys()].sort();
  if (keys.length !== 2 || keys[0] !== "sig" || keys[1] !== "sso") return null;
  const ssoValues = searchParams.getAll("sso");
  const sigValues = searchParams.getAll("sig");
  if (ssoValues.length !== 1 || sigValues.length !== 1) return null;
  return plausibleOpaqueForumsConnectRequest(ssoValues[0], sigValues[0]);
}

export function serializeOpaqueForumsConnectRequest(request: OpaqueForumsConnectRequest) {
  return JSON.stringify({ sso: request.sso, sig: request.sig });
}

export function parseStoredOpaqueForumsConnectRequest(value: string | null) {
  if (!value || value.length > 5_000) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== "sig" || keys[1] !== "sso") return null;
    return plausibleOpaqueForumsConnectRequest(record.sso, record.sig);
  } catch {
    return null;
  }
}

export function resolveOpaqueForumsConnectBrowserRequest({
  searchParams,
  storage,
  scrubQuery,
}: Readonly<{
  searchParams: SearchParamsReader;
  storage: BrowserRequestStorage;
  scrubQuery: () => void;
}>) {
  const hasRequestQuery = [...searchParams.keys()].length > 0;
  const queryRequest = opaqueForumsConnectRequestFromSearch(searchParams);

  if (hasRequestQuery) {
    try {
      scrubQuery();
    } catch {
      try {
        storage.removeItem(FORUMS_CONNECT_REQUEST_STORAGE_KEY);
      } catch {
        // The storage boundary is unavailable; no request will be processed.
      }
      return { request: null, storageAvailable: false } as const;
    }

    try {
      if (queryRequest) {
        storage.setItem(
          FORUMS_CONNECT_REQUEST_STORAGE_KEY,
          serializeOpaqueForumsConnectRequest(queryRequest),
        );
      } else {
        storage.removeItem(FORUMS_CONNECT_REQUEST_STORAGE_KEY);
      }
      return { request: queryRequest, storageAvailable: true } as const;
    } catch {
      try {
        storage.removeItem(FORUMS_CONNECT_REQUEST_STORAGE_KEY);
      } catch {
        // The storage boundary is already unavailable; keep the failure redacted.
      }
      return { request: null, storageAvailable: false } as const;
    }
  }

  try {
    const resumedRequest = parseStoredOpaqueForumsConnectRequest(
      storage.getItem(FORUMS_CONNECT_REQUEST_STORAGE_KEY),
    );
    if (!resumedRequest) {
      storage.removeItem(FORUMS_CONNECT_REQUEST_STORAGE_KEY);
    }
    return { request: resumedRequest, storageAvailable: true } as const;
  } catch {
    return { request: null, storageAvailable: false } as const;
  }
}
