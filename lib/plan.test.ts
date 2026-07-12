// lib/plan.test.ts
import "../db/env";
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { asc, eq, like } from "drizzle-orm";
import { db } from "../db";
import { foods, mealItems, meals, profile } from "../db/schema";
import { getPlanView, recomputeTargets, replaceMealItems, createMeal, updateMeal, deleteMeal } from "./plan";

// Sentinel meal name for this FILE (parallel-safe); targets snapshot/restore
// because recomputeTargets writes the live profile row.
const TEST_MEAL = "zz test plan 2099-06-06";
let targetSnapshot: { targetKcal: number; targetProteinG: number; targetCarbsG: number; targetFatG: number };

beforeAll(async () => {
  const [row] = await db.select().from(profile).where(eq(profile.id, 1));
  targetSnapshot = {
    targetKcal: row.targetKcal,
    targetProteinG: row.targetProteinG,
    targetCarbsG: row.targetCarbsG,
    targetFatG: row.targetFatG,
  };
});

async function cleanup() {
  await db.delete(meals).where(like(meals.name, `${TEST_MEAL}%`)); // meal_items cascade
  if (targetSnapshot) await db.update(profile).set(targetSnapshot).where(eq(profile.id, 1));
}
afterEach(cleanup);
afterAll(cleanup);

async function firstFood() {
  const [f] = await db.select().from(foods).orderBy(asc(foods.id)).limit(1);
  return f;
}

describe("getPlanView", () => {
  it("returns sorted meals with resolved items and rounded totals", async () => {
    const view = await getPlanView();
    expect(view.meals.length).toBeGreaterThan(0);
    const sorts = view.meals.map((m) => m.sortOrder);
    expect(sorts).toEqual([...sorts].sort((a, b) => a - b));
    const anyItem = view.meals.flatMap((m) => m.items)[0];
    expect(anyItem.amountLabel).toBeTruthy();
    expect(typeof anyItem.kcal).toBe("number");
    expect(view.totals.kcal).toBeGreaterThan(0);
  });
});

describe("recomputeTargets", () => {
  it("derives targets from the live plan and reports old vs next", async () => {
    const f = await firstFood();
    const { id } = await createMeal({ name: TEST_MEAL });
    const base = await recomputeTargets(); // plan without test items
    await db.insert(mealItems).values({ mealId: id, foodId: f.id, quantity: "2" });
    const res = await recomputeTargets();
    expect(res.old.kcal).toBe(base.next.kcal);
    expect(res.next.kcal).toBe(base.next.kcal + 2 * f.kcal); // integer qty → exact
    const [row] = await db.select().from(profile).where(eq(profile.id, 1));
    expect(row.targetKcal).toBe(res.next.kcal);
  });
});
