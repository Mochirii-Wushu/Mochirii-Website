const NONCE_RE = /^[A-Fa-f0-9]{32}$/;

export function protectedPageContentSecurityPolicy(nonce: string) {
  if (!NONCE_RE.test(nonce)) throw new Error("A valid request nonce is required.");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://cdn.discordapp.com https://media.discordapp.net",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://discord.com https://cdn.discordapp.com https://vitals.vercel-insights.com",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}
