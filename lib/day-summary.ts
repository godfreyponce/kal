import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { profile, logEntries } from "../db/schema";

type Macros = { kcal: number; proteinG: number; carbsG: number; fatG: number };

export type DaySummary = {
  date: string;
  targets: Macros;
  consumed: Macros;
  remaining: Macros;
};

/**
 * Remaining macros for a given day = profile targets - sum(that day's log_entries).
 * One query, no LLM math. The single source of "what's left today".
 */
export async function getDaySummary(date: string): Promise<DaySummary> {
  // Independent queries — run them in one parallel batch (neon-http does one
  // HTTP round-trip per query, so sequential awaits stack latency).
  const [[p], [consumed]] = await Promise.all([
    db.select().from(profile).where(eq(profile.id, 1)),
    db
      .select({
        kcal: sql<number>`coalesce(sum(${logEntries.kcal}), 0)`.mapWith(Number),
        proteinG: sql<number>`coalesce(sum(${logEntries.proteinG}), 0)`.mapWith(Number),
        carbsG: sql<number>`coalesce(sum(${logEntries.carbsG}), 0)`.mapWith(Number),
        fatG: sql<number>`coalesce(sum(${logEntries.fatG}), 0)`.mapWith(Number),
      })
      .from(logEntries)
      .where(eq(logEntries.date, date)),
  ]);

  const targets: Macros = {
    kcal: p.targetKcal,
    proteinG: p.targetProteinG,
    carbsG: p.targetCarbsG,
    fatG: p.targetFatG,
  };

  const remaining: Macros = {
    kcal: targets.kcal - consumed.kcal,
    proteinG: targets.proteinG - consumed.proteinG,
    carbsG: targets.carbsG - consumed.carbsG,
    fatG: targets.fatG - consumed.fatG,
  };

  return { date, targets, consumed, remaining };
}
