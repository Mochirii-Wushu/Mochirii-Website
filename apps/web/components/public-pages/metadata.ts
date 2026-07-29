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
  | "raffleRules"
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
      "How to join Mōchirīī in Where Winds Meet, with Discord steps, gentle expectations, and newcomer-friendly events.",
    path: "/join",
    image: "/assets/img/join/hero.webp",
  },
  ranks: {
    title: "Mōchirīī Ranks • Where Winds Meet Guild",
    description:
      "Mōchirīī ranks, leadership paths, member growth, and the steady care that keeps the guild hall strong.",
    path: "/ranks",
    image: "/assets/img/ranks/hero.webp",
  },
  leaders: {
    title: "Mōchirīī Leaders • Where Winds Meet Guild",
    description:
      "Meet Mōchirīī leaders, hall contacts, and the people who help Where Winds Meet members find the next clear step.",
    path: "/leaders",
    image: "/assets/img/leaders/hero.webp",
  },
  tome: {
    title: "Mōchirīī Tome • Where Winds Meet Guild",
    description:
      "The Mōchirīī Tome: values, etiquette, event rhythm, and plain guild care for Where Winds Meet members.",
    path: "/tome",
    image: "/assets/img/tome/hero.webp",
  },
  events: {
    title: "Mōchirīī Events • Where Winds Meet Guild",
    description:
      "Mōchirīī event notes, RSVP details, and shared runs for Where Winds Meet members who gather when the hour is right.",
    path: "/events",
    image: "/assets/img/events/hero.webp",
  },
  announcements: {
    title: "Mōchirīī Announcements • Where Winds Meet Guild",
    description:
      "Latest Mōchirīī announcements, schedule notes, guild notices, and Where Winds Meet updates from the hall.",
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
  raffleRules: {
    title: "Mōchirīī Monthly Raffle Rules",
    description:
      "Standing Mōchirīī Monthly Raffle eligibility, entry limits, free participation methods, current drawing rules, and completed-drawing archive.",
    path: "/raffle/rules",
    image: "/assets/img/raffles/hero.webp",
  },
  gallery: {
    title: "Mōchirīī Gallery • Where Winds Meet Guild",
    description:
      "Screenshots from Mōchirīī runs, quiet roads, guild gatherings, and small Where Winds Meet moments worth keeping.",
    path: "/gallery",
    image: "/assets/img/gallery/hero.webp",
  },
  spotlight: {
    title: "Mōchirīī Member Spotlight • Where Winds Meet Guild",
    description:
      "Monthly Mōchirīī member appreciation for the helpful, steady voices who keep the Where Winds Meet guild bright.",
    path: "/spotlight",
    image: "/assets/img/spotlight/hero.webp",
  },
  spotify: {
    title: "Mōchirīī Playlists • Where Winds Meet Guild",
    description:
      "A quiet Mōchirīī listening room for ambient music, guild reading, planning, and late-night play.",
    path: "/spotify",
    image: "/assets/img/spotify/hero.webp",
  },
  recruitment: {
    title: "Mōchirīī Recruitment • Where Winds Meet Guild",
    description:
      "A Mōchirīī recruitment note about joining through Discord, growing the guild with care, and keeping the hall warm.",
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
      "A shared 3D Mōchirīī guild home beyond the Jianghu, bringing members together with a Mochi companion of their own across iPhone and desktop.",
    path: "/games/mochi-pets",
    image: "/assets/img/mochi-pets/gate-arrival.webp",
  },
  privacy: {
    title: "Privacy • Mōchirīī",
    description:
      "How Mōchirīī handles member accounts, Discord verification, Gallery uploads, moderation, and optional Facebook and Instagram publishing.",
    path: "/privacy",
    image: "/assets/img/hero/hero.webp",
  },
  metaDataDeletion: {
    title: "Meta Data Deletion • Mōchirīī",
    description:
      "How to request deletion of data associated with Mōchirīī member accounts, Gallery submissions, and Facebook or Instagram publishing.",
    path: "/meta-data-deletion",
    image: "/assets/img/hero/hero.webp",
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
