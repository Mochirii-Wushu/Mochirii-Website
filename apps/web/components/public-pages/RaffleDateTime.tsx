"use client";

import { useSyncExternalStore } from "react";
import {
  formatRaffleTime,
  formatRaffleTimeForZone,
  RAFFLE_TIME_ZONE,
  RAFFLE_TIME_ZONE_LABEL,
} from "@/lib/raffle/time";

type RaffleDateTimeProps = {
  instant: string;
  label: string;
};

const serverLocaleSnapshot = JSON.stringify({ locale: "en", timeZone: RAFFLE_TIME_ZONE });
const subscribeToLocale = () => () => undefined;

function readBrowserLocale() {
  return JSON.stringify({
    locale: navigator.language || "en",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || RAFFLE_TIME_ZONE,
  });
}

export function RaffleDateTime({ instant, label }: RaffleDateTimeProps) {
  const raffleTime = formatRaffleTime(instant);
  const localeSnapshot = useSyncExternalStore(
    subscribeToLocale,
    readBrowserLocale,
    () => serverLocaleSnapshot,
  );
  const { locale, timeZone } = JSON.parse(localeSnapshot) as { locale: string; timeZone: string };
  const visitorTime = timeZone === RAFFLE_TIME_ZONE
    ? null
    : formatRaffleTimeForZone(instant, timeZone, locale);

  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <time dateTime={instant}>{raffleTime} {RAFFLE_TIME_ZONE_LABEL}</time>
        {visitorTime ? (
          <span className="raffle-visitor-time">
            Your time: {visitorTime} ({timeZone})
          </span>
        ) : null}
      </dd>
    </div>
  );
}
