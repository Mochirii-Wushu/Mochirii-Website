import guildScheduleData from "../public/data/guild-schedule.json" with { type: "json" };

export const eventCoverImagePatterns = [
  { pathname: "/**", search: "" },
  ...[
    ...Object.values(guildScheduleData.monthly),
    ...guildScheduleData.weekly.filter((event) => event.discord),
  ].map((event) => ({
    pathname: `/${event.discordCoverImage.replace(/^\.?\//, "")}`,
    search: `?v=${encodeURIComponent(guildScheduleData.discordCoverVersion)}`,
  })),
];
