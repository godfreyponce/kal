// Pure weekly-adherence logic. No DB, no DOM — plain functions over strings/maps so
// the query wrapper (getWeekAdherence) and the renderer (weekly-adherence.tsx) can be
// tested and changed independently. Mirrors lib/trend-geometry.ts.

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { profile, logEntries } from "../db/schema";
import { todayInAppTz } from "./time";

export type Macros = { kcal: number; proteinG: number };

export type DayState =
  | "on-plan"   // past day, judged, passed
  | "off-plan"  // past day, judged, failed (has log entries)
  | "unlogged"  // past day, no log entries at all
  | "today"     // the current day, in progress — never judged, never counted
  | "ahead";    // a day later this week — nothing to show

export type DayCell = {
  date: string;              // YYYY-MM-DD
  dow: string;               // positional: M T W T F S S
  state: DayState;
  consumed: Macros | null;   // null for "ahead"; present (possibly {0,0}) otherwise
};

export type WeekAdherence = {
  targets: Macros;
  days: DayCell[];           // exactly 7, Monday→Sunday
  onPlanCount: number;       // count of days in state "on-plan" (0..7)
};

// The day rule, in one place.
const KCAL_TOLERANCE = 0.1; // ±10% of target
const PROTEIN_FLOOR = 0.9;  // ≥90% of target

export function judgeDay(consumed: Macros, targets: Macros): boolean {
  const kcalOk =
    consumed.kcal >= targets.kcal * (1 - KCAL_TOLERANCE) &&
    consumed.kcal <= targets.kcal * (1 + KCAL_TOLERANCE);
  const proteinOk = consumed.proteinG >= targets.proteinG * PROTEIN_FLOOR;
  return kcalOk && proteinOk;
}

// The 7 ISO dates Monday→Sunday for the week containing `today`.
// Civil-date arithmetic on the string — UTC only (Vercel runs UTC).
export function weekDays(today: string): string[] {
  const d = new Date(today + "T00:00:00Z");
  const mondayOffset = (d.getUTCDay() + 6) % 7; // getUTCDay: 0=Sun..6=Sat → days since Monday
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

export function classifyWeek(
  today: string,
  targets: Macros,
  consumedByDate: Map<string, Macros>,
): WeekAdherence {
  const days: DayCell[] = weekDays(today).map((date, i) => {
    const dow = DOW[i];
    if (date > today) return { date, dow, state: "ahead", consumed: null };
    if (date === today) {
      const consumed = consumedByDate.get(date) ?? { kcal: 0, proteinG: 0 };
      return { date, dow, state: "today", consumed };
    }
    const logged = consumedByDate.get(date);
    if (!logged) return { date, dow, state: "unlogged", consumed: { kcal: 0, proteinG: 0 } };
    const state: DayState = judgeDay(logged, targets) ? "on-plan" : "off-plan";
    return { date, dow, state, consumed: logged };
  });
  const onPlanCount = days.filter((d) => d.state === "on-plan").length;
  return { targets, days, onPlanCount };
}

/**
 * WeekAdherence for the calendar week containing `today` (defaults to the app-tz today).
 * Two independent queries in one parallel batch (neon-http = one round-trip per query):
 * profile targets, and one grouped sum over the week's log_entries. Future days in range
 * simply return no rows. All judgement happens in classifyWeek (pure, unit-tested).
 */
export async function getWeekAdherence(today: string = todayInAppTz()): Promise<WeekAdherence> {
  const week = weekDays(today);
  const monday = week[0];
  const sunday = week[6];

  const [[p], rows] = await Promise.all([
    db
      .select({ targetKcal: profile.targetKcal, targetProteinG: profile.targetProteinG })
      .from(profile)
      .where(eq(profile.id, 1)),
    db
      .select({
        date: logEntries.date,
        kcal: sql<number>`coalesce(sum(${logEntries.kcal}), 0)`.mapWith(Number),
        proteinG: sql<number>`coalesce(sum(${logEntries.proteinG}), 0)`.mapWith(Number),
      })
      .from(logEntries)
      .where(and(gte(logEntries.date, monday), lte(logEntries.date, sunday)))
      .groupBy(logEntries.date),
  ]);

  const consumedByDate = new Map<string, Macros>();
  for (const r of rows) consumedByDate.set(r.date, { kcal: r.kcal, proteinG: r.proteinG });

  const targets: Macros = { kcal: p.targetKcal, proteinG: p.targetProteinG };
  return classifyWeek(today, targets, consumedByDate);
}
