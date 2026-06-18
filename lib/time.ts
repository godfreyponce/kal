export const APP_TZ = "America/Chicago";

/**
 * The single source of truth for "today" in the app.
 *
 * Returns the civil date (YYYY-MM-DD) in {@link APP_TZ}, DST-aware. Every "today"
 * boundary — the remaining-macros query, the system-prompt TODAY block, and each
 * tool's `date?` default — must go through this. Never use raw `new Date()` day
 * math (Vercel runs UTC, which silently rolls the day over in the evening).
 */
export function todayInAppTz(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
