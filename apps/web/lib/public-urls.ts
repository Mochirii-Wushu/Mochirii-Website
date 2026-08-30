import publicUrls from "@/config/public-urls.json";

export type OfficialGuildProfileSurface = "header" | "footer";

export type OfficialGuildProfile = {
  id: string;
  label: string;
  accountLabel: string;
  href: string;
  surfaces: OfficialGuildProfileSurface[];
  markAsset: string | null;
};

export const SITE_ORIGIN = publicUrls.siteOrigin;
export const SOCIAL_HOST = publicUrls.socialHost;
export const FORUMS_HOST = publicUrls.forumsHost;
export const DISCORD_INVITE_URL = publicUrls.discordInviteUrl;
export const SUPABASE_PROJECT_REF = publicUrls.supabaseProjectRef;
export const OFFICIAL_GUILD_PROFILES = publicUrls.officialGuildProfiles.map((profile) => ({
  ...profile,
  surfaces: profile.surfaces as OfficialGuildProfileSurface[],
  markAsset: typeof profile.markAsset === "string" ? profile.markAsset : null,
})) satisfies OfficialGuildProfile[];
export const HEADER_GUILD_PROFILES = OFFICIAL_GUILD_PROFILES.filter((profile) =>
  profile.surfaces.includes("header"),
);
export const FOOTER_GUILD_PROFILES = OFFICIAL_GUILD_PROFILES.filter((profile) =>
  profile.surfaces.includes("footer"),
);
