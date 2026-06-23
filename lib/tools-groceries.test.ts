import "../db/env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db";
import { foods, logEntries } from "../db/schema";
import { createGrocery } from "./groceries";
import { runTool } from "./tools";

const TEST_DATE = "2099-03-03";

async function clear() {
  await db.delete(logEntries).where(eq(logEntries.date, TEST_DATE));
  await db.delete(foods).where(like(foods.name, "ZZTOOL_%"));
}
beforeAll(clear);
afterAll(clear);

describe("add_grocery tool", () => {
  it("inserts a food with serving_grams and is_estimated=false", async () => {
    const run = await runTool("add_grocery", {
      name: "ZZTOOL_OIL",
      serving_grams: 14,
      kcal: 120,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 14,
      category: "oil",
    });
    expect(run.summary).toMatch(/Added grocery/);
    const [row] = await db.select().from(foods).where(eq(foods.name, "ZZTOOL_OIL"));
    expect(row).toBeTruthy();
    expect(Number(row.servingGrams)).toBe(14);
    expect(row.isEstimated).toBe(false);
  });
});

describe("log_food by weight", () => {
  it("converts grams to servings and snapshots the right macros", async () => {
    await clear();
    const g = await createGrocery({
      name: "ZZTOOL_CHICKEN",
      servingGrams: 100,
      kcal: 150,
      proteinG: 30,
      carbsG: 10,
      fatG: 5,
    });

    const run = await runTool("log_food", { food_id: g.id, grams: 200, date: TEST_DATE });
    expect(run.writeBatchId).toBeTruthy();

    const [entry] = await db
      .select()
      .from(logEntries)
      .where(eq(logEntries.date, TEST_DATE));
    expect(entry.kcal).toBe(300); // 150 * (200/100)
    expect(entry.proteinG).toBe("60.00");
    expect(entry.carbsG).toBe("20.00");
    expect(entry.fatG).toBe("10.00");
  });

  it("errors if the food has no serving weight set", async () => {
    const g = await createGrocery({
      name: "ZZTOOL_NOGRAMS",
      servingGrams: 100,
      kcal: 10,
      proteinG: 1,
      carbsG: 1,
      fatG: 1,
    });
    // Null out serving_grams to simulate a seeded food.
    await db.update(foods).set({ servingGrams: null }).where(eq(foods.id, g.id));
    const run = await runTool("log_food", { food_id: g.id, oz: 8, date: TEST_DATE });
    expect(run.summary).toMatch(/Error/);
  });
});
