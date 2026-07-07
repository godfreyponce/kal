import { describe, it, expect } from "vitest";
import { servingDisplay, type ServingDisplayFood } from "./serving-display";

const chicken: ServingDisplayFood = {
  name: "Chicken breast, cooked", servingDesc: "100 g", displayQty: 1.7,
  kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6, rawToCookedYield: 0.75,
};
const rice: ServingDisplayFood = {
  name: "White rice, cooked", servingDesc: "100 g", displayQty: 4,
  kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, rawToCookedYield: 3.0,
};
const veg: ServingDisplayFood = {
  name: "Frozen mixed vegetables, cooked", servingDesc: "100 g", displayQty: 2.5,
  kcal: 55, proteinG: 2.5, carbsG: 11, fatG: 0.4, rawToCookedYield: null,
};
const pb: ServingDisplayFood = {
  name: "Peanut butter", servingDesc: "1 tbsp", displayQty: 2,
  kcal: 95, proteinG: 3.5, carbsG: 3.5, fatG: 8, rawToCookedYield: null,
};
const egg: ServingDisplayFood = {
  name: "Large Eggs", servingDesc: "1 egg", displayQty: 1,
  kcal: 70, proteinG: 6, carbsG: 0.5, fatG: 5, rawToCookedYield: null,
};

describe("servingDisplay", () => {
  it("weighed food with a yield: oz-first cooked label, raw flip, macros identical", () => {
    const d = servingDisplay(chicken);
    expect(d.title).toBe("Chicken breast");
    expect(d.base).toEqual({ amount: "6 oz (170 g)", suffix: "cooked" });
    expect(d.baseMacros).toEqual({ kcal: 281, proteinG: 52.7, carbsG: 0, fatG: 6.1 });
    expect(d.flip).toEqual({
      amount: "8 oz (227 g)", suffix: "uncooked",
      macros: { kcal: 281, proteinG: 52.7, carbsG: 0, fatG: 6.1 },
    });
  });

  it("rice: dry-side flip from the dry→cooked yield", () => {
    const d = servingDisplay(rice);
    expect(d.base.amount).toBe("14 oz (400 g)");
    expect(d.flip!.amount).toBe("4.5 oz (133 g)");
    expect(d.flip!.suffix).toBe("uncooked");
  });

  it("weighed food without a yield: static, no cooked suffix", () => {
    const d = servingDisplay(veg);
    expect(d.base).toEqual({ amount: "9 oz (250 g)", suffix: null });
    expect(d.flip).toBeNull();
  });

  it("count food with qty > 1: 1-unit flip whose macros scale", () => {
    const d = servingDisplay(pb);
    expect(d.base).toEqual({ amount: "2 tbsp", suffix: null });
    expect(d.baseMacros.kcal).toBe(190);
    expect(d.flip).toEqual({
      amount: "1 tbsp", suffix: null,
      macros: { kcal: 95, proteinG: 3.5, carbsG: 3.5, fatG: 8 },
    });
  });

  it("count food at qty 1: static", () => {
    const d = servingDisplay(egg);
    expect(d.title).toBe("Large Eggs");
    expect(d.base).toEqual({ amount: "1 egg", suffix: null });
    expect(d.flip).toBeNull();
  });

  it("fractional weighed qty rounds to the 0.5-oz kitchen hint", () => {
    const d = servingDisplay({ ...veg, name: "Dry-roasted peanuts, salted", displayQty: 0.4, kcal: 643, proteinG: 28.6, carbsG: 14.3, fatG: 53.6 });
    expect(d.base.amount).toBe("1.5 oz (40 g)");
  });
});
