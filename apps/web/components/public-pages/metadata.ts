import type { Metadata } from "next";
import { SITE_ORIGIN } from "@/lib/public-urls";
import { SITE_OG_LOCALE } from "@/lib/site-metadata";

type PageKey =
  | "join"
  | "ranks"
  | "leaders"
  | "tome"
  | "events"
  | "announcements"
  | "raffle"
  | "gallery"
  | "spotlight"
  | "spotify"
  | "recruitment"
  | "twills"
  | "mochiPets"
  | "privacy"
  | "metaDataDeletion";

const pageMeta: Record<
  PageKey,
  {
    title: string;
    description: string;
    path: string;
    image: string;
  }
> = {
  join: {
    title: "Join Mōchirīī • Where Winds Meet Guild",
    description:
      "How to join Mōchirīī through Discord, complete onboarding, find events, and contact guild leaders.",
    path: "/join",
    image: "/assets/img/join/hero.webp",
  },
  ranks: {
    title: "Mōchirīī Ranks • Where Winds Meet Guild",
    description:
      "Mōchirīī ranks, advancement criteria, leadership responsibilities, and member progression.",
    path: "/ranks",
    image: "/assets/img/ranks/hero.webp",
  },
  leaders: {
    title: "Mōchirīī Leaders • Where Winds Meet Guild",
    description:
      "Meet Mōchirīī leaders and find contacts for recruitment, events, builds, disputes, and member support.",
    path: "/leaders",
    image: "/assets/img/leaders/hero.webp",
  },
  tome: {
    title: "Mōchirīī Tome • Where Winds Meet Guild",
    description:
      "Guild rules, event standards, member conduct, and leadership expectations for Mōchirīī.",
    path: "/tome",
    image: "/assets/img/tome/hero.webp",
  },
  events: {
    title: "Mōchirīī Events • Where Winds Meet Guild",
    description:
      "Mōchirīī event schedules, RSVP details, party objectives, requirements, and preparation notes.",
    path: "/events",
    image: "/assets/img/events/hero.webp",
  },
  announcements: {
    title: "Mōchirīī Announcements • Where Winds Meet Guild",
    description:
      "Latest Mōchirīī announcements, schedule notes, guild notices, and game updates.",
    path: "/announcements",
    image: "/assets/img/announcements/hero.webp",
  },
  raffle: {
    title: "Mōchirīī Monthly Raffle",
    description:
      "Monthly Mōchirīī guild drawings, standing entry limits, possible reward types, current entry status, and results. No purchase necessary.",
    path: "/raffle",
    image: "/assets/img/raffles/hero.webp",
  },
  gallery: {
    title: "Mōchirīī Gallery • Where Winds Meet Guild",
    description:
      "Pretty Mōchirīī gameplay screenshots from combat, exploration, builds, victories, and guild events.",
    path: "/gallery",
    image: "/assets/img/gallery/hero.webp",
  },
  spotlight: {
    title: "Mōchirīī Member Spotlight • Where Winds Meet Guild",
    description:
      "Monthly recognition for members who contribute event leadership, build knowledge, guides, recruitment, and support.",
    path: "/spotlight",
    image: "/assets/img/spotlight/hero.webp",
  },
  spotify: {
    title: "Mōchirīī Playlists • Where Winds Meet Guild",
    description:
      "Mōchirīī playlists for combat, exploration, build review, material gathering, and event preparation.",
    path: "/spotify",
    image: "/assets/img/spotify/hero.webp",
  },
  recruitment: {
    title: "Mōchirīī Recruitment • Where Winds Meet Guild",
    description:
      "Join Mōchirīī through Discord for Asia Pacific events, build discussion, guides, and guild progression.",
    path: "/recruitment",
    image: "/assets/img/recruitment/hero.webp",
  },
  twills: {
    title: "Twills • Mōchirīī Leader Profile",
    description:
      "Profile for Twills, Mōchirīī leader and guild contact for Where Winds Meet members who need a clear next step.",
    path: "/twills",
    image: "/assets/img/profiles/twills/hero.webp",
  },
  mochiPets: {
    title: "Mochi Pets • Mōchirīī Guild World",
    description:
      "A future shared 3D Mōchirīī guild home beyond the Jianghu, planned to bring members together with a Mochi companion of their own on iOS and desktop.",
    path: "/games/mochi-pets",
    image: "/assets/img/mochi-pets/gate-arrival.webp",
  },
  privacy: {
    title: "Privacy • Mōchirīī",
    description:
      "How Mōchirīī handles member accounts, Discord verification, Gallery uploads, moderation, and optional Facebook and Instagram publishing.",
    path: "/privacy",
    image: "/assets/img/privacy/hero.webp",
  },
  metaDataDeletion: {
    title: "Meta Data Deletion • Mōchirīī",
    description:
      "How to request deletion of data associated with Mōchirīī member accounts, Gallery submissions, and Facebook or Instagram publishing.",
    path: "/meta-data-deletion",
    image: "/assets/img/data-deletion/hero.webp",
  },
};

export function metadataFor(page: PageKey): Metadata {
  const meta = pageMeta[page];
  const url = `${SITE_ORIGIN}${meta.path}`;

  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical: meta.path,
    },
    openGraph: {
      type: "website",
      siteName: "Mōchirīī",
      title: meta.title,
      description: meta.description,
      url,
      locale: SITE_OG_LOCALE,
      images: [meta.image],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [meta.image],
    },
  };
}
