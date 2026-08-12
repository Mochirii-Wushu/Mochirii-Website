import "./styles/public-content-shared.css";
import "./styles/public-home-seal.css";
import "./styles/public-home-media.css";
import "./styles/public-home-bulletins.css";
import "./styles/public-home-doors.css";
import "./styles/public-home-visual.css";
import "./styles/shell-gallery-media.css";
import "./styles/shell-lightbox.css";
import { Fragment } from "react";
import Link from "next/link";
import homeData from "@/public/data/home.json";
import galleryData from "@/public/data/gallery.json";
import guildScheduleData from "@/public/data/guild-schedule.json";
import { HomeGallerySpotlight } from "@/components/HomeGallerySpotlight";
import { type GallerySpotlightItem } from "@/components/HomeGalleryLightbox";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";
import { SpotlightWinnerTitle } from "@/components/public-pages/SpotlightWinnerTitle";
import { StaticImage } from "@/components/public-pages/common";
import { monthlyScheduleDate } from "@/lib/guild-schedule";
import { DISCORD_INVITE_URL, SITE_ORIGIN, SOCIAL_HOST } from "@/lib/public-urls";
import { SITE_DESCRIPTION, SITE_LANGUAGE } from "@/lib/site-metadata";

export const revalidate = 3600;

type HomeData = typeof homeData;
type GalleryData = typeof galleryData;
type Bulletin = HomeData["bulletins"][number];
type DoorTile = HomeData["tiles"][number];
type GalleryAlbumItem = GalleryData["albums"][number]["items"][number];

const organizationId = `${SITE_ORIGIN}/#organization`;
const websiteId = `${SITE_ORIGIN}/#website`;
const homeStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": websiteId,
      url: `${SITE_ORIGIN}/`,
      name: "Mōchirīī",
      alternateName: "Mōchī",
      description: SITE_DESCRIPTION,
      inLanguage: SITE_LANGUAGE,
      publisher: { "@id": organizationId },
    },
    {
      "@type": "Organization",
      "@id": organizationId,
      url: `${SITE_ORIGIN}/`,
      name: "Mōchirīī",
      alternateName: "Mōchī",
      logo: {
        "@type": "ImageObject",
        url: `${SITE_ORIGIN}/assets/img/brand/social-card.png`,
      },
      areaServed: "Asia Pacific",
      sameAs: [SOCIAL_HOST],
    },
  ],
};

function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

async function OptionalBirthdaySplash({
  config,
}: {
  config: HomeData["celebrationSplash"];
}) {
  if (config.enabled !== true) return null;

  const { HomeBirthdaySplash } = await import("@/components/HomeBirthdaySplash");
  return <HomeBirthdaySplash config={config} />;
}

const htmlRouteMap = new Map<string, string>([
  ["index.html", "/"],
  ["join.html", "/join"],
  ["gallery.html", "/gallery"],
  ["leaders.html", "/leaders"],
  ["ranks.html", "/ranks"],
  ["tome.html", "/tome"],
  ["events.html", "/events"],
  ["announcements.html", "/announcements"],
  ["raffles.html", "/raffle"],
  ["recruitment.html", "/recruitment"],
  ["auth.html", "/auth"],
  ["account.html", "/account"],
  ["social.html", "/social"],
  ["gallery-submit.html", "/gallery-submit"],
  ["spotify.html", "/spotify"],
  ["spotlight.html", "/spotlight"],
  ["twills.html", "/twills"],
  ["leader-dashboard.html", "/leader-dashboard"],
]);

