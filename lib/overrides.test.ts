import "../db/env";
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { foods, logEntries, mealOverrides, meals, mealStatus } from "../db/schema";
import { getOverridesForDate, setMealOverride } from "./overrides";
import { revertWriteBatch } from "./undo";

// Own sentinel per test FILE — vitest runs files in parallel against live Neon.
const DATE = "2099-05-05";

async function cleanup() {
  await db.delete(mealOverrides).where(eq(mealOverrides.date, DATE));
  await db.delete(logEntries).where(eq(logEntries.date, DATE));
  await db.delete(mealStatus).where(eq(mealStatus.date, DATE));
}
afterEach(cleanup);
afterAll(cleanup);

// Pick real seeded rows dynamically — food names change over time (e.g. the
// Large Eggs rename), so never hardcode them.
async function anyTwoFoods() {
  return db.select().from(foods).orderBy(asc(foods.id)).limit(2);
}
async function firstMeal() {
  const [m] = await db
    .select({ id: meals.id, name: meals.name })
    .from(meals)
    .orderBy(asc(meals.sortOrder))
    .limit(1);
  return m;
}

describe("setMealOverride", () => {
  it("writes rows and returns resolved lines + total + batch id", async () => {
    const [f1, f2] = await anyTwoFoods();
    const meal = await firstMeal();
    const res = await setMealOverride(DATE, meal.id, [
      { foodId: f1.id, quantity: 1 },
      { foodId: f2.id, quantity: 2 },
    ]);
    expect(res.writeBatchId).toBeTruthy();
    expect(res.lines).toHaveLength(2);
    expect(res.lines[0]).toContain(f1.name);
    expect(res.total).toMatch(/kcal/);
    const rows = await db
      .select()
      .from(mealOverrides)
      .where(and(eq(mealOverrides.date, DATE), eq(mealOverrides.mealId, meal.id)));
    expect(rows).toHaveLength(2);
  });

  it("re-override replaces the previous rows (last write wins)", async () => {
    const [f1, f2] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [
      { foodId: f1.id, quantity: 1 },
      { foodId: f2.id, quantity: 1 },
    ]);
    await setMealOverride(DATE, meal.id, [{ foodId: f2.id, quantity: 3 }]);
    const map = await getOverridesForDate(DATE);
    const lines = map.get(meal.id)!;
    expect(lines).toHaveLength(1);
    expect(lines[0].foodId).toBe(f2.id);
    expect(lines[0].quantity).toBe(3);
  });

  it("rejects unknown food ids, empty item lists, and non-positive quantities", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    await expect(
      setMealOverride(DATE, meal.id, [{ foodId: 999999, quantity: 1 }]),
    ).rejects.toThrow(/No food/);
    await expect(setMealOverride(DATE, meal.id, [])).rejects.toThrow(/non-empty/);
    await expect(
      setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 0 }]),
    ).rejects.toThrow(/positive/);
    await expect(
      setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: -1 }]),
    ).rejects.toThrow(/positive/);
  });
});

describe("undo", () => {
  it("revertWriteBatch removes the override rows", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    const res = await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 1 }]);
    await revertWriteBatch(res.writeBatchId);
    const map = await getOverridesForDate(DATE);
    expect(map.has(meal.id)).toBe(false);
  });
});
