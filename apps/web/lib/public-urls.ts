import publicUrls from "@/config/public-urls.json";

export type OfficialGuildProfileSurface = "header" | "footer";

export type OfficialGuildProfile = {
  id: string;
  label: string;
  accountLabel: string;
  href: string;
  surfaces: OfficialGuildProfileSurface[];
  organizationIdentity: boolean;
  markAsset: string | null;
};

function profileById(id: string) {
  const profile = OFFICIAL_GUILD_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Missing official guild profile configuration: ${id}`);
  return profile;
}

export const SITE_ORIGIN = publicUrls.siteOrigin;
export const SITE_DISPLAY_NAME = publicUrls.siteDisplayName;
export const SOCIAL_HOST = publicUrls.socialHost;
export const DISCORD_INVITE_URL = publicUrls.discordInviteUrl;
export const SUPABASE_PROJECT_REF = publicUrls.supabaseProjectRef;
export const SUPABASE_AUTH_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
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
export const ORGANIZATION_PROFILE_URLS = OFFICIAL_GUILD_PROFILES
  .filter((profile) => profile.organizationIdentity)
  .map((profile) => profile.href);
export const FACEBOOK_PAGE_URL = profileById("facebook-page").href;
export const FACEBOOK_GROUP_URL = publicUrls.facebookGroupUrl;
export const INSTAGRAM_URL = profileById("instagram").href;
export const TIKTOK_URL = profileById("tiktok").href;
export const TWITCH_URL = profileById("twitch").href;
