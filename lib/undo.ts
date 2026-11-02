import { and, eq, notExists, sql } from "drizzle-orm";
import { db } from "../db";
import {
  foods,
  logEntries,
  mealItems,
  mealOverrides,
  mealStatus,
  replacedWrites,
  type ReplacedRows,
} from "../db/schema";

/**
 * Save the rows a write is about to delete or overwrite, keyed by that write's
 * batch (null for a Today untap), so Undo of the write can put them back.
 */
export async function saveReplaced(args: {
  date: string;
  mealId: number;
  batchId: string | null;
  rows: ReplacedRows;
}): Promise<void> {
  const { rows } = args;
  if (rows.kind === "override" && rows.overrides.length === 0) return;
  const [replacedBatchId, foodIds] =
    rows.kind === "override"
      ? [rows.overrides[0].writeBatchId, rows.overrides.map((r) => r.foodId)]
      : [rows.status.writeBatchId, rows.logEntries.map((r) => r.foodId)];
  await db.insert(replacedWrites).values({
    date: args.date,
    mealId: args.mealId,
    batchId: args.batchId,
    replacedBatchId,
    foodIds,
    rows,
  });
}

export type RevertResult =
  | { reverted: true; revertedEntries: number }
  | { reverted: false; reason: "replaced" };

/**
 * Revert a write batch: delete the log_entries it created, clear the meal_status
 * row tied to the same batch, and remove any meal_overrides it set. Then put back
 * the rows this batch replaced (saved in replaced_writes, with their original
 * batch ids, so the earlier write is undoable in turn), and GC any one_off foods
 * left unreferenced (log_food's new-food path has no batch column on foods, so
 * orphans are collected by reference-count instead). Powers the chat tool-card Undo.
 *
 * A batch that a later write replaced is refused and nothing changes: undoing it
 * would wipe the newer write's rows.
 * (neon-http has no interactive txns; sequential statements, fine single-user.)
 */
export async function revertWriteBatch(batchId: string): Promise<RevertResult> {
  const [newer] = await db
    .select({ id: replacedWrites.id })
    .from(replacedWrites)
    .where(eq(replacedWrites.replacedBatchId, batchId))
    .limit(1);
  if (newer) return { reverted: false, reason: "replaced" };

  const deleted = await db
    .delete(logEntries)
    .where(eq(logEntries.writeBatchId, batchId))
    .returning({ id: logEntries.id });
  await db.delete(mealStatus).where(eq(mealStatus.writeBatchId, batchId));
  await db.delete(mealOverrides).where(eq(mealOverrides.writeBatchId, batchId));

  // Claim the saved copies in one statement, so a double-tapped Undo restores once.
  const saved = await db
    .delete(replacedWrites)
    .where(eq(replacedWrites.batchId, batchId))
    .returning();
  for (const s of saved) {
    // jsonb hands timestamps back as ISO strings.
    if (s.rows.kind === "override") {
      await db
        .insert(mealOverrides)
        .values(s.rows.overrides.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })));
    } else {
      const { status, logEntries: entries } = s.rows;
      await db.insert(mealStatus).values({ ...status, updatedAt: new Date(status.updatedAt) });
      if (entries.length > 0) {
        await db
          .insert(logEntries)
          .values(entries.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })));
      }
    }
  }

  await db.delete(foods).where(
    and(
      eq(foods.oneOff, true),
      notExists(db.select({ id: logEntries.id }).from(logEntries).where(eq(logEntries.foodId, foods.id))),
      notExists(db.select({ id: mealItems.id }).from(mealItems).where(eq(mealItems.foodId, foods.id))),
      notExists(db.select({ id: mealOverrides.id }).from(mealOverrides).where(eq(mealOverrides.foodId, foods.id))),
      notExists(
        db
          .select({ id: replacedWrites.id })
          .from(replacedWrites)
          .where(sql`${foods.id} = ANY(${replacedWrites.foodIds})`),
      ),
    ),
  );
  return { reverted: true, revertedEntries: deleted.length };
}
