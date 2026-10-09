"use client";

import { useEffect, useState } from "react";
import { type GuildScheduleData, websiteEventCardsFromSchedule } from "@/lib/guild-schedule";
import { parseReferenceTime } from "./parse-reference-time";
import { nextScheduleRefreshDelay } from "./schedule-refresh";

export function useGuildSchedule(schedule: GuildScheduleData, referenceTime: string) {
  const [clock, setClock] = useState(() => ({ seed: referenceTime, now: parseReferenceTime(referenceTime) }));
  const referenceTimeMs = clock.seed === referenceTime ? clock.now : parseReferenceTime(referenceTime);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const refresh = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") return;

      const now = Date.now();
      setClock({ seed: referenceTime, now });
      const currentItems = websiteEventCardsFromSchedule(schedule, new Date(now));
      timer = setTimeout(refresh, nextScheduleRefreshDelay(now, currentItems, schedule.timezone?.offsetMinutes));
    };

    // The first browser render retains the server instant; wall time is read only after hydration.
    timer = setTimeout(refresh, 0);
    document.addEventListener("visibilitychange", refresh);
    document.addEventListener("resume", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      document.removeEventListener("resume", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [referenceTime, schedule]);

  return {
    items: websiteEventCardsFromSchedule(schedule, new Date(referenceTimeMs)),
    referenceTime: new Date(referenceTimeMs).toISOString(),
  };
}
