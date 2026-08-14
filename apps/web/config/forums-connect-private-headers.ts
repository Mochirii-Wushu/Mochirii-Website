export const forumsConnectPrivateHeaders = [
  {
    key: "Cache-Control",
    value: "private, no-store, max-age=0",
  },
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet, noimageindex",
  },
  {
    key: "Referrer-Policy",
    value: "no-referrer",
  },
] as const;
