export const DECORATIVE_MOTION_KEY = "mochirii.decorative-motion.v1";
export type DecorativeMotionPreference = "on" | "off";

// Missing preferences use the OS-aware default; unrecognized saved values stay static.
export function decorativeMotionPreference(value: string | null): DecorativeMotionPreference {
  return value === null || value === "on" ? "on" : "off";
}
