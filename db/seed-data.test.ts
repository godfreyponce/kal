import { describe, it, expect } from "vitest";
import { FOODS_V2, MEAL_ITEMS_V2, computeTargets } from "./seed-data";

describe("seed v2 data", () => {
  it("stores weighed foods per 100 g and count foods per natural unit", () => {
    const byName = new Map(FOODS_V2.map((f) => [f.name, f]));
    expect(byName.get("Chicken breast, cooked")).toMatchObject({ servingDesc: "100 g", servingGrams: 100 });
    expect(byName.get("Dry-roasted peanuts, salted")).toMatchObject({ servingDesc: "100 g", servingGrams: 100 });
    expect(byName.get("Large Eggs")).toMatchObject({ servingDesc: "1 egg", servingGrams: null, displayQty: null });
    expect(byName.get("Peanut butter")).toMatchObject({ servingDesc: "1 tbsp" });
  });

  it("carries the owner's display servings (card-only multipliers of the basis)", () => {
    const byName = new Map(FOODS_V2.map((f) => [f.name, f]));
    expect(byName.get("Chicken breast, cooked")).toMatchObject({ displayQty: 1.7 });
    expect(byName.get("White rice, cooked")).toMatchObject({ displayQty: 4 });
    expect(byName.get("Frozen mixed vegetables, cooked")).toMatchObject({ displayQty: 2.5 });
    expect(byName.get("Dry-roasted peanuts, salted")).toMatchObject({ displayQty: 0.4 });
    expect(byName.get("Peanut butter")).toMatchObject({ displayQty: 2 });
  });

  it("has no ground beef — owner removed it from the live library (2026-07-07)", () => {
    expect(FOODS_V2.some((f) => f.name.startsWith("Ground beef"))).toBe(false);
    expect(MEAL_ITEMS_V2.some(([, food]) => food.startsWith("Ground beef"))).toBe(false);
  });

  it("plan quantities are absolute-amount multipliers of the new basis", () => {
    // 170 g chicken on a 100 g basis = 1.7; 40 g peanuts = 0.4
    expect(MEAL_ITEMS_V2).toContainEqual(["Dinner", "Chicken breast, cooked", 1.7]);
    expect(MEAL_ITEMS_V2).toContainEqual(["Dinner", "White rice, cooked", 4]);
    expect(MEAL_ITEMS_V2).toContainEqual(["Peanuts (graze)", "Dry-roasted peanuts, salted", 0.4]);
  });

  it("carries the real GV peanuts label scaled to the 100 g basis, not an estimate", () => {
    // Label: 180 kcal / 8P / 4C / 15F per 28 g serving (verified via USDA + vision).
    const peanuts = FOODS_V2.find((f) => f.name === "Dry-roasted peanuts, salted");
    expect(peanuts).toMatchObject({ kcal: 643, p: 28.6, c: 14.3, f: 53.6, isEstimated: false });
  });

  it("computes targets from the food data (not hand-picked numbers)", () => {
    expect(computeTargets()).toEqual({
      targetKcal: 3603,
      targetProteinG: 216,
      targetCarbsG: 421,
      targetFatG: 125,
    });
  });
});
