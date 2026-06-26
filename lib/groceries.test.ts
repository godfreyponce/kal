import "../db/env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db";
import { foods, meals, mealItems } from "../db/schema";
import {
  listGroceries,
  createGrocery,
  updateGrocery,
  deleteGrocery,
  getGroceryGroups,
} from "./groceries";

const SENTINEL = "ZZTEST_GROCERY";

async function clearAll() {
  // meal_items references foods/meals — delete it first.
  const testFoods = await db.select({ id: foods.id }).from(foods).where(like(foods.name, "ZZTEST_%"));
  const testMeals = await db.select({ id: meals.id }).from(meals).where(like(meals.name, "ZZTEST_%"));
  for (const f of testFoods) await db.delete(mealItems).where(eq(mealItems.foodId, f.id));
  for (const m of testMeals) await db.delete(mealItems).where(eq(mealItems.mealId, m.id));
  await db.delete(foods).where(like(foods.name, "ZZTEST_%"));
  await db.delete(meals).where(like(meals.name, "ZZTEST_%"));
}
beforeAll(clearAll);
afterAll(clearAll);

describe("grocery CRUD", () => {
  it("creates, lists, updates, and deletes a grocery", async () => {
    const created = await createGrocery({
      name: SENTINEL,
      brand: "TestBrand",
      store: "Walmart",
      category: "protein",
      imageUrl: "https://x.com/chicken.jpg",
      servingGrams: 100,
      kcal: 150,
      proteinG: 30,
      carbsG: 10,
      fatG: 5,
      purchaseWeightG: 1973.13,
      price: 12.5,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.servingGrams).toBe(100);
    expect(created.kcal).toBe(150);
    expect(created.proteinG).toBe(30);
    expect(created.price).toBe(12.5);
    expect(created.imageUrl).toBe("https://x.com/chicken.jpg");

    const all = await listGroceries();
    const listed = all.find((g) => g.id === created.id);
    expect(listed?.name).toBe(SENTINEL);
    expect(listed?.imageUrl).toBe("https://x.com/chicken.jpg");

    const updated = await updateGrocery(created.id, { price: 9.99, store: "Costco" });
    expect(updated?.price).toBe(9.99);
    expect(updated?.store).toBe("Costco");

    await deleteGrocery(created.id);
    const [gone] = await db.select().from(foods).where(eq(foods.id, created.id));
    expect(gone).toBeUndefined();
  });
});

describe("getGroceryGroups", () => {
  it("returns groceries with their meal ids and meals with planned kcal", async () => {
    const food = await createGrocery({
      name: "ZZTEST_GROUPFOOD",
      servingGrams: 100,
      kcal: 200,
      proteinG: 10,
      carbsG: 20,
      fatG: 5,
    });
    const orphan = await createGrocery({
      name: "ZZTEST_ORPHAN",
      servingGrams: 100,
      kcal: 100,
      proteinG: 1,
      carbsG: 1,
      fatG: 1,
    });
    const [meal] = await db
      .insert(meals)
      .values({ name: "ZZTEST_MEAL", sortOrder: 9999 })
      .returning();
    await db.insert(mealItems).values({ mealId: meal.id, foodId: food.id, quantity: "2" });

    const { groceries, meals: mealGroups } = await getGroceryGroups();

    const g = groceries.find((x) => x.id === food.id);
    expect(g?.mealIds).toEqual([meal.id]);

    const o = groceries.find((x) => x.id === orphan.id);
    expect(o?.mealIds).toEqual([]); // not in any meal → Pantry

    const mg = mealGroups.find((m) => m.id === meal.id);
    expect(mg?.name).toBe("ZZTEST_MEAL");
    expect(mg?.plannedKcal).toBe(400); // 200 kcal × quantity 2
  });
});
