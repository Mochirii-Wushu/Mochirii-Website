import type { CurrentSpotlightWinner } from "@/lib/supabase/types";

const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const UNPAIRED_SURROGATE = /[\ud800-\udfff]/u;
const MONTH_KEY = /^\d{4}-(?:0[1-9]|1[0-2])-01$/u;
const WINNER_PLACEHOLDER_PATTERN = /\{\{winnerName\}\}/gu;
type SpotlightWinnerInput = Partial<CurrentSpotlightWinner> | null | undefined;

function clean(value: unknown, fallback = "") {
  if (typeof value !== "string" || CONTROL_OR_BIDI.test(value) || UNPAIRED_SURROGATE.test(value)) return fallback;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized || fallback;
}

export function spotlightWinnerName(winner: SpotlightWinnerInput) {
  const name = clean(winner?.winnerName);
  return name.length <= 120 ? name : "";
}

export function spotlightWinnerTitle(
  template: "home" | "spotlight",
  fallbackTitle: string,
  winner: SpotlightWinnerInput,
) {
  const name = spotlightWinnerName(winner);
  if (!name) return clean(fallbackTitle, template === "home" ? "Member Spotlight" : "This Month's Spotlight");
  return template === "home" ? `Congratulations to: ${name}.` : `This Month: ${name}`;
}

export function spotlightAppreciationLines(
  lines: unknown,
  winner: SpotlightWinnerInput,
) {
  const name = spotlightWinnerName(winner) || "our selected member";
  if (!Array.isArray(lines)) return [];

  return lines
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.replace(WINNER_PLACEHOLDER_PATTERN, () => name).trim())
    .filter(Boolean);
}

export function spotlightMonthKey(
  winner: SpotlightWinnerInput,
  fallback: unknown,
) {
  const value = clean(winner?.monthKey);
  return MONTH_KEY.test(value) ? value : clean(fallback);
}
