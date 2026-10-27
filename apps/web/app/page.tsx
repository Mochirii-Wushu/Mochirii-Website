import "./styles/public-home-seal.css";
import "./styles/public-home-media.css";
import "./styles/public-home-bulletins.css";
import "./styles/public-home-doors.css";
import "./styles/public-home-visual.css";
import "./styles/public-home-pvp-swords.css";
import "./styles/shell-gallery-media.css";
import "./styles/shell-lightbox.css";
import { Fragment, Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import homeData from "@/public/data/home.json";
import galleryData from "@/public/data/gallery.json";
import raffleData from "@/public/data/raffles.json";
import recruitmentData from "@/public/data/recruitment.json";
import pvpData from "@/public/data/pvp-clips.json";
import { HomeArrow, DiscordSymbol } from "@/components/home/HomeArrow";
import { HomePvpHighlights } from "@/components/home/HomePvpHighlights";
import { selectPvpClips } from "@/lib/pvp-clips";
import { HomeGallerySpotlight } from "@/components/HomeGallerySpotlight";
import type { GallerySpotlightItem } from "@/components/HomeGalleryLightbox";
import { MotionToggle } from "@/components/DecorativeMotion";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";
import { HomeNextEvent } from "@/components/public-pages/HomeNextEvent";
import { spotlightWinnerName, spotlightWinnerTitle } from "@/components/public-pages/spotlight-content";
import { StaticImage, publicPath, cleanRoute } from "@/components/public-pages/common";
import { publicGuildSchedule } from "@/lib/events/public-schedule";
import { getHomeRecruitment } from "@/lib/home-recruitment";
import { SITE_ORIGIN, SOCIAL_HOST } from "@/lib/public-urls";
import { SITE_DESCRIPTION, SITE_LANGUAGE } from "@/lib/site-metadata";
import { getCurrentSpotlightWinner } from "@/lib/supabase/spotlight";
import type { CurrentSpotlightWinner } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const homeStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": SITE_ORIGIN + "/#website", url: SITE_ORIGIN + "/", name: "Mōchirīī", alternateName: "Mōchī", description: SITE_DESCRIPTION, inLanguage: SITE_LANGUAGE, publisher: { "@id": SITE_ORIGIN + "/#organization" } },
    { "@type": "Organization", "@id": SITE_ORIGIN + "/#organization", url: SITE_ORIGIN + "/", name: "Mōchirīī", alternateName: "Mōchī", logo: { "@type": "ImageObject", url: SITE_ORIGIN + "/assets/img/brand/social-card.png" }, areaServed: "Asia Pacific", sameAs: [SOCIAL_HOST] },
  ],
};

function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const homeGalleryPresentation = new Map([
  ["shot-01", { alt: "Character standing among pink flowers", accessibleLabel: "Open screenshot of a character standing among pink flowers" }],
  ["shot-02", { alt: "Armored character during combat", accessibleLabel: "Open screenshot of an armored character during combat" }],
  ["shot-03", { alt: "White-robed character using an emote", accessibleLabel: "Open screenshot of a white-robed character using an emote" }],
  ["shot-04", { alt: "Party facing a horned enemy in a cave", accessibleLabel: "Open screenshot of a party facing a horned enemy in a cave" }],
]);

function galleryCandidates(): GallerySpotlightItem[] {
  const seen = new Set<string>();
  return galleryData.albums.flatMap(album => album.items).flatMap(item => {
    const full = publicPath(item.full || item.src);
    const image = publicPath(item.thumb || item.src || item.full);
    if (!full || !image || seen.has(full)) return [];
    seen.add(full);
    const presentation = homeGalleryPresentation.get(item.id);
    return [{ key: item.id || full, image, full, alt: presentation?.alt || item.alt || item.caption || "Guild screenshot", caption: item.caption || "", accessibleLabel: presentation?.accessibleLabel }];
  });
}

function spotlightRecognition(winner: CurrentSpotlightWinner | null) {
  if (!spotlightWinnerName(winner) || !winner?.monthKey) return null;
  return homeData.spotlight.recognitions.find(item => item.monthKey === winner.monthKey) || null;
}

