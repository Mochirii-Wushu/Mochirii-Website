import { FORUMS_HOST, SOCIAL_HOST } from "@/lib/public-urls";

export type NavItem = {
  href: string;
  label: string;
  nav: string;
  auth?: "signed-out" | "signed-in" | "verified" | "moderator" | "spinner-viewer";
  external?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    id: "guild",
    label: "Guild",
    items: [
      { href: "/", label: "Home", nav: "home" },
      { href: "/spotlight", label: "Spotlight", nav: "spotlight" },
      { href: "/gallery", label: "Gallery", nav: "gallery" },
      { href: SOCIAL_HOST, label: "Social", nav: "social-host", external: true },
      { href: FORUMS_HOST, label: "Forums", nav: "forums-host", external: true },
      { href: "/games/mochi-pets", label: "Mochi Pets", nav: "games/mochi-pets" },
    ],
  },
  {
    id: "culture",
    label: "Culture",
    items: [
      { href: "/join", label: "Join", nav: "join" },
      { href: "/ranks", label: "Ranks", nav: "ranks" },
      { href: "/leaders", label: "Leaders", nav: "leaders" },
      { href: "/tome", label: "Tome", nav: "tome" },
      { href: "/spotify", label: "Playlists", nav: "spotify" },
    ],
  },
  {
    id: "updates",
    label: "Updates",
    items: [
      { href: "/announcements", label: "Announcements", nav: "announcements" },
      { href: "/events", label: "Events", nav: "events" },
      { href: "/raffle", label: "Raffle", nav: "raffle" },
    ],
  },
];

export const publicUtilityLinks: NavItem[] = [
  { href: "/recruitment", label: "Recruitment", nav: "recruitment" },
  { href: "/auth", label: "Login", nav: "auth", auth: "signed-out" },
];

export const accountWorkflowLinks: NavItem[] = [
  { href: "/account", label: "Profile & Settings", nav: "account", auth: "signed-in" },
  { href: "/gallery-submit", label: "Submit Image", nav: "gallery-submit", auth: "verified" },
  { href: "/spinner", label: "Watch Spinner", nav: "spinner", auth: "spinner-viewer" },
  { href: "/leader-dashboard", label: "Leader Dashboard", nav: "leader-dashboard", auth: "moderator" },
];
