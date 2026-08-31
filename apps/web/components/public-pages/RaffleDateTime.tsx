"use client";

import { useSyncExternalStore } from "react";
import {
  formatRaffleTime,
  formatRaffleTimeForZone,
  RAFFLE_TIME_ZONE,
} from "@/lib/raffle/time";

type RaffleDateTimeProps = {
  instant: string;
  label: string;
};

const serverTimeZoneSnapshot = RAFFLE_TIME_ZONE;
const subscribeToTimeZone = () => () => undefined;

function readBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || RAFFLE_TIME_ZONE;
}

export function RaffleDateTime({ instant, label }: RaffleDateTimeProps) {
  const singaporeTime = formatRaffleTime(instant);
  const timeZoneSnapshot = useSyncExternalStore(
    subscribeToTimeZone,
    readBrowserTimeZone,
    () => serverTimeZoneSnapshot,
  );
  const timeZone = timeZoneSnapshot;
  const visitorTime = timeZone === RAFFLE_TIME_ZONE
    ? null
    : formatRaffleTimeForZone(instant, timeZone);

  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <time dateTime={instant}>{singaporeTime} UTC+8</time>
        {visitorTime ? (
          <span className="raffle-visitor-time">
            Your time: {visitorTime} ({timeZone})
          </span>
        ) : null}
      </dd>
    </div>
  );
}
