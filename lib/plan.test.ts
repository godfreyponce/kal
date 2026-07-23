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

  it("reports per-meal protein summed raw x quantity", async () => {
    const f = await firstFood();
    const { id } = await createMeal({ name: TEST_MEAL });
    await db.insert(mealItems).values({ mealId: id, foodId: f.id, quantity: "2" });
    const view = await getPlanView();
    const m = view.meals.find((x) => x.id === id)!;
    expect(m.proteinG).toBe(Math.round(2 * Number(f.proteinG))); // integer qty -> exact
    const empty = await createMeal({ name: `${TEST_MEAL} empty` });
    const m2 = (await getPlanView()).meals.find((x) => x.id === empty.id)!;
    expect(m2.proteinG).toBe(0);
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

describe("replaceMealItems (template scope)", () => {
  it("replaces items and re-derives targets", async () => {
    const f = await firstFood();
    const { id } = await createMeal({ name: TEST_MEAL, timeHint: "test hint" });
    const base = await recomputeTargets();
    const res = await replaceMealItems(id, [{ foodId: f.id, quantity: 3 }]);
    expect(res.next.kcal).toBe(base.next.kcal + 3 * f.kcal);
    const view = await getPlanView();
    const m = view.meals.find((x) => x.id === id)!;
    expect(m.items).toHaveLength(1);
    expect(m.items[0].foodId).toBe(f.id);
    expect(m.timeHint).toBe("test hint");
    // replace again — last write wins
    const res2 = await replaceMealItems(id, []);
    expect(res2.next.kcal).toBe(base.next.kcal);
  });

  it("rejects unknown meals, unknown foods, and bad quantities", async () => {
    const f = await firstFood();
    await expect(replaceMealItems(999999, [{ foodId: f.id, quantity: 1 }])).rejects.toThrow(/No meal/);
    const { id } = await createMeal({ name: TEST_MEAL });
    await expect(replaceMealItems(id, [{ foodId: 999999, quantity: 1 }])).rejects.toThrow(/No food/);
    await expect(replaceMealItems(id, [{ foodId: f.id, quantity: 0 }])).rejects.toThrow(/positive/);
  });
});

describe("meal CRUD", () => {
  it("createMeal appends with the next sortOrder; updateMeal renames", async () => {
    const { id } = await createMeal({ name: TEST_MEAL });
    const view = await getPlanView();
    const created = view.meals.find((m) => m.id === id)!;
    expect(created.sortOrder).toBe(Math.max(...view.meals.map((m) => m.sortOrder)));
    await updateMeal(id, { name: `${TEST_MEAL} renamed`, timeHint: null });
    const after = (await getPlanView()).meals.find((m) => m.id === id)!;
    expect(after.name).toBe(`${TEST_MEAL} renamed`);
    expect(after.timeHint).toBeNull();
    expect(await updateMeal(999999, { name: "x" })).toBeNull();
  });

  it("deleteMeal cascades items and re-derives targets", async () => {
    const f = await firstFood();
    const { id } = await createMeal({ name: TEST_MEAL });
    const base = await recomputeTargets();
    await replaceMealItems(id, [{ foodId: f.id, quantity: 2 }]);
    const res = await deleteMeal(id);
    expect(res.next.kcal).toBe(base.next.kcal);
    const view = await getPlanView();
    expect(view.meals.find((m) => m.id === id)).toBeUndefined();
    await expect(deleteMeal(id)).rejects.toThrow(/No meal/);
  });
});
