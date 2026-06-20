import "../db/env";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { meals, mealItems, foods, logEntries, mealStatus } from "../db/schema";
import { setMealStatus } from "./meal-status";

// Integration test against the seeded Neon DB. Sentinel date so it never touches
// real days — distinct from day-summary's sentinel so parallel test files can't
// clobber each other's rows. The core invariant: mark-eaten after a manual log
// must NOT double-count.
const TEST_DATE = "2099-02-02";

async function clear() {
  await db.delete(logEntries).where(eq(logEntries.date, TEST_DATE));
  await db.delete(mealStatus).where(eq(mealStatus.date, TEST_DATE));
}

async function breakfastId(): Promise<number> {
  const [m] = await db.select({ id: meals.id }).from(meals).where(eq(meals.name, "Breakfast"));
  return m.id;
}

// The planned items for a meal, with snapshot macros already multiplied by quantity.
async function plannedItems(mealId: number) {
  return db
    .select({
      foodId: foods.id,
      quantity: mealItems.quantity,
      kcal: foods.kcal,
      proteinG: foods.proteinG,
      carbsG: foods.carbsG,
      fatG: foods.fatG,
    })
    .from(mealItems)
    .innerJoin(foods, eq(mealItems.foodId, foods.id))
    .where(eq(mealItems.mealId, mealId));
}

async function loggedRowsForMeal(mealId: number) {
  return db
    .select()
    .from(logEntries)
    .where(and(eq(logEntries.date, TEST_DATE), eq(logEntries.mealId, mealId)));
}

const sumKcal = (rows: { kcal: number }[]) => rows.reduce((a, r) => a + r.kcal, 0);

describe("setMealStatus — fill-the-gaps 'eaten'", () => {
  beforeEach(clear);
  afterAll(clear);

  it("logs every planned item when nothing has been logged yet", async () => {
    const mealId = await breakfastId();
    const planned = await plannedItems(mealId);

    const result = await setMealStatus(TEST_DATE, mealId, "eaten");

    const rows = await loggedRowsForMeal(mealId);
    expect(rows).toHaveLength(planned.length);
    expect(result.loggedFoodIds).toHaveLength(planned.length);
    expect(result.status).toBe("eaten");
    expect(result.writeBatchId).toBeTruthy();

    // Marks the status row eaten and ties it to the same batch.
    const [status] = await db
      .select()
      .from(mealStatus)
      .where(and(eq(mealStatus.date, TEST_DATE), eq(mealStatus.mealId, mealId)));
    expect(status.status).toBe("eaten");
    expect(status.writeBatchId).toBe(result.writeBatchId);
  });

  it("does NOT double-count an item already logged manually", async () => {
    const mealId = await breakfastId();
    const planned = await plannedItems(mealId);
    const plannedKcal = planned.reduce((a, p) => a + Math.round(p.kcal * Number(p.quantity)), 0);

    // Manually pre-log ONE of the planned items (simulating a UI/chat log).
    const first = planned[0];
    await db.insert(logEntries).values({
      date: TEST_DATE,
      mealId,
      foodId: first.foodId,
      quantity: first.quantity,
      kcal: Math.round(first.kcal * Number(first.quantity)),
      proteinG: String(Number(first.proteinG) * Number(first.quantity)),
      carbsG: String(Number(first.carbsG) * Number(first.quantity)),
      fatG: String(Number(first.fatG) * Number(first.quantity)),
      source: "user_ui",
    });

    const result = await setMealStatus(TEST_DATE, mealId, "eaten");

    // Only the gaps were filled: one fewer auto-log than planned items.
    expect(result.loggedFoodIds).toHaveLength(planned.length - 1);
    expect(result.loggedFoodIds).not.toContain(first.foodId);

    const rows = await loggedRowsForMeal(mealId);
    expect(rows).toHaveLength(planned.length); // not planned.length + 1
    expect(sumKcal(rows)).toBe(plannedKcal); // exactly one breakfast, not 1 + the dup item
  });

  it("undo reverts only the auto-logged batch, leaving manual logs intact", async () => {
    const mealId = await breakfastId();
    const planned = await plannedItems(mealId);
    const first = planned[0];

    // A manual log that predates the 'eaten' batch.
    await db.insert(logEntries).values({
      date: TEST_DATE,
      mealId,
      foodId: first.foodId,
      quantity: first.quantity,
      kcal: Math.round(first.kcal * Number(first.quantity)),
      proteinG: String(Number(first.proteinG) * Number(first.quantity)),
      carbsG: String(Number(first.carbsG) * Number(first.quantity)),
      fatG: String(Number(first.fatG) * Number(first.quantity)),
      source: "user_ui",
    });

    await setMealStatus(TEST_DATE, mealId, "eaten");
    await setMealStatus(TEST_DATE, mealId, "pending"); // undo

    const rows = await loggedRowsForMeal(mealId);
    expect(rows).toHaveLength(1); // only the manual log survives
    expect(rows[0].foodId).toBe(first.foodId);

    const statusRows = await db
      .select()
      .from(mealStatus)
      .where(and(eq(mealStatus.date, TEST_DATE), eq(mealStatus.mealId, mealId)));
    expect(statusRows).toHaveLength(0); // status cleared
  });
});
