import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { SiteRouteShell } from "@/components/SiteRouteShell";
import { SITE_ORIGIN } from "@/lib/public-urls";
import { SITE_DESCRIPTION, SITE_LANGUAGE, SITE_OG_LOCALE, SITE_TITLE } from "@/lib/site-metadata";
import "./styles/font-fallbacks.css";
import "./styles/tokens-base.css";
import "./styles/shared-ui.css";
import "./styles/shell-header-nav.css";
import "./styles/shell-mobile-menu.css";
import "./styles/shell-footer.css";
import "./styles/shell-official-guild-profiles.css";

const displayFont = localFont({
  src: "./fonts/zhi-mang-xing-latin.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  preload: true,
  fallback: ["Zhi Mang Xing Fallback"],
  adjustFontFallback: false,
  variable: "--font-zhi-mang",
});

const bodyFont = localFont({
  src: "./fonts/noto-serif-sc-latin.woff2",
  weight: "400 600",
  style: "normal",
  display: "swap",
  preload: true,
  fallback: ["Noto Serif SC Fallback"],
  adjustFontFallback: false,
  variable: "--font-noto-serif-sc",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "Mōchirīī",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: SITE_OG_LOCALE,
    url: SITE_ORIGIN,
    images: [
      {
        url: "/assets/img/hero/hero.webp",
        width: 1536,
        height: 1024,
        alt: "Hero artwork for Mōchirīī guild",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/assets/img/hero/hero.webp"],
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/assets/img/brand/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0c0e",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang={SITE_LANGUAGE} className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body data-page="home">
        <SiteRouteShell>{children}</SiteRouteShell>
      </body>
    </html>
  );
}
