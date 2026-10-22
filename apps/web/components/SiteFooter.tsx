import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { OfficialGuildProfiles } from "@/components/OfficialGuildProfiles";
import type { HeaderAuthState } from "@/components/site-header/header-navigation";
import { SpinnerViewerNavLink } from "@/components/site-header/spinner-viewer-nav-link";
import { DISCORD_INVITE_URL, FORUMS_HOST, SOCIAL_HOST } from "@/lib/public-urls";
import { accountWorkflowLinks } from "@/lib/site-navigation";
import type { HomeRecruitment } from "@/lib/home-recruitment";

type FooterLink = {
  href: string;
  label: string;
  external?: boolean;
};

const guildLinks = [
  { href: "/", label: "Home" },
  { href: "/spotlight", label: "Spotlight" },
  { href: "/gallery", label: "Gallery" },
  { href: SOCIAL_HOST, label: "Social", external: true },
  { href: FORUMS_HOST, label: "Forums", external: true },
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
          <a className="footer-nav" href={link.href} key={`${title}-${link.href}`}>
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
  homeRecruitment,
}: {
  authState: HeaderAuthState;
  launchSpinnerViewer: () => Promise<boolean>;
  homeRecruitment?: HomeRecruitment;
}) {
  const year = new Date().getFullYear();
  const displayedGuildLinks = homeRecruitment ? guildLinks.map((link) => link.href === SOCIAL_HOST || link.href === FORUMS_HOST
    ? { ...link, label: `${link.label} (Coming Soon)` } : link) : guildLinks;
  const displayedCultureLinks = homeRecruitment ? cultureLinks.map((link) => link.href === "/join"
    ? { ...link, label: "Joining Guide" } : link) : cultureLinks;

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
                Mōchirīī is an Asia Pacific Where Winds Meet guild for casual players, guild events, and member projects.
              </p>

              <div className="footer-actions">
                {homeRecruitment ? (
                  homeRecruitment.open ? (
                    <a className="footer-cta" href={homeRecruitment.href} target="_blank" rel="noopener noreferrer">
                      {homeRecruitment.label}<span className="footer-cta-glint" aria-hidden="true" />
                    </a>
                  ) : (
                    <Link className="footer-cta" href={homeRecruitment.href}>{homeRecruitment.label}</Link>
                  )
                ) : <a
                  className="footer-cta"
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Join Mōchirīī on Discord"
                >
                  Join Mōchirīī<span className="footer-cta-glint" aria-hidden="true" />
                </a>}

                <Link className="footer-link" href="/recruitment">
                  View Recruitment
                </Link>
              </div>
            </div>
          </div>

          <div className="footer-cols" aria-label="Footer navigation">
            <FooterColumn title="Guild" links={displayedGuildLinks} />
            <FooterColumn title="Culture" links={displayedCultureLinks} />
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
            <OfficialGuildProfiles placement="footer" />
          </div>
        </div>

        <div className="footer-bottom">
          <div className="footer-meta">
            <span id="copyright-text">© {year} Mōchirīī</span>
            <span className="dot" aria-hidden="true">•</span>
            <span className="footer-dim">Where Winds Meet</span>
          </div>
          <nav className="footer-legal" aria-label="Privacy and support">
            <Link href="/privacy">Privacy</Link>
            <Link href="/meta-data-deletion">Data Deletion</Link>
            <a href="mailto:support@mochirii.com">support@mochirii.com</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
