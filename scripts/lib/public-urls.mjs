import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const publicUrls = JSON.parse(readFileSync(resolve(root, "apps/web/config/public-urls.json"), "utf8"));

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
export const SUPABASE_PROJECT_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
export const SUPABASE_AUTH_CALLBACK_URL = `${SUPABASE_PROJECT_URL}/auth/v1/callback`;
export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_PROJECT_URL}/functions/v1`;

export function siteUrl(path = "") {
  return new URL(path || "/", SITE_ORIGIN).href.replace(/\/$/, path ? "" : "/");
}

export function supabaseProjectUrl(projectRef = SUPABASE_PROJECT_REF) {
  return `https://${projectRef}.supabase.co`;
}

export function supabaseFunctionsUrl(projectRef = SUPABASE_PROJECT_REF) {
  return `${supabaseProjectUrl(projectRef)}/functions/v1`;
}
