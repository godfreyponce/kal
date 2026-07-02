import { describe, it, expect } from "vitest";
import { parseServing, resolveItem, formatPlanLine, sumResolved, formatMacros, buildPlanBlock } from "./resolve-item";

const chicken = {
  name: "Chicken breast, cooked",
  servingDesc: "100 g",
  kcal: 165,
  proteinG: 31,
  carbsG: 0,
  fatG: 3.6,
  rawToCookedYield: 0.75,
};
const bread = { name: "Whole wheat bread", servingDesc: "1 slice", kcal: 60, proteinG: 4, carbsG: 11, fatG: 1 };
const oil = { name: "Canola oil", servingDesc: "1 tbsp", kcal: 120, proteinG: 0, carbsG: 0, fatG: 14 };

describe("parseServing", () => {
  it("splits an amount-and-unit description", () => {
    expect(parseServing("100 g")).toEqual({ perAmount: 100, unit: "g" });
    expect(parseServing("1 slice")).toEqual({ perAmount: 1, unit: "slice" });
    expect(parseServing("2 tbsp")).toEqual({ perAmount: 2, unit: "tbsp" });
  });
  it("falls back to per-1 of the whole description when no leading number", () => {
    expect(parseServing("serving")).toEqual({ perAmount: 1, unit: "serving" });
  });
});

describe("resolveItem", () => {
  it("resolves a weighed food to absolute grams (with an oz hint) and scaled macros", () => {
    const r = resolveItem(1.7, chicken);
    expect(r.amountLabel).toBe("170 g (6 oz)");
    expect(r.kcal).toBe(281); // 1.7 × 165 = 280.5 → 281
    expect(r.proteinG).toBeCloseTo(52.7, 5);
    expect(r.carbsG).toBe(0);
    expect(r.fatG).toBeCloseTo(6.1, 5);
  });
  it("resolves a counted food to its natural unit, no oz hint", () => {
    const r = resolveItem(4, bread);
    expect(r.amountLabel).toBe("4 slice");
    expect(r.kcal).toBe(240);
    expect(r.proteinG).toBe(16);
  });
  it("computes the raw-weight equivalent from the stored yield", () => {
    // 170 g cooked / 0.75 = ~227 g (8 oz) raw
    expect(resolveItem(1.7, chicken).rawLabel).toBe("raw ≈ 227 g (8 oz)");
    // dry→cooked ×3: 400 g cooked ← ~133 g dry
    const rice = { name: "White rice, cooked", servingDesc: "100 g", kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, rawToCookedYield: 3 };
    expect(resolveItem(4, rice).rawLabel).toBe("raw ≈ 133 g (4.5 oz)");
    expect(resolveItem(4, bread).rawLabel).toBeNull();
  });
  it("never emits a bare multiplier", () => {
    expect(resolveItem(2.5, chicken).amountLabel).toBe("250 g (9 oz)");
    expect(resolveItem(0.4, chicken).amountLabel).toBe("40 g (1.5 oz)");
    expect(resolveItem(1, oil).amountLabel).toBe("1 tbsp");
    expect(resolveItem(2.5, chicken).amountLabel).not.toContain("×");
  });
});

describe("formatPlanLine", () => {
  it("renders the resolved-line format with the raw equivalent when known", () => {
    expect(formatPlanLine(resolveItem(1.7, chicken), chicken.name)).toBe(
      "- Chicken breast, cooked: 170 g (6 oz) -> 281 kcal, 53g P, 0g C, 6g F [raw ≈ 227 g (8 oz)]",
    );
  });
  it("omits the raw hint when the food has no yield", () => {
    expect(formatPlanLine(resolveItem(2, bread), bread.name)).toBe(
      "- Whole wheat bread: 2 slice -> 120 kcal, 8g P, 22g C, 2g F",
    );
  });
});

describe("sumResolved", () => {
  it("sums the resolved dinner to the brief's totals", () => {
    const rice = { name: "White rice, cooked", servingDesc: "100 g", kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 };
    const veg = { name: "Frozen mixed vegetables, cooked", servingDesc: "100 g", kcal: 55, proteinG: 2.5, carbsG: 11, fatG: 0.4 };
    const dinner = [resolveItem(1.7, chicken), resolveItem(4, rice), resolveItem(1, oil), resolveItem(2.5, veg)];
    const total = sumResolved(dinner);
    expect(total.kcal).toBe(1059); // sum of per-line rounded kcal, matches the displayed lines
    expect(Math.round(total.proteinG)).toBe(70);
    expect(Math.round(total.carbsG)).toBe(140);
    expect(Math.round(total.fatG)).toBe(22);
  });
});

describe("buildPlanBlock", () => {
  it("renders each meal as resolved lines with a total, keeping id + status", () => {
    const block = buildPlanBlock([
      {
        id: 4,
        name: "Dinner",
        status: "pending",
        items: [
          { quantity: 1.7, food: chicken },
          { quantity: 1, food: oil },
        ],
      },
    ]);
    expect(block).toBe(
      [
        "DINNER [meal id 4] [pending]",
        "- Chicken breast, cooked: 170 g (6 oz) -> 281 kcal, 53g P, 0g C, 6g F [raw ≈ 227 g (8 oz)]",
        "- Canola oil: 1 tbsp -> 120 kcal, 0g P, 0g C, 14g F",
        "DINNER TOTAL: 401 kcal, 53g P, 0g C, 20g F",
      ].join("\n"),
    );
    expect(block).not.toContain("×");
  });
  it("marks an empty meal", () => {
    expect(buildPlanBlock([{ id: 9, name: "Snack", status: "eaten", items: [] }])).toBe(
      "SNACK [meal id 9] [eaten]\n(no items)",
    );
  });
});

describe("formatMacros", () => {
  it("renders whole-gram macros", () => {
    expect(formatMacros({ kcal: 1059, proteinG: 69.8, carbsG: 139.5, fatG: 22.4 })).toBe(
      "1059 kcal, 70g P, 140g C, 22g F",
    );
  });
});
