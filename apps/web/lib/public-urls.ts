import publicUrls from "@/config/public-urls.json";

export const SITE_ORIGIN = publicUrls.siteOrigin;
export const SITE_DISPLAY_NAME = publicUrls.siteDisplayName;
export const SOCIAL_HOST = publicUrls.socialHost;
export const DISCORD_INVITE_URL = publicUrls.discordInviteUrl;
export const SUPABASE_PROJECT_REF = publicUrls.supabaseProjectRef;
export const FACEBOOK_PAGE_URL = publicUrls.officialGuildChannels.facebookPage.href;
export const FACEBOOK_GROUP_URL = publicUrls.officialGuildChannels.facebookGroup.href;
export const INSTAGRAM_URL = publicUrls.officialGuildChannels.instagram.href;
export const TIKTOK_URL = publicUrls.officialGuildChannels.tiktok.href;
export const TWITCH_URL = publicUrls.officialGuildChannels.twitch.href;
export const OFFICIAL_GUILD_CHANNELS = Object.values(publicUrls.officialGuildChannels);
