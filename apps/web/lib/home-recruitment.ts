import publicUrls from "../config/public-urls.json" with { type: "json" };

export type HomeRecruitment = {
  label: string;
  href: string;
  open: boolean;
  statusLabel: string;
};

export function getHomeRecruitment(status: unknown): HomeRecruitment {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  const open = normalized === "open" || normalized === "limited";

  return {
    label: open ? "Join on Discord" : "Recruitment Paused",
    href: open ? publicUrls.discordInviteUrl : "/recruitment",
    open,
    statusLabel: normalized === "open"
      ? "Recruitment Open"
      : normalized === "limited"
        ? "Limited Recruitment"
        : "Recruitment Paused",
  };
}
