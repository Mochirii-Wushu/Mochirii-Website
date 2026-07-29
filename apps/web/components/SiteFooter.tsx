import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { HeaderAuthState } from "@/components/site-header/header-navigation";
import { SpinnerViewerNavLink } from "@/components/site-header/spinner-viewer-nav-link";
import {
  DISCORD_INVITE_URL,
  OFFICIAL_GUILD_CHANNELS,
  SITE_DISPLAY_NAME,
  SOCIAL_HOST,
} from "@/lib/public-urls";
import { accountWorkflowLinks } from "@/lib/site-navigation";

type FooterLink = {
  href: string;
  label: string;
  external?: boolean;
  newTab?: boolean;
};

const guildLinks = [
  { href: "/", label: "Home" },
  { href: "/spotlight", label: "Spotlight" },
  { href: "/gallery", label: "Gallery" },
  { href: SOCIAL_HOST, label: "Social", external: true },
  { href: "/games/mochi-pets", label: "Mochi Pets" },
] satisfies FooterLink[];

const cultureLinks = [
  { href: "/join", label: "Join" },
  { href: "/ranks", label: "Ranks" },
  { href: "/leaders", label: "Leaders" },
  { href: "/tome", label: "Tome" },
  { href: "/spotify", label: "Playlists" },
] satisfies FooterLink[];

const updateLinks = [
  { href: "/announcements", label: "Announcements" },
  { href: "/events", label: "Events" },
  { href: "/raffle", label: "Raffle" },
] satisfies FooterLink[];

const channelLinks = OFFICIAL_GUILD_CHANNELS.map((link) => ({
  ...link,
  external: true,
  newTab: true,
})) satisfies FooterLink[];

function FooterColumn({
  title,
  links,
  children,
}: {
  title: string;
  links: FooterLink[];
  children?: ReactNode;
}) {
  return (
    <div className="footer-col">
      <div className="footer-col-title">{title}</div>
      {links.map((link) => (
        link.external ? (
          <a
            className="footer-nav"
            href={link.href}
            key={`${title}-${link.href}`}
            target={link.newTab ? "_blank" : undefined}
            rel={link.newTab ? "noopener noreferrer" : undefined}
          >
            {link.label}
          </a>
        ) : (
          <Link className="footer-nav" href={link.href} key={`${title}-${link.href}`}>
            {link.label}
          </Link>
        )
      ))}
      {children}
    </div>
  );
}

const spinnerViewerLink = accountWorkflowLinks.find((item) => item.auth === "spinner-viewer");

export function SiteFooter({
  authState,
  launchSpinnerViewer,
}: {
  authState: HeaderAuthState;
  launchSpinnerViewer: () => Promise<boolean>;
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="footer-wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <Link className="footer-brand-link" href="/">
              <Image
                className="footer-emblem"
                src="/assets/img/brand/emblem.webp"
                alt=""
                width={56}
                height={56}
                sizes="56px"
              />
              <span className="brand-text">
                <span className="brand-name">Mōchirīī</span>
                <span className="brand-sub">Asia Pacific Guild</span>
              </span>
            </Link>

            <div className="footer-brand-text">
              <p className="footer-desc">
                An Asia Pacific Where Winds Meet guild, with events scheduled in UTC+8.
              </p>

              <div className="footer-actions">
                <a
                  className="footer-cta"
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Join Mōchirīī on Discord"
                >
                  Join<span className="footer-cta-glint" aria-hidden="true" />
                </a>

                <Link className="footer-link" href="/recruitment">
                  Recruitment Tips
                </Link>
              </div>
            </div>
          </div>

          <div className="footer-cols" aria-label="Footer navigation">
            <FooterColumn title="Guild" links={guildLinks} />
            <FooterColumn title="Culture" links={cultureLinks} />
            <FooterColumn title="Updates" links={updateLinks}>
              {spinnerViewerLink ? (
                <SpinnerViewerNavLink
                  item={spinnerViewerLink}
                  className="footer-nav"
                  hidden={!authState.spinnerViewer}
                  launchSpinnerViewer={launchSpinnerViewer}
                />
              ) : null}
            </FooterColumn>
            <FooterColumn title="Channels" links={channelLinks} />
          </div>
        </div>

        <div className="footer-bottom">
          <div className="footer-meta">
            <span id="copyright-text">© {year} Mōchirīī</span>
            <span className="dot" aria-hidden="true">•</span>
            <span className="footer-dim">{SITE_DISPLAY_NAME}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
