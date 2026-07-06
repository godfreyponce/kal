import "../db/env";
import { describe, expect, it } from "vitest";
import { getTodayView } from "./today";

// Integration test against the live DB (Seed v2 plan data). Sentinel date
// 2099-04-04 — own date per file, vitest runs files in parallel.
const DATE = "2099-04-04";

describe("getTodayView meal items", () => {
  it("returns each meal's items resolved to absolute amounts with a 1-serving basis", async () => {
    const view = await getTodayView(DATE);

    const lunch = view.meals.find((m) => m.name === "Lunch");
    expect(lunch).toBeDefined();
    const chicken = lunch!.items.find((i) => i.foodName === "Chicken breast, cooked");
    expect(chicken).toBeDefined();
    // resolved amount for the plate — never a multiplier
    expect(chicken!.amountLabel).toBe("170 g (6 oz)");
    expect(chicken!.rawLabel).toBe("raw ≈ 227 g (8 oz)");
    expect(chicken!.kcal).toBe(281);
    expect(chicken!.proteinG).toBeCloseTo(52.7, 5);
    // 1-serving basis for the tap-to-expand row
    expect(chicken!.servingLabel).toBe("100 g (3.5 oz)");
    expect(chicken!.serving).toEqual({ kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 });
  });

  it("keeps counted foods in their natural unit", async () => {
    const view = await getTodayView(DATE);
    const breakfast = view.meals.find((m) => m.name === "Breakfast");
    const eggs = breakfast!.items.find((i) => i.foodName === "Egg, large");
    expect(eggs).toBeDefined();
    expect(eggs!.amountLabel).toBe("4 egg");
    expect(eggs!.rawLabel).toBeNull();
    expect(eggs!.servingLabel).toBe("1 egg");
    expect(eggs!.serving.kcal).toBe(70);
  });

  it("item kcal lines sum to the meal's plannedKcal for every meal", async () => {
    const view = await getTodayView(DATE);
    expect(view.meals.length).toBeGreaterThan(0);
    for (const m of view.meals) {
      expect(m.items.length).toBeGreaterThan(0);
      const sum = m.items.reduce((acc, i) => acc + i.kcal, 0);
      expect(sum).toBe(m.plannedKcal);
    }
  });
});
