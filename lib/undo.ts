import { and, eq, notExists } from "drizzle-orm";
import { db } from "../db";
import { foods, logEntries, mealItems, mealOverrides, mealStatus } from "../db/schema";

/**
 * Revert a write batch: delete the log_entries it created, clear the meal_status
 * row tied to the same batch, and remove any meal_overrides it set, then GC any
 * one_off foods left unreferenced (log_food's new-food path has no batch column
 * on foods, so orphans are collected by reference-count instead). Powers the
 * chat tool-card Undo.
 * (neon-http has no interactive txns; sequential deletes, fine single-user.)
 */
export async function revertWriteBatch(batchId: string): Promise<{ revertedEntries: number }> {
  const deleted = await db
    .delete(logEntries)
    .where(eq(logEntries.writeBatchId, batchId))
    .returning({ id: logEntries.id });
  await db.delete(mealStatus).where(eq(mealStatus.writeBatchId, batchId));
  await db.delete(mealOverrides).where(eq(mealOverrides.writeBatchId, batchId));
  await db.delete(foods).where(
    and(
      eq(foods.oneOff, true),
      notExists(db.select({ id: logEntries.id }).from(logEntries).where(eq(logEntries.foodId, foods.id))),
      notExists(db.select({ id: mealItems.id }).from(mealItems).where(eq(mealItems.foodId, foods.id))),
      notExists(db.select({ id: mealOverrides.id }).from(mealOverrides).where(eq(mealOverrides.foodId, foods.id))),
    ),
  );
  return { revertedEntries: deleted.length };
}