function SpotlightCard({ winner, loading = false }: { winner: CurrentSpotlightWinner | null; loading?: boolean }) {
  const spotlight = homeData.spotlight;
  const winnerName = spotlightWinnerName(winner);
  const recognition = spotlightRecognition(winner);
  const summary = recognition?.summary || spotlight.fallbackIntro;
  return (
    <div className="home-spotlight" id="spotlightCard">
      <StaticImage id="spotlightImage" className="home-spotlight__img" src={publicPath(spotlight.image)} alt="Member Spotlight cover" width={1536} height={1024} sizes="(max-width: 640px) 112px, 180px" />
      <div className="home-spotlight__plate">
        <span className="home-pill" id="spotlightTag">{loading ? "Member Spotlight" : spotlight.tag}</span>
        <h3 className="home-title" id="spotlightTitle">{spotlightWinnerTitle("home", spotlight.title, winner)}</h3>
        <p className="home-summary" id="spotlightSummary">{summary}</p>
        {loading ? <span className="sr-only" role="status">Loading the current month’s Spotlight.</span> : null}
        <Link className="home-link" href={cleanRoute(spotlight.href)} aria-label={winnerName ? "Open " + winnerName + "’s Member Spotlight" : "Open the Member Spotlight"}>View Spotlight <span aria-hidden="true" /></Link>
      </div>
    </div>
  );
}

async function CurrentHomeSpotlight() {
  // The bounded no-store request starts inside this Suspense child, never above the hero.
  const winner = await getCurrentSpotlightWinner();
  return <SpotlightCard winner={winner} />;
}

async function OptionalBirthdaySplash({ config }: { config: typeof homeData.celebrationSplash }) {
  if (config.enabled !== true) return null;
  if (!config.title.trim() || !config.message.trim()) return null;
  const { HomeBirthdaySplash } = await import("@/components/HomeBirthdaySplash");
  return <HomeBirthdaySplash config={{ enabled: config.enabled, startsAt: config.startsAt, endsAt: config.endsAt }}>
    <div className="birthday-splash" role="dialog" aria-modal="true" aria-labelledby="birthdaySplashTitle">
      <div className="birthday-splash__firework birthday-splash__firework--one" aria-hidden="true" />
      <div className="birthday-splash__firework birthday-splash__firework--two" aria-hidden="true" />
      <div className="birthday-splash__firework birthday-splash__firework--three" aria-hidden="true" />
      <section className="birthday-splash__panel" aria-describedby="birthdaySplashMessage">
        <button className="birthday-splash__close" type="button" data-dismiss aria-label="Close birthday splash">Close</button>
        <p className="birthday-splash__kicker">A lantern-bright wish</p>
        <h2 id="birthdaySplashTitle" className="birthday-splash__title">{config.title.trim()}</h2>
        <p id="birthdaySplashMessage" className="birthday-splash__message">{config.message.trim()}</p>
      </section>
    </div>
  </HomeBirthdaySplash>;
}

