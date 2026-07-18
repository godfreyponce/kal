import "../db/env";
import { describe, it, expect, afterAll } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { foods, logEntries, mealOverrides, meals } from "../db/schema";
import { runTool } from "./tools";
import { revertWriteBatch } from "./undo";

const DATE = "2099-06-06"; // own sentinel — parallel test files

afterAll(async () => {
  await db.delete(mealOverrides).where(eq(mealOverrides.date, DATE));
  await db.delete(logEntries).where(eq(logEntries.date, DATE));
  // Crash-safe net for the log_food test: its rows log on DATE (deleted above),
  // so the food row can always be removed even if the test failed mid-way.
  await db.delete(foods).where(eq(foods.name, "ZZDEV test bowl"));
  await db.delete(foods).where(inArray(foods.name, ["ZZDEV undo one-off", "ZZDEV undo keeper"]));
});

async function firstFood() {
  const [f] = await db.select().from(foods).orderBy(asc(foods.id)).limit(1);
  return f;
}
async function firstMeal() {
  const [m] = await db.select().from(meals).orderBy(asc(meals.sortOrder)).limit(1);
  return m;
}

describe("override_meal tool", () => {
  it("writes an override and returns an undoable card", async () => {
    const f = await firstFood();
    const m = await firstMeal();
    const run = await runTool("override_meal", {
      meal_id: m.id,
      items: [{ food_id: f.id, quantity: 2 }],
      date: DATE,
    });
    expect(run.writeBatchId).toBeTruthy();
    expect(run.card?.label).toBe("Meal adjusted");
    expect(run.forModel).toContain(f.name);
    const rows = await db.select().from(mealOverrides).where(eq(mealOverrides.date, DATE));
    expect(rows).toHaveLength(1);
    await revertWriteBatch(run.writeBatchId!);
    const after = await db.select().from(mealOverrides).where(eq(mealOverrides.date, DATE));
    expect(after).toHaveLength(0);
  });

  it("returns an error result for an unknown food id (nothing written)", async () => {
    const m = await firstMeal();
    const run = await runTool("override_meal", {
      meal_id: m.id,
      items: [{ food_id: 999999, quantity: 1 }],
      date: DATE,
    });
    expect(run.forModel).toContain("error");
    expect(run.writeBatchId).toBeNull();
    const rows = await db.select().from(mealOverrides).where(eq(mealOverrides.date, DATE));
    expect(rows).toHaveLength(0);
  });

  it("returns an error result for malformed item entries (null), not a crash", async () => {
    const m = await firstMeal();
    const run = await runTool("override_meal", { meal_id: m.id, items: [null], date: DATE });
    expect(run.forModel).toContain("error");
    expect(run.writeBatchId).toBeNull();
  });
});

describe("knowledge-ladder tools", () => {
  it("search_nutrition with an empty query returns no hits (no network call)", async () => {
    const run = await runTool("search_nutrition", { query: "  " });
    expect(JSON.parse(run.forModel)).toEqual({ hits: [] });
  });

  it("fetch_page rejects a non-http URL (no network call)", async () => {
    const run = await runTool("fetch_page", { url: "ftp://example.com/menu" });
    expect(run.forModel).toContain("error");
  });
});

describe("log_food off-plan flags", () => {
  it("new-food path honors is_estimated and one_off", async () => {
    const run = await runTool("log_food", {
      name: "ZZDEV test bowl",
      kcal: 500,
      protein_g: 30,
      carbs_g: 50,
      fat_g: 15,
      serving_desc: "1 bowl",
      is_estimated: true,
      one_off: true,
      date: DATE,
    });
    const parsed = JSON.parse(run.forModel);
    expect(parsed.logged.name).toBe("ZZDEV test bowl");
    const [f] = await db.select().from(foods).where(eq(foods.name, "ZZDEV test bowl"));
    // The model must learn the created food's id from the result (it feeds override_meal).
    expect(parsed.logged.foodId).toBe(f.id);
    expect(f.isEstimated).toBe(true);
    expect(f.oneOff).toBe(true);
    // Cleanup: log rows first (foods FK is restrict), then the food itself.
    await db.delete(logEntries).where(eq(logEntries.foodId, f.id));
    await db.delete(foods).where(eq(foods.id, f.id));
  });
});

describe("log_food undo (#12)", () => {
  it("undo deletes the unreferenced one-off food its batch created", async () => {
    const run = await runTool("log_food", {
      name: "ZZDEV undo one-off",
      kcal: 500,
      protein_g: 20,
      carbs_g: 50,
      fat_g: 15,
      is_estimated: true,
      one_off: true,
      date: DATE,
    });
    expect(run.writeBatchId).toBeTruthy();
    const created = await db.select().from(foods).where(eq(foods.name, "ZZDEV undo one-off"));
    expect(created).toHaveLength(1);

    await revertWriteBatch(run.writeBatchId!);

    const after = await db.select().from(foods).where(eq(foods.name, "ZZDEV undo one-off"));
    expect(after).toHaveLength(0);
  });

  it("undo keeps a one-off food still referenced by another batch", async () => {
    const runA = await runTool("log_food", {
      name: "ZZDEV undo one-off",
      kcal: 300,
      one_off: true,
      date: DATE,
    });
    const [food] = await db.select().from(foods).where(eq(foods.name, "ZZDEV undo one-off"));
    const runB = await runTool("log_food", { food_id: food.id, date: DATE });

    await revertWriteBatch(runA.writeBatchId!);
    // batch B's log entry still references it → restrict FK, must survive
    expect(await db.select().from(foods).where(eq(foods.id, food.id))).toHaveLength(1);

    await revertWriteBatch(runB.writeBatchId!);
    // now unreferenced → GC'd
    expect(await db.select().from(foods).where(eq(foods.id, food.id))).toHaveLength(0);
  });

  it("undo keeps a non-one-off food its batch created", async () => {
    const run = await runTool("log_food", {
      name: "ZZDEV undo keeper",
      kcal: 200,
      date: DATE, // one_off omitted → false
    });
    await revertWriteBatch(run.writeBatchId!);
    expect(await db.select().from(foods).where(eq(foods.name, "ZZDEV undo keeper"))).toHaveLength(1);
  });
});
