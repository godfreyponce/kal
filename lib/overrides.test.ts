import "../db/env";
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  foods,
  logEntries,
  mealOverrides,
  meals,
  mealStatus,
  replacedWrites,
} from "../db/schema";
import { getOverridesForDate, setMealOverride } from "./overrides";
import { getTodayView } from "./today";
import { revertWriteBatch } from "./undo";
import { setMealStatus } from "./meal-status";

// Own sentinel per test FILE — vitest runs files in parallel against live Neon.
const DATE = "2099-05-05";

async function cleanup() {
  await db.delete(mealOverrides).where(eq(mealOverrides.date, DATE));
  await db.delete(logEntries).where(eq(logEntries.date, DATE));
  await db.delete(mealStatus).where(eq(mealStatus.date, DATE));
  await db.delete(replacedWrites).where(eq(replacedWrites.date, DATE));
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
    await expect(
      setMealOverride(DATE, 999999, [{ foodId: f1.id, quantity: 1 }]),
    ).rejects.toThrow(/No meal/);
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

  // Each line as (foodId, quantity), so a restored list compares by value.
  async function linesFor(mealId: number) {
    const map = await getOverridesForDate(DATE);
    return (map.get(mealId) ?? []).map((l) => [l.foodId, l.quantity]);
  }

  it("undoing a second override restores the first list", async () => {
    const [f1, f2] = await anyTwoFoods();
    const meal = await firstMeal();
    const a = await setMealOverride(DATE, meal.id, [
      { foodId: f1.id, quantity: 1 },
      { foodId: f2.id, quantity: 1 },
    ]);
    const b = await setMealOverride(DATE, meal.id, [{ foodId: f2.id, quantity: 3 }]);
    expect(await revertWriteBatch(b.writeBatchId)).toMatchObject({ reverted: true });
    expect(await linesFor(meal.id)).toEqual([
      [f1.id, 1],
      [f2.id, 1],
    ]);
    const rows = await db.select().from(mealOverrides).where(eq(mealOverrides.date, DATE));
    expect(rows.every((r) => r.writeBatchId === a.writeBatchId)).toBe(true);
  });

  it("undo on a replaced override is refused and changes nothing", async () => {
    const [f1, f2] = await anyTwoFoods();
    const meal = await firstMeal();
    const a = await setMealOverride(DATE, meal.id, [
      { foodId: f1.id, quantity: 1 },
      { foodId: f2.id, quantity: 1 },
    ]);
    await setMealOverride(DATE, meal.id, [{ foodId: f2.id, quantity: 3 }]);
    expect(await revertWriteBatch(a.writeBatchId)).toEqual({
      reverted: false,
      reason: "replaced",
    });
    expect(await linesFor(meal.id)).toEqual([[f2.id, 3]]);
  });

  it("undo walks back a chain of three overrides", async () => {
    const [f1, f2] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 1 }]);
    const b = await setMealOverride(DATE, meal.id, [{ foodId: f2.id, quantity: 2 }]);
    const c = await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 3 }]);
    expect(await revertWriteBatch(c.writeBatchId)).toMatchObject({ reverted: true });
    expect(await linesFor(meal.id)).toEqual([[f2.id, 2]]);
    expect(await revertWriteBatch(b.writeBatchId)).toMatchObject({ reverted: true });
    expect(await linesFor(meal.id)).toEqual([[f1.id, 1]]);
  });

  it("a second revert of the same batch is a no-op", async () => {
    const [f1, f2] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 1 }]);
    const b = await setMealOverride(DATE, meal.id, [{ foodId: f2.id, quantity: 3 }]);
    await revertWriteBatch(b.writeBatchId);
    expect(await revertWriteBatch(b.writeBatchId)).toEqual({ reverted: true, revertedEntries: 0 });
    expect(await linesFor(meal.id)).toEqual([[f1.id, 1]]);
  });

  it("GC keeps a one-off food that only a saved copy references", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    const [oneOff] = await db
      .insert(foods)
      .values({
        name: "ZZDEV replaced one-off",
        servingDesc: "1 bowl",
        kcal: 100,
        proteinG: "10",
        carbsG: "10",
        fatG: "1",
        oneOff: true,
      })
      .returning();
    try {
      await setMealOverride(DATE, meal.id, [{ foodId: oneOff.id, quantity: 1 }]);
      const b = await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 1 }]);
      await revertWriteBatch(randomUUID()); // runs only the GC
      const kept = await db.select().from(foods).where(eq(foods.id, oneOff.id));
      expect(kept).toHaveLength(1);
      expect(await revertWriteBatch(b.writeBatchId)).toMatchObject({ reverted: true });
      expect(await linesFor(meal.id)).toEqual([[oneOff.id, 1]]);
    } finally {
      await cleanup();
      await db.delete(foods).where(eq(foods.id, oneOff.id));
    }
  });
});

describe("getTodayView with overrides", () => {
  it("renders override items, recomputes plannedKcal, and marks the meal adjusted", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 2 }]);
    const view = await getTodayView(DATE);
    const m = view.meals.find((x) => x.id === meal.id)!;
    expect(m.adjusted).toBe(true);
    expect(m.items).toHaveLength(1);
    expect(m.items[0].foodName).toBe(f1.name);
    expect(m.plannedKcal).toBe(m.items[0].kcal);
    expect(view.meals.filter((x) => x.id !== meal.id).every((x) => !x.adjusted)).toBe(true);
  });
});

describe("mark-eaten with an override", () => {
  it("logs the override items, not the template's", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 2 }]);
    const res = await setMealStatus(DATE, meal.id, "eaten");
    expect(res.loggedFoodIds).toEqual([f1.id]);
    const rows = await db
      .select()
      .from(logEntries)
      .where(and(eq(logEntries.date, DATE), eq(logEntries.mealId, meal.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].foodId).toBe(f1.id);
    expect(rows[0].kcal).toBe(Math.round(f1.kcal * 2));
  });

  it("gap-fill skips an override food already logged without a meal_id (no double count)", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 2 }]);
    // The chat's deviation flow may log the replacement unattached (meal_id null).
    await db.insert(logEntries).values({
      date: DATE,
      mealId: null,
      foodId: f1.id,
      quantity: "2",
      kcal: Math.round(f1.kcal * 2),
      proteinG: (Number(f1.proteinG) * 2).toFixed(2),
      carbsG: (Number(f1.carbsG) * 2).toFixed(2),
      fatG: (Number(f1.fatG) * 2).toFixed(2),
      source: "assistant_tool",
    });
    const res = await setMealStatus(DATE, meal.id, "eaten");
    expect(res.loggedFoodIds).toEqual([]);
    const rows = await db.select().from(logEntries).where(eq(logEntries.date, DATE));
    expect(rows).toHaveLength(1);
  });

  it("undoing mark-eaten reverts the logs but keeps the override", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 1 }]);
    await setMealStatus(DATE, meal.id, "eaten");
    await setMealStatus(DATE, meal.id, "pending");
    const logs = await db.select().from(logEntries).where(eq(logEntries.date, DATE));
    expect(logs).toHaveLength(0);
    const map = await getOverridesForDate(DATE);
    expect(map.get(meal.id)).toHaveLength(1); // separate batch — override survives
  });
});

describe("getOverridesForDate line shape", () => {
  it("carries servingGrams so the plan editor can seed from a line", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 1 }]);
    const map = await getOverridesForDate(DATE);
    const line = map.get(meal.id)![0];
    expect(line.food.servingGrams).toEqual(
      f1.servingGrams === null ? null : Number(f1.servingGrams),
    );
  });
});