export default function Home() {
  const referenceTime = new Date().toISOString();
  const recruitment = getHomeRecruitment(recruitmentData.meta.status);
  const galleryItems = galleryCandidates();
  const fallbackGalleryItems = homeData.gallery.map((item, index) => ({ key: "home-gallery-" + index, image: publicPath(item.image), full: publicPath(item.full || item.image), alt: item.alt, caption: "", accessibleLabel: [...homeGalleryPresentation.values()][index]?.accessibleLabel }));
  const announcement = homeData.bulletins.find(item => item.type === "announcement");
  const resources = [{ href: "/gallery", label: "Gallery" }, { href: "/ranks", label: "Ranks" }, { href: "/leaders", label: "Leaders" }, { href: "/tome", label: "Tome" }, { href: "/spotify", label: "Playlists" }, { href: "/games/mochi-pets", label: "Mochi Pets" }];
  return (
    <>
      <script id="home-structured-data" type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(homeStructuredData) }} />
      <BodyPageMarker page="home" />
      <OptionalBirthdaySplash config={homeData.celebrationSplash} />
      <main className="home-page" id="main" tabIndex={-1}>
        <section className="home-hero" aria-labelledby="homeHeading">
          <div className="home-hero__art" data-home-scene="cherry-valley-dawn" data-motion-key="hero-scene">
            <Image id="heroImage" className="home-hero__image" src={publicPath(homeData.hero.image)} alt="" width={1344} height={490} unoptimized loading="eager" fetchPriority="high" />
            <div className="home-petals" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} />)}</div>
            <span className="home-mist" aria-hidden="true"><span className="home-mist-layer home-mist-layer--near" /><span className="home-mist-layer home-mist-layer--far" /></span>
          </div>
          <div className="home-hero__content">
            <p className="kicker" id="homeKicker">SEA · UTC+8</p>
            <h1 className="display-title" id="homeHeading">Mōchirīī</h1>
            <div className="prose-stack" id="heroDescriptor"><p>{homeData.hero.descriptor[0]}</p></div>
            <div className="badge-row" id="heroBadges" aria-label="Guild badges"><span>{recruitment.statusLabel}</span>{homeData.hero.badges.map(badge => <span key={badge}>{badge}</span>)}</div>
            <div className="hero-cta-row" aria-label="Primary actions">
              {recruitment.open ? <a id="heroJoinCta" className="hero-cta hero-cta--primary" href={recruitment.href} target="_blank" rel="noopener noreferrer"><DiscordSymbol />{recruitment.label}</a> : <Link id="heroJoinCta" className="hero-cta hero-cta--primary" href={recruitment.href}>{recruitment.label}</Link>}
              <Link className="hero-cta" href="/events">See Upcoming Events <HomeArrow /></Link>
            </div>
          </div>
          <div className="home-hero__motion"><MotionToggle /></div>
        </section>
        <div className="home-sword-duel" aria-hidden="true">
          {["left", "right"].map(side => <div className={"home-sword-side home-sword-side--" + side} key={side}>
            <span className="home-sword home-sword--jade"><img src="/assets/home/transitions/sword-duel/forged-jian-1024.webp" width={1024} height={118} alt="" loading="eager" decoding="async" fetchPriority="low" /></span>
            <span className="home-sword home-sword--celadon"><img src="/assets/home/transitions/sword-duel/forged-jian-1024.webp" width={1024} height={118} alt="" loading="eager" decoding="async" fetchPriority="low" /></span>
            <span className="home-sword-contact">{Array.from({ length: 5 }, (_, i) => <span key={i} />)}</span>
          </div>)}
        </div>
        <div className="home-content container">
          <section className="home-section home-event-section" aria-labelledby="home-event-heading" data-motion-key="home-event" data-motion-featured data-motion-persistent>
            <h2 id="home-event-heading" className="section-title">Your next guild event</h2>
            <Link id="featuredBulletin" className="home-featured" href="/events">
              <HomeNextEvent referenceTime={referenceTime} scheduleData={publicGuildSchedule} imageSizes="(max-width: 900px) calc(100vw - 32px), 740px" emptyState={<div className="home-featured__body"><h3 className="home-title">No event is scheduled.</h3><p className="home-summary">Check the UTC+8 schedule for the next event.</p><span className="home-link">View all events <HomeArrow /></span></div>}><span className="hero-cta hero-cta--primary">View event <HomeArrow /></span></HomeNextEvent>
              <span className="home-lanterns" aria-hidden="true"><span className="home-lantern-flame" /></span><span className="home-event-highlight" aria-hidden="true" />
            </Link>
          </section>
          <section className="home-section" id="guild-activity" aria-labelledby="guild-activity-heading" data-motion-key="home-activity">
            <h2 className="section-title" id="guild-activity-heading">Life in Mōchirīī</h2>
            <div className="home-activities">
              <Link className="home-activity-card" href="/events"><StaticImage src="/assets/img/bulletins/featured.webp" alt="Guild gathering illustration" width={1280} height={720} sizes="(max-width: 680px) 42vw, 380px" fetchPriority="low" /><span>Guild events <HomeArrow /></span></Link>
              <Link className="home-activity-card" href="/join" prefetch={false}><StaticImage src="/assets/img/tiles/join.webp" alt="Guild joining guide illustration" width={960} height={600} sizes="(max-width: 680px) 42vw, 380px" fetchPriority="low" /><span>Team play <HomeArrow /></span></Link>
              <div className="home-activity-card home-gallery-card" aria-label="Guild gallery"><HomeGallerySpotlight candidates={galleryItems} fallbackItems={fallbackGalleryItems} /><Link className="home-gallery-link" href="/gallery">Member Gallery <HomeArrow /></Link></div>
            </div>
            <HomePvpHighlights clips={selectPvpClips(pvpData.clips, pvpData.approvedMediaOrigins)} />
            <div className="home-supporting-row">
              <section className="home-supporting-card" aria-label="Member spotlight"><h2 className="sr-only">Member Spotlight</h2><Suspense fallback={<SpotlightCard winner={null} loading />}><CurrentHomeSpotlight /></Suspense></section>
              <section className="home-supporting-card home-updates" aria-labelledby="home-updates-title"><h2 id="home-updates-title">Guild updates</h2>{announcement ? <p>{announcement.title}</p> : <p>Read guild notices and announcements.</p>}<Link className="home-link" href="/announcements">Read announcements <HomeArrow /></Link><p className="home-raffle-note">{raffleData.publicView.cycleStatus === "open" ? "A raffle is open. " : "No raffle is open. "}<Link href="/raffle">View raffle status and history</Link></p></section>
            </div>
          </section>
          <section className="home-section home-onboarding" id="start-here" aria-labelledby="start-heading" data-motion-key="home-start">
            <h2 className="section-title" id="start-heading">Start here</h2>
            <ol className="home-steps"><li><span className="home-step-number" aria-hidden="true">1</span><div><h3>Join Discord</h3><p>No website account is needed to join Discord.</p><a href={recruitment.href} target={recruitment.open ? "_blank" : undefined} rel={recruitment.open ? "noopener noreferrer" : undefined}>{recruitment.open ? <DiscordSymbol /> : null}{recruitment.label} <HomeArrow /></a></div></li><li><span className="home-step-number" aria-hidden="true">2</span><div><h3>Choose your guild channels</h3><p>After Discord verification, explore the channels that match your interests.</p><Link href="/join">Read the Joining Guide <HomeArrow /></Link></div></li><li><span className="home-step-number" aria-hidden="true">3</span><div><h3>Take part in an event</h3><p>Find a time in UTC+8 and follow the event’s joining details.</p><Link href="/events">See events <HomeArrow /></Link></div></li></ol>
            <p className="home-verification-note">Complete Double Counter verification in Discord. A website account is optional. Website member features require a separate membership check; Discord verification does not promise guild admission or website access.</p>
          </section>
          <section className="home-section home-resources" id="member-resources" aria-labelledby="resources-heading" data-motion-key="home-resources"><h2 className="section-title" id="resources-heading">Member resources</h2><div className="home-resource-links">{resources.map(resource => <Link key={resource.href} href={resource.href}>{resource.label} <HomeArrow /></Link>)}<span className="home-coming-soon">Forums <small>Coming Soon</small></span><span className="home-coming-soon">Social <small>Coming Soon</small></span></div></section>
          <section className="home-guild-seal" aria-label="Guild seal"><StaticImage id="sealImage" src={publicPath(homeData.seal.image)} alt={homeData.seal.imageAlt} width={1024} height={1024} sizes="(max-width: 680px) 100px, 140px" /><div><h2 className="home-seal-title" id="sealTitle">{homeData.seal.title}</h2><p className="home-seal-verse" id="sealVerse">{homeData.seal.verse.map((line, index) => <Fragment key={line}>{line}{index < homeData.seal.verse.length - 1 ? <br /> : null}</Fragment>)}</p></div></section>
        </div>
      </main>
    </>
  );
}