function cleanLabel(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function optionalText(record: object, key: string) {
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function publicPath(value: unknown, fallback = "") {
  const raw = String(value ?? "").trim() || fallback;
  if (!raw) return "";
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(raw)) return raw;
  if (raw.startsWith("./")) return `/${raw.slice(2)}`;
  return `/${raw}`;
}

function cleanRoute(value: unknown, fallback = "#") {
  const raw = String(value ?? "").trim() || fallback;
  if (/^(https?:|mailto:|tel:|#)/i.test(raw)) return raw;

  const match = raw.match(/^(?:\.\/|\/)?([^?#]+\.html)([?#].*)?$/i);
  if (!match) return raw.startsWith("./") ? raw.slice(1) : raw;

  const mapped = htmlRouteMap.get(match[1].toLowerCase());
  return mapped ? `${mapped}${match[2] || ""}` : raw;
}

function formatDateUTC(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return raw;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function typeLabel(value: unknown) {
  const type = cleanLabel(value).toLowerCase();
  const labels: Record<string, string> = {
    event: "Event",
    raffle: "Raffle",
    announcement: "Announcement",
    member: "Member",
    meta: "Update",
  };

  return labels[type] || "Update";
}

function joinLabel(parts: unknown[]) {
  return parts.map(cleanLabel).filter(Boolean).join(" - ");
}

function pickFeatured(bulletins: Bulletin[]) {
  return bulletins.find((item) => item.pinned === true) || bulletins[0] || null;
}

function normalizeSlug(value: unknown) {
  return cleanLabel(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function galleryCategory(item: GalleryAlbumItem) {
  if ("categories" in item && Array.isArray(item.categories)) {
    return normalizeSlug(item.categories[0]);
  }

  return normalizeSlug(item.category);
}

function galleryHref(category: string) {
  return category ? `/gallery?category=${encodeURIComponent(category)}` : "/gallery";
}

function normalizeGalleryItem(
  item: GalleryAlbumItem,
): GallerySpotlightItem & { href: string; addedAt: string } | null {
  const full = publicPath(item.full || item.src);
  const image = publicPath(item.thumb || item.src || item.full);
  if (!full || !image) return null;

  const category = galleryCategory(item);
  const alt = cleanLabel(item.alt || item.caption || "Gallery image");
  const caption = cleanLabel(item.caption);

  return {
    key: cleanLabel(item.id || full || image),
    image,
    full,
    alt,
    caption,
    href: galleryHref(category),
    addedAt: cleanLabel(item.galleryAddedAt),
  };
}

function getGallerySpotlightCandidates(data: GalleryData): GallerySpotlightItem[] {
  const seen = new Set<string>();
  return data.albums
    .flatMap((album) => album.items)
    .map((item) => normalizeGalleryItem(item))
    .filter((item): item is GallerySpotlightItem & { href: string; addedAt: string } => Boolean(item))
    .filter((item) => {
      if (seen.has(item.full)) return false;
      seen.add(item.full);
      return true;
    });
}

function getFallbackGallerySpotlightItems(fallback: HomeData["gallery"]): GallerySpotlightItem[] {
  return fallback
    .map((item, index) => ({
      key: `home-gallery-${index}`,
      image: publicPath(item.image),
      full: publicPath(item.full || item.image),
      alt: cleanLabel(item.alt || "Guild screenshot"),
      caption: cleanLabel(optionalText(item, "caption")),
    }))
    .filter((item) => item.image && item.full);
}

function Descriptor({ lines }: { lines: string[] }) {
  if (!lines.length) {
    return <p className="muted">No description provided.</p>;
  }

  return lines.map((line) => <p key={line}>{line}</p>);
}

function SealVerse({ lines }: { lines: string[] }) {
  if (!lines.length) return <>—</>;

  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={line}>
          {line}
          {index < lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </>
  );
}

function BulletinList({ items }: { items: Bulletin[] }) {
  return (
    <div id="bulletinList" className="home-bulletins" aria-label="More bulletins">
      {items.slice(0, 5).map((item) => {
        const date = monthlyScheduleDate(guildScheduleData, optionalText(item, "scheduleId"), item.date);
        return (
          <a className="home-bulletin" href={cleanRoute(item.href)} key={item.title}>
            <div className="home-bulletin__media">
              <StaticImage
                className="home-bulletin__img"
                src={publicPath(item.image, "/assets/img/bulletins/featured.webp")}
                alt={cleanLabel(item.imageAlt || "Bulletin cover")}
                width={960}
                height={600}
                sizes="(max-width: 900px) calc(100vw - 68px), 320px"
              />
              <div className="home-bulletin__scrim" aria-hidden="true" />
              <div className="home-bulletin__tag">{typeLabel(item.type)}</div>
            </div>
            <div className="home-bulletin__body">
              <div className="home-bulletin__date">{formatDateUTC(date)}</div>
              <div className="home-bulletin__title">{item.title}</div>
              <div className="home-bulletin__summary">{optionalText(item, "summary")}</div>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function DoorGrid({ tiles }: { tiles: DoorTile[] }) {
  return (
    <div id="doorsGrid" className="home-doors" aria-label="Door links">
      {tiles.slice(0, 4).map((tile) => (
        <a className="home-door" href={cleanRoute(tile.href)} key={tile.label}>
          <div className="home-door__media">
            <StaticImage
              className="home-door__img"
              src={publicPath(tile.image)}
              alt={cleanLabel(tile.alt)}
              width={960}
              height={600}
              sizes="(max-width: 900px) calc(100vw - 68px), 280px"
            />
            <div className="home-door__scrim" aria-hidden="true" />
            <div className="home-door__label">{tile.label}</div>
          </div>
          <div className="home-door__plate">
            <div className="home-door__title">{tile.title}</div>
            <div className="home-door__subtitle">{optionalText(tile, "subtitle")}</div>
          </div>
        </a>
      ))}
    </div>
  );
}

export default function Home() {
  const heroDescriptor = homeData.hero.descriptor.map(cleanLabel).filter(Boolean);
  const heroBadges = homeData.hero.badges.map(cleanLabel).filter(Boolean);
  const sealVerse = homeData.seal.verse.map(cleanLabel).filter(Boolean);
  const featured = pickFeatured(homeData.bulletins);
  const secondaryBulletins = homeData.bulletins.filter((item) => item !== featured);
  const galleryItems = getGallerySpotlightCandidates(galleryData);
  const fallbackGalleryItems = getFallbackGallerySpotlightItems(homeData.gallery);
  const spotlight = homeData.spotlight;
  const featuredDate = featured ? monthlyScheduleDate(guildScheduleData, optionalText(featured, "scheduleId"), featured.date) : "";

  return (
    <>
      <script
        id="home-structured-data"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(homeStructuredData) }}
      />
      <BodyPageMarker page="home" />
      <OptionalBirthdaySplash config={homeData.celebrationSplash} />
      <header className="page-hero-shell" aria-label="Home hero">
        <div className="container">
          <section className="page-hero page-hero--tall">
            <StaticImage
              id="heroImage"
              src={publicPath(homeData.hero.image, "/assets/img/hero/hero.webp")}
              alt="Hero artwork for Mōchirīī guild"
              className="page-hero__img"
              width="1536"
              height="1024"
              priority
              sizes="(max-width: 1232px) calc(100vw - 32px), 1200px"
            />
            {homeData.hero.atmosphereImage ? (
              <StaticImage
                id="heroAtmosphere"
                src={publicPath(homeData.hero.atmosphereImage)}
                alt=""
                className="page-hero__atmos"
                width={1536}
                height={1024}
                sizes="(max-width: 1232px) calc(100vw - 32px), 1200px"
                aria-hidden="true"
              />
            ) : null}
          </section>
        </div>

        <div className="container hero-overlap">
          <div className="home-hero-row">
            <section className="glass-card glass-card--strong glass-pad hero-intro">
              <p className="kicker" id="homeKicker">Jianghu Guild Hall</p>
              <h1 className="display-title" id="homeHeading">Mōchirīī</h1>
              <p className="meta-text u-mt-10" id="homeSubtitle">
                {homeData.hero.subtitle}
              </p>

              <div id="heroDescriptor" className="prose-stack" aria-live="polite">
                <Descriptor lines={heroDescriptor} />
              </div>

              <div className="badge-row" id="heroBadges" aria-label="Guild badges">
                {heroBadges.slice(0, 8).map((badge) => (
                  <span key={badge}>{badge}</span>
                ))}
              </div>

              <div className="hero-cta-row" aria-label="Primary actions">
                <a
                  className="hero-cta hero-cta--primary"
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Join Discord
                </a>
                <Link className="hero-cta" href="/join">
                  How to Join
                </Link>
              </div>
            </section>

            <aside className="home-guild-seal" aria-label="Guild seal">
              <StaticImage
                id="sealImage"
                src={publicPath(homeData.seal.image, "/assets/img/brand/emblem.webp")}
                alt={cleanLabel(homeData.seal.imageAlt || "Mōchirīī guild seal")}
                width="1024"
                height="1024"
                sizes="(max-width: 640px) 128px, 116px"
              />
              <h2 id="sealTitle" className="home-seal-title">
                {homeData.seal.title}
              </h2>
              <p id="sealVerse" className="home-seal-verse muted">
                <SealVerse lines={sealVerse} />
              </p>
            </aside>
          </div>
        </div>
      </header>

      <main className="page-main" id="main">
        <div className="container">
          <section
            className="glass-card glass-card--primary glass-pad"
            aria-label="Guild bulletin"
          >
            <h2 className="section-title">Guild Bulletin</h2>
            <p className="muted" id="bulletinIntro">
              {homeData.copy.bulletinIntro}
            </p>

            {featured ? (
              <a
                id="featuredBulletin"
                className="home-featured"
                href={cleanRoute(featured.href)}
              >
                <StaticImage
                  id="featuredBulletinImage"
                  src={publicPath(featured.image, "/assets/img/bulletins/featured.webp")}
                  alt={cleanLabel(featured.imageAlt)}
                  className="home-featured__img"
                  width={1280}
                  height={720}
                  sizes="(max-width: 1232px) calc(100vw - 68px), 1120px"
                />
                <div className="home-featured__scrim" aria-hidden="true" />

                <div className="home-featured__meta">
                  <span id="featuredBulletinType" className="home-pill">
                    {typeLabel(featured.type)}
                  </span>
                  <span id="featuredBulletinDate" className="home-date">
                    {formatDateUTC(featuredDate)}
                  </span>
                </div>

                <div className="home-featured__plate">
                  <h3 id="featuredBulletinTitle" className="home-title">
                    {featured.title}
                  </h3>
                  <p id="featuredBulletinSummary" className="home-summary">
                    {optionalText(featured, "summary")}
                  </p>
                </div>
              </a>
            ) : null}

            <BulletinList items={secondaryBulletins} />
          </section>

          <section
            className="glass-card glass-card--primary glass-pad u-mt-24"
            aria-label="Four doors"
          >
            <h2 className="section-title">Four Doors</h2>
            <p className="muted" id="doorsIntro">
              {homeData.copy.doorsIntro}
            </p>
            <DoorGrid tiles={homeData.tiles} />
          </section>

          <section
            className="glass-card glass-card--primary glass-pad u-mt-24"
            aria-label="Member spotlight"
          >
            <h2 className="section-title">Member Spotlight</h2>
            <p className="muted" id="spotlightIntro">
              {homeData.copy.spotlightIntro}
            </p>

            <div
              id="spotlightCard"
              className="home-spotlight"
              role="group"
              aria-label={joinLabel([
                "Member spotlight",
                spotlight.tag,
                spotlight.summary,
                "Spotlight Appreciation",
              ])}
            >
              <StaticImage
                id="spotlightImage"
                src={publicPath(spotlight.image, "/assets/img/featured/spotlight.webp")}
                alt={cleanLabel(spotlight.imageAlt)}
                className="home-spotlight__img"
                width={1536}
                height={1024}
                sizes="(max-width: 1232px) calc(100vw - 68px), 1120px"
              />
              <div className="home-spotlight__scrim" aria-hidden="true" />
              <Link
                className="home-spotlight__surface-link"
                href={cleanRoute(spotlight.href)}
                aria-label={joinLabel([
                  "Open member spotlight",
                  spotlight.tag,
                  spotlight.summary,
                  "Spotlight Appreciation",
                ])}
              >
                <span className="sr-only">Spotlight Appreciation</span>
              </Link>

              <div className="home-spotlight__plate">
                <span id="spotlightTag" className="home-pill">
                  {spotlight.tag}
                </span>
                <h3 id="spotlightTitle" className="home-title">
                  <SpotlightWinnerTitle fallbackTitle={spotlight.title} template="home" />
                </h3>
                <p id="spotlightSummary" className="home-summary">
                  {spotlight.summary}
                </p>
                <span className="home-link" aria-hidden="true">
                  Spotlight Appreciation
                </span>
              </div>
            </div>
          </section>

          <section
            className="glass-card glass-card--primary glass-pad u-mt-24"
            aria-label="Screenshot spotlight"
          >
            <h2 className="section-title">Screenshot Spotlight</h2>
            <p className="muted" id="galleryIntro">
              {homeData.copy.galleryIntro}
            </p>
            <HomeGallerySpotlight candidates={galleryItems} fallbackItems={fallbackGalleryItems} />
          </section>
        </div>
      </main>
    </>
  );
}
