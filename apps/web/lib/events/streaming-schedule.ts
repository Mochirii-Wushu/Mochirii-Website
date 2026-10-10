import { type GuildScheduleData, scheduleLine } from "../guild-schedule.ts";

// Website stream lines share Reaper's authority without entering guild occurrence cards.
export function streamingScheduleLines(schedule: GuildScheduleData): string[] {
  return (schedule.streaming || []).map((item) => `Twitch — ${scheduleLine(item, schedule)}`);
}
