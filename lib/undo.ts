import { eq } from "drizzle-orm";
import { db } from "../db";
import { logEntries, mealStatus } from "../db/schema";

/**
 * Revert a write batch: delete the log_entries it created and clear the
 * meal_status row tied to the same batch. Powers the chat tool-card Undo.
 * (neon-http has no interactive txns; two sequential deletes, fine single-user.)
 */
export async function revertWriteBatch(batchId: string): Promise<{ revertedEntries: number }> {
  const deleted = await db
    .delete(logEntries)
    .where(eq(logEntries.writeBatchId, batchId))
    .returning({ id: logEntries.id });
  await db.delete(mealStatus).where(eq(mealStatus.writeBatchId, batchId));
  return { revertedEntries: deleted.length };
}
