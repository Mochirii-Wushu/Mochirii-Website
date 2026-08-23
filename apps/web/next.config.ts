import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { forumsConnectPrivateHeaders } from "./config/forums-connect-private-headers";
import publicUrls from "./config/public-urls.json";

const appRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(appRoot, "../..");

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://cdn.discordapp.com https://media.discordapp.net https://i.scdn.co https://*.scdn.co",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "frame-src 'self' https://discord.com https://open.spotify.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://discord.com https://cdn.discordapp.com https://vitals.vercel-insights.com",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const spinnerContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "Access-Control-Allow-Origin",
    value: publicUrls.siteOrigin,
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin-allow-popups",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
] as const;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  skipTrailingSlashRedirect: true,
  outputFileTracingRoot: workspaceRoot,
  outputFileTracingIncludes: {
    "/spinner/media/render": [
      "./server-assets/spinner-fonts/**/*",
      "./app/fonts/OFL-Noto-Serif-SC.txt",
      "./node_modules/@napi-rs/canvas/LICENSE",
      "./node_modules/@napi-rs/webcodecs/LICENSE",
      "./public/assets/img/backgrounds/main.webp",
      "./public/assets/img/brand/emblem.webp",
      "./public/assets/img/raffles/hero.webp",
      "./public/assets/img/spinner/mochirii-banner.webp",
    ],
  },
  serverExternalPackages: ["@napi-rs/canvas", "@napi-rs/webcodecs"],
  turbopack: {
    root: workspaceRoot,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [...securityHeaders],
      },
      {
        source: "/forums/connect",
        headers: [...forumsConnectPrivateHeaders],
      },
      {
        source: "/spinner/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: spinnerContentSecurityPolicy,
          },
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
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/join.html", destination: "/join", permanent: true },
      { source: "/gallery.html", destination: "/gallery", permanent: true },
      { source: "/leaders.html", destination: "/leaders", permanent: true },
      { source: "/tome.html", destination: "/tome", permanent: true },
      { source: "/ranks.html", destination: "/ranks", permanent: true },
      { source: "/events.html", destination: "/events", permanent: true },
      { source: "/announcements.html", destination: "/announcements", permanent: true },
      { source: "/raffles", destination: "/raffle", permanent: true },
      { source: "/raffles.html", destination: "/raffle", permanent: true },
      { source: "/recruitment.html", destination: "/recruitment", permanent: true },
      { source: "/auth.html", destination: "/auth", permanent: true },
      { source: "/account.html", destination: "/account", permanent: true },
      { source: "/social.html", destination: "/social", permanent: true },
      { source: "/gallery-submit.html", destination: "/gallery-submit", permanent: true },
      { source: "/spotify.html", destination: "/spotify", permanent: true },
      { source: "/spotlight.html", destination: "/spotlight", permanent: true },
      { source: "/twills.html", destination: "/twills", permanent: true },
      { source: "/leader-dashboard.html", destination: "/leader-dashboard", permanent: true },
    ];
  },
};

export default nextConfig;
