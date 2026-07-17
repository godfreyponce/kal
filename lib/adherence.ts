// Weekly-adherence DB queries. Pure logic lives in lib/adherence-view.ts (DB-free);
// this file adds the Neon reads. classifyWeek stays here (server-only use).

import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { profile, logEntries, foods } from "../db/schema";
import { todayInAppTz } from "./time";
import { resolveItem } from "./resolve-item";
import {
  judgeDay,
  type Macros,
  type DayCell,
  type DayState,
  type WeekAdherence,
  type DayFood,
} from "./adherence-view";
import { classifyHistoryRows, type AdherenceHistory } from "./adherence-calendar";

// Re-export so existing importers (weekly-adherence.tsx, lib/adherence.test.ts) are unchanged.
export { judgeDay, KCAL_TOLERANCE, PROTEIN_FLOOR } from "./adherence-view";
export type { Macros, DayState, DayCell, WeekAdherence, DayFood } from "./adherence-view";

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

import { bucketDayFoods } from "./adherence-view";

/**
 * The week's logged foods, bucketed by date — powers the day-detail modal (#22).
 * One read: every log_entry in the calendar week joined to its food, ordered so the
 * modal shows foods in log order. Numeric columns come back as strings → Number().
 */
export async function getWeekDayFoods(
  today: string = todayInAppTz(),
): Promise<Record<string, DayFood[]>> {
  const week = weekDays(today);
  const rows = await db
    .select({
      date: logEntries.date,
      quantity: sql<number>`${logEntries.quantity}`.mapWith(Number),
      kcal: logEntries.kcal, // integer → already a number
      proteinG: sql<number>`${logEntries.proteinG}`.mapWith(Number),
      name: foods.name,
      servingDesc: foods.servingDesc,
      rawToCookedYield: sql<number | null>`${foods.rawToCookedYield}`.mapWith(
        (v) => (v === null ? null : Number(v)),
      ),
    })
    .from(logEntries)
    .innerJoin(foods, eq(logEntries.foodId, foods.id))
    .where(and(gte(logEntries.date, week[0]), lte(logEntries.date, week[6])))
    .orderBy(asc(logEntries.date), asc(logEntries.id));
  return bucketDayFoods(rows);
}

/**
 * Full adherence history for the #23 calendar sheet: one aggregate row per logged
 * day before `today`, judged here so the client never needs targets.
 * extras = any entry that day with meal_id IS NULL (ad-hoc food outside the plan).
 * Verified (#23 task 2, Step 1): the only production inserts into log_entries are
 * lib/tools.ts:359 (log_food tool — mealId = num(input.meal_id) ?? null, so plan-attached
 * food carries a meal id and ad-hoc/one-off food carries null) and lib/meal-status.ts:111
 * (gap-fill on "eaten", always writes the meal's own non-null mealId). The null/non-null
 * split holds cleanly, so bool_or(meal_id IS NULL) is a correct extras signal.
 */
export async function getAdherenceHistory(today: string = todayInAppTz()): Promise<AdherenceHistory> {
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
        hasExtras: sql<boolean>`bool_or(${logEntries.mealId} is null)`,
      })
      .from(logEntries)
      .where(lt(logEntries.date, today))
      .groupBy(logEntries.date)
      .orderBy(asc(logEntries.date)),
  ]);

  const targets: Macros = { kcal: p.targetKcal, proteinG: p.targetProteinG };
  const days = classifyHistoryRows(rows, targets);
  return { days, firstLogDate: days[0]?.date ?? null };
}
