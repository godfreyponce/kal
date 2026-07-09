import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { foods, logEntries, mealItems, mealStatus } from "../db/schema";
import { getOverridesForDate } from "./overrides";

export type MealStatusValue = "eaten" | "missed" | "substituted" | "pending";

export type SetMealStatusResult = {
  status: MealStatusValue;
  writeBatchId: string | null;
  /** Food ids auto-logged by this call (only the gaps that were filled). */
  loggedFoodIds: number[];
};

// numeric(6,2) columns are read/written as strings; multiply then round to 2dp.
function scale(perServing: string, quantity: string): string {
  return (Number(perServing) * Number(quantity)).toFixed(2);
}

/**
 * Set a planned meal's status for a day.
 *
 * `eaten` fills the gaps: it auto-logs only the planned `meal_items` that aren't
 * already in `log_entries` for `(date, meal_id)` — so marking a meal eaten after a
 * manual log never double-counts. All rows it creates share one `write_batch_id`,
 * and the status row points at the same batch so undo can revert the whole thing.
 *
 * Any other status (e.g. `pending` for undo, `missed`) clears that auto-logged batch
 * first; `pending` then removes the status row entirely (back to untouched), while
 * other statuses persist the row without logging.
 *
 * Note: the neon-http driver has no interactive transactions; these run as sequential
 * statements. Acceptable for this single-user app where there's no concurrent writer.
 */
export async function setMealStatus(
  date: string,
  mealId: number,
  status: MealStatusValue,
): Promise<SetMealStatusResult> {
  await clearExistingBatch(date, mealId);

  if (status !== "eaten") {
    if (status === "pending") {
      await db
        .delete(mealStatus)
        .where(and(eq(mealStatus.date, date), eq(mealStatus.mealId, mealId)));
      return { status, writeBatchId: null, loggedFoodIds: [] };
    }
    const writeBatchId = randomUUID();
    await upsertStatus(date, mealId, status, writeBatchId);
    return { status, writeBatchId, loggedFoodIds: [] };
  }

  const writeBatchId = randomUUID();

  const [templatePlanned, existing, overridesMap] = await Promise.all([
    db
      .select({
        foodId: mealItems.foodId,
        quantity: mealItems.quantity,
        kcal: foods.kcal,
        proteinG: foods.proteinG,
        carbsG: foods.carbsG,
        fatG: foods.fatG,
      })
      .from(mealItems)
      .innerJoin(foods, eq(mealItems.foodId, foods.id))
      .where(eq(mealItems.mealId, mealId)),
    db
      .select({ foodId: logEntries.foodId })
      .from(logEntries)
      .where(and(eq(logEntries.date, date), eq(logEntries.mealId, mealId))),
    getOverridesForDate(date),
  ]);

  // A day-scoped override replaces the template as "what was planned" for today.
  const ov = overridesMap.get(mealId);
  const planned = ov
    ? ov.map((l) => ({
        foodId: l.foodId,
        quantity: String(l.quantity),
        kcal: l.food.kcal,
        proteinG: l.food.proteinG.toFixed(2),
        carbsG: l.food.carbsG.toFixed(2),
        fatG: l.food.fatG.toFixed(2),
      }))
    : templatePlanned;
  const alreadyLogged = new Set(existing.map((e) => e.foodId));

  const gaps = planned.filter((p) => !alreadyLogged.has(p.foodId));

  if (gaps.length > 0) {
    await db.insert(logEntries).values(
      gaps.map((p) => ({
        date,
        mealId,
        foodId: p.foodId,
        quantity: p.quantity,
        kcal: Math.round(p.kcal * Number(p.quantity)),
        proteinG: scale(p.proteinG, p.quantity),
        carbsG: scale(p.carbsG, p.quantity),
        fatG: scale(p.fatG, p.quantity),
        source: "user_ui" as const,
        writeBatchId,
      })),
    );
  }

  await upsertStatus(date, mealId, "eaten", writeBatchId);

  return { status: "eaten", writeBatchId, loggedFoodIds: gaps.map((p) => p.foodId) };
}

// Remove the log_entries previously auto-created for this (date, meal) — identified
// by the status row's write_batch_id — so re-marking or undoing doesn't accumulate.
async function clearExistingBatch(date: string, mealId: number): Promise<void> {
  const [prev] = await db
    .select({ writeBatchId: mealStatus.writeBatchId })
    .from(mealStatus)
    .where(and(eq(mealStatus.date, date), eq(mealStatus.mealId, mealId)));

  if (prev?.writeBatchId) {
    await db.delete(logEntries).where(eq(logEntries.writeBatchId, prev.writeBatchId));
  }
}

async function upsertStatus(
  date: string,
  mealId: number,
  status: MealStatusValue,
  writeBatchId: string | null,
): Promise<void> {
  await db
    .insert(mealStatus)
    .values({ date, mealId, status, writeBatchId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [mealStatus.date, mealStatus.mealId],
      set: { status, writeBatchId, updatedAt: new Date() },
    });
}
