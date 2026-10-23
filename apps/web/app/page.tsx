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
import raffleData from "@/public/data/raffles.json";
import recruitmentData from "@/public/data/recruitment.json";
import { HomeGallerySpotlight } from "@/components/HomeGallerySpotlight";
import { type GallerySpotlightItem } from "@/components/HomeGalleryLightbox";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";
import { HomeNextEvent } from "@/components/public-pages/HomeNextEvent";
import { SpotlightWinnerTitle } from "@/components/public-pages/SpotlightWinnerTitle";
import { spotlightWinnerName } from "@/components/public-pages/spotlight-content";
import { StaticImage } from "@/components/public-pages/common";
import { formatPublicDate } from "@/lib/public-date";
import { publicGuildSchedule } from "@/lib/events/public-schedule";
import { getHomeRecruitment } from "@/lib/home-recruitment";
import { SITE_ORIGIN, SOCIAL_HOST } from "@/lib/public-urls";
import { SITE_DESCRIPTION, SITE_LANGUAGE } from "@/lib/site-metadata";
import { navGroups } from "@/lib/site-navigation";
import { getCurrentSpotlightWinner } from "@/lib/supabase/spotlight";

export const dynamic = "force-dynamic";

type HomeData = typeof homeData;
type GalleryData = typeof galleryData;
type Bulletin = HomeData["bulletins"][number];
type DoorTile = HomeData["tiles"][number];
type GalleryAlbumItem = GalleryData["albums"][number]["items"][number];

const homeGalleryPresentation = new Map<string, { alt: string; accessibleLabel: string }>([
  ["shot-01", {
    alt: "Character standing among pink flowers",
    accessibleLabel: "Open screenshot of a character standing among pink flowers",
  }],
  ["shot-02", {
    alt: "Armored character during combat",
    accessibleLabel: "Open screenshot of an armored character during combat",
  }],
  ["shot-03", {
    alt: "White-robed character using an emote",
    accessibleLabel: "Open screenshot of a white-robed character using an emote",
  }],
  ["shot-04", {
    alt: "Party facing a horned enemy in a cave",
    accessibleLabel: "Open screenshot of a party facing a horned enemy in a cave",
  }],
]);

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

function formatDate(value: unknown, timeZone = "UTC") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(date.valueOf())) return raw;

  return formatPublicDate(date, timeZone);
}

function spotlightRecognition(
  spotlight: HomeData["spotlight"],
  winner: Awaited<ReturnType<typeof getCurrentSpotlightWinner>>,
) {
  const winnerName = spotlightWinnerName(winner);
  if (!winnerName || !winner?.monthKey) return null;

  return spotlight.recognitions.find((item) => (
    cleanLabel(item.monthKey) === winner.monthKey
  )) || null;
}

function bulletinPresentation(item: Bulletin, date: string) {
  const type = cleanLabel(item.type).toLowerCase();
  const title = cleanLabel(item.title);

  if (type === "event") {
    const eventTitle = title || "No event is scheduled.";
    return {
      label: "Next Event",
      date: date ? `${formatDate(date)} • UTC+8` : "",
      title: eventTitle,
      ariaLabel: title ? `View ${eventTitle} details` : "View all events",
      cta: "View All Events",
    };
  }

  if (type === "raffle") {
    if (raffleData.publicView.cycleStatus === "open") {
      const raffleTitle = cleanLabel(raffleData.programName) || title || "Current raffle";
      const closesAt = cleanLabel(raffleData.publicView.closesAt);
      return {
        label: "Current Raffle",
        date: closesAt ? `Closes ${formatDate(closesAt, "Asia/Singapore")}` : "",
        title: raffleTitle,
        ariaLabel: `View ${raffleTitle} details`,
        cta: "View the Raffle",
      };
    }

    return {
      label: "Raffle Status",
      date: date ? `Updated ${formatDate(date)}` : "",
      title: "No raffle is open.",
      ariaLabel: "View the raffle page",
      cta: "View Raffle History",
    };
  }

  if (type === "announcement") {
    return {
      label: "Guild Announcement",
      date: formatDate(date),
      title: title || "No announcement has been posted.",
      ariaLabel: title === "Leadership roles are open."
        ? "Read the leadership announcement"
        : "Read the announcement",
      cta: "View All Announcements",
    };
  }

  return {
    label: "Guild Update",
    date: formatDate(date),
    title: title || "No update has been posted.",
    ariaLabel: "View the guild update",
    cta: "View Updates",
  };
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
  const presentation = homeGalleryPresentation.get(cleanLabel(item.id));
  const alt = presentation?.alt || cleanLabel(item.alt || item.caption || "Gallery image");
  const caption = cleanLabel(item.caption);

  return {
    key: cleanLabel(item.id || full || image),
    image,
    full,
    alt,
    caption,
    accessibleLabel: presentation?.accessibleLabel,
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
      accessibleLabel: [...homeGalleryPresentation.values()][index]?.accessibleLabel,
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
        const date = item.date;
        const presentation = bulletinPresentation(item, date);
        return (
          <a
            className="home-bulletin"
            data-quiet={cleanLabel(item.type).toLowerCase() === "raffle" && raffleData.publicView.cycleStatus !== "open"}
            href={cleanRoute(item.href)}
            aria-label={presentation.ariaLabel}
            key={item.title}
          >
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
              <div className="home-bulletin__tag">{presentation.label}</div>
            </div>
            <div className="home-bulletin__body">
              <div className="home-bulletin__date">{presentation.date}</div>
              <h3 className="home-bulletin__title">{presentation.title}</h3>
              {optionalText(item, "summary") ? (
                <p className="home-bulletin__summary">{optionalText(item, "summary")}</p>
              ) : null}
              <span className="home-link" aria-hidden="true">{presentation.cta}</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function DoorGrid({ tiles }: { tiles: DoorTile[] }) {
  return (
    <div id="doorsGrid" className="home-doors" aria-label="Guild guide links" data-motion-key="home-resources">
      {tiles.slice(0, 4).map((tile) => (
        <Link className="home-door" href={cleanRoute(tile.href)} key={tile.href}>
          <h3 className="home-door__label">{tile.label}</h3>
          <p className="home-door__title">{tile.title}</p>
          {optionalText(tile, "subtitle") ? (
            <p className="home-door__subtitle">{optionalText(tile, "subtitle")}</p>
          ) : null}
          <span className="home-link" aria-hidden="true">Open guide <span>→</span></span>
        </Link>
      ))}
    </div>
  );
}

function HomeEdge({ id, rose = false }: { id: string; rose?: boolean }) {
  return (
    <svg className="home-edge" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id}>
          <stop stopColor={rose ? "#bf9fab" : "#a0c7b1"} />
          <stop offset="1" stopColor="#c8a24b" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="100%" height="100%" rx="22" pathLength="100" vectorEffect="non-scaling-stroke" stroke={`url(#${id})`} />
    </svg>
  );
}

export default async function Home() {
  const winner = await getCurrentSpotlightWinner();
  const referenceTime = new Date().toISOString();
  const winnerName = spotlightWinnerName(winner);
  const recruitment = getHomeRecruitment(recruitmentData.meta.status);
  const heroDescriptor = homeData.hero.descriptor.map(cleanLabel).filter(Boolean);
  const heroBadges = [recruitment.statusLabel, ...homeData.hero.badges.map(cleanLabel).filter(Boolean)];
  const sealVerse = homeData.seal.verse.map(cleanLabel).filter(Boolean);
  const secondaryBulletins = homeData.bulletins.filter((item) => cleanLabel(item.type).toLowerCase() !== "event");
  const galleryItems = getGallerySpotlightCandidates(galleryData);
  const fallbackGalleryItems = getFallbackGallerySpotlightItems(homeData.gallery);
  const spotlight = homeData.spotlight;
  const recognition = spotlightRecognition(spotlight, winner);
  const spotlightSummary = winnerName
    ? recognition?.summary || spotlight.summary
    : spotlight.fallbackIntro;
  const spotlightOpenLabel = winnerName
    ? `Open ${winnerName}’s Member Spotlight`
    : "Open the Member Spotlight";
  const spotlightCta = winnerName
    ? `Read ${winnerName}’s Spotlight`
    : "Read the Member Spotlight";
  const eventCta = <span className="home-link">View All Events</span>;
  const resourceItems = navGroups.flatMap((group) => group.items);
  const communityResources = resourceItems.filter((item) => (
    ["gallery", "spotlight", "spotify", "games/mochi-pets"].includes(item.nav)
  ));
  const futureResources = resourceItems.filter((item) => (
    ["social-host", "forums-host"].includes(item.nav)
  ));

  return (
    <>
      <script
        id="home-structured-data"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(homeStructuredData) }}
      />
      <BodyPageMarker page="home" />
      <OptionalBirthdaySplash config={homeData.celebrationSplash} />
      <main className="home-page" id="main" tabIndex={-1}>
        <div className="container home-page__content">
          <section className="home-hero" aria-labelledby="homeHeading">
            <StaticImage
              id="heroImage"
              src={publicPath(homeData.hero.image, "/assets/img/hero/hero.webp")}
              alt=""
              className="home-hero__image"
              width={1536}
              height={1024}
              priority
              sizes="(max-width: 1232px) calc(100vw - 32px), 1200px"
            />
            {homeData.hero.atmosphereImage ? (
              <StaticImage
                id="heroAtmosphere"
                src={publicPath(homeData.hero.atmosphereImage)}
                alt=""
                className="home-hero__atmos"
                width={1536}
                height={1024}
                sizes="(max-width: 1232px) calc(100vw - 32px), 1200px"
              />
            ) : null}
            <div className="home-hero__content">
              <p className="kicker" id="homeKicker">SEA · UTC+8</p>
              <h1 className="display-title" id="homeHeading">Mōchirīī</h1>
              <div id="heroDescriptor" className="prose-stack">
                <Descriptor lines={heroDescriptor} />
              </div>
              <div className="badge-row" id="heroBadges" aria-label="Guild badges">
                {heroBadges.slice(0, 8).map((badge) => <span key={badge}>{badge}</span>)}
              </div>
              <div className="hero-cta-row" aria-label="Primary actions">
                <a
                  id="heroJoinCta"
                  className="hero-cta hero-cta--primary"
                  href={recruitment.href}
                  target={recruitment.open ? "_blank" : undefined}
                  rel={recruitment.open ? "noopener noreferrer" : undefined}
                >
                  {recruitment.label}
                </a>
                <Link className="hero-cta" href="/events">See Upcoming Events</Link>
              </div>
            </div>
          </section>

          <section className="home-section" aria-labelledby="homeEventHeading">
            <h2 className="section-title home-section__heading" id="homeEventHeading" data-motion-key="home-event-rule">Your guild event</h2>
            <Link id="featuredBulletin" className="home-featured" href="/events" data-motion-key="home-event" data-motion-featured="true">
              <HomeNextEvent
                referenceTime={referenceTime}
                scheduleData={publicGuildSchedule}
                imageSizes="(max-width: 767px) calc(100vw - 32px), (max-width: 1232px) 58vw, 700px"
                emptyState={(
                  <div className="home-featured__body" aria-live="polite">
                    <span id="featuredBulletinType" className="home-pill">Guild Events</span>
                    <h3 id="featuredBulletinTitle" className="home-title">No event is scheduled.</h3>
                    <p id="featuredBulletinDate" className="home-date">Check the UTC+8 schedule for the next event.</p>
                    {eventCta}
                  </div>
                )}
              >
                {eventCta}
              </HomeNextEvent>
              <HomeEdge id="home-event-edge" />
            </Link>
          </section>

          <section className="home-section" id="guild-activity" aria-labelledby="homeActivityHeading">
            <h2 className="section-title home-section__heading" id="homeActivityHeading" data-motion-key="home-activity-rule">Life in Mōchirīī</h2>
            <div className="home-activity" data-motion-key="home-activity">
              <section className="home-gallery-panel" aria-label="Guild gallery">
                <div className="home-card-heading">
                  <h3>Guild Gallery</h3>
                  <Link className="home-text-link" href="/gallery">View gallery <span aria-hidden="true">→</span></Link>
                </div>
                <p className="muted" id="galleryIntro">{homeData.copy.galleryIntro}</p>
                <HomeGallerySpotlight candidates={galleryItems} fallbackItems={fallbackGalleryItems} />
                <p className="home-gallery-hint">Select a screenshot to open the full image.</p>
              </section>

              <Link
                id="spotlightCard"
                className="home-spotlight"
                href={cleanRoute(spotlight.href)}
                aria-label={spotlightOpenLabel}
              >
                <StaticImage
                  id="spotlightImage"
                  src={publicPath(spotlight.image, "/assets/img/featured/spotlight.webp")}
                  alt="Member Spotlight artwork"
                  className="home-spotlight__img"
                  width={1536}
                  height={1024}
                  sizes="(max-width: 767px) calc(100vw - 32px), (max-width: 1232px) 40vw, 450px"
                />
                <div className="home-spotlight__plate">
                  <p id="spotlightTag" className="kicker">Member Spotlight</p>
                  <h3 id="spotlightTitle" className="home-title">
                    <SpotlightWinnerTitle fallbackTitle={spotlight.title} template="home" winner={winner} />
                  </h3>
                  <p id="spotlightSummary" className="home-summary">{spotlightSummary}</p>
                  <span className="home-link" aria-hidden="true">{spotlightCta} <span>→</span></span>
                </div>
              </Link>
            </div>

            <div className="home-updates" aria-label="Guild bulletin" data-motion-key="home-updates">
              <div className="home-card-heading">
                <h3>Guild updates</h3>
                <p className="muted" id="bulletinIntro">{homeData.copy.bulletinIntro}</p>
              </div>
              <BulletinList items={secondaryBulletins} />
            </div>
          </section>

          <section className="home-section" id="start-here" aria-labelledby="homeStartHeading">
            <h2 className="section-title home-section__heading" id="homeStartHeading" data-motion-key="home-start-rule">Start here</h2>
            <ol className="home-start" data-motion-key="home-start">
              <li>
                <span className="home-start__number" aria-hidden="true">1</span>
                <div>
                  <h3>Join Discord</h3>
                  <p>Open the guild Discord. A website account is optional.</p>
                  <a
                    className="home-text-link"
                    href={recruitment.href}
                    target={recruitment.open ? "_blank" : undefined}
                    rel={recruitment.open ? "noopener noreferrer" : undefined}
                  >
                    {recruitment.label} <span aria-hidden="true">→</span>
                  </a>
                </div>
              </li>
              <li>
                <span className="home-start__number" aria-hidden="true">2</span>
                <div>
                  <h3>Choose your guild channels</h3>
                  <p>Complete Double Counter verification, then select the channels for your interests.</p>
                </div>
              </li>
              <li>
                <span className="home-start__number" aria-hidden="true">3</span>
                <div>
                  <h3>Take part in an event</h3>
                  <p>Check the UTC+8 schedule and event notice before joining.</p>
                  <Link className="home-text-link" href="/events">See Events <span aria-hidden="true">→</span></Link>
                </div>
              </li>
            </ol>
            <div className="home-start__notes">
              <p>Verified-member website features require a separate sign-in and current guild membership checks.</p>
              <Link className="home-text-link" href="/join">Read the Joining Guide <span aria-hidden="true">→</span></Link>
            </div>
          </section>

          <section className="home-section" id="member-resources" aria-labelledby="homeResourcesHeading">
            <h2 className="section-title home-section__heading" id="homeResourcesHeading" data-motion-key="home-resources-rule">Member resources</h2>
            <p className="muted" id="doorsIntro">{homeData.copy.doorsIntro}</p>
            <DoorGrid tiles={homeData.tiles} />
            <nav className="home-resource-links" aria-label="More member resources">
              {communityResources.map((item) => (
                <Link className="hero-cta" href={item.href} key={item.nav}>
                  {item.label} <span aria-hidden="true">→</span>
                </Link>
              ))}
            </nav>
            <div className="home-future-resources">
              {futureResources.map((item) => (
                <a href={item.href} target="_blank" rel="noopener noreferrer" key={item.nav}>
                  {item.label} <span>Coming Soon</span><span className="sr-only">, opens in a new tab</span>
                </a>
              ))}
            </div>
          </section>

          <section className="home-guild-seal" aria-label="Guild seal" data-motion-key="home-seal" data-motion-featured="true">
            <StaticImage
              id="sealImage"
              src={publicPath(homeData.seal.image, "/assets/img/brand/emblem.webp")}
              alt={cleanLabel(homeData.seal.imageAlt || "Mōchirīī guild seal")}
              width={1024}
              height={1024}
              sizes="(max-width: 640px) 96px, 116px"
            />
            <div>
              <h2 id="sealTitle" className="home-seal-title">{homeData.seal.title}</h2>
              <p id="sealVerse" className="home-seal-verse muted"><SealVerse lines={sealVerse} /></p>
            </div>
            <HomeEdge id="home-seal-edge" rose />
          </section>
        </div>
      </main>
    </>
  );
}
