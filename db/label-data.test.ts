import { describe, it, expect } from "vitest";
import { LABEL_FOODS, perBasis } from "./label-data";

describe("perBasis", () => {
  it("rebases a raw label to the cooked 100 g basis", () => {
    expect(perBasis({ basisG: 100, cookedPerRaw: 0.75, servingG: 112, kcal: 120, p: 26, c: 0, f: 1.5 }))
      .toEqual({ kcal: 143, p: 31, c: 0, f: 1.8 });
  });

  it("rebases a dry rice label at the 3x cooked yield", () => {
    expect(perBasis({ basisG: 100, cookedPerRaw: 3, servingG: 45, kcal: 160, p: 3, c: 36, f: 0 }))
      .toEqual({ kcal: 119, p: 2.2, c: 26.7, f: 0 });
  });

  it("count food keeps the label numbers", () => {
    expect(perBasis({ basisG: 14, cookedPerRaw: 1, servingG: 14, kcal: 120, p: 0, c: 0, f: 14 }))
      .toEqual({ kcal: 120, p: 0, c: 0, f: 14 });
  });

  it("converts every table row to the owner-confirmed values", () => {
    const got = Object.fromEntries(LABEL_FOODS.map((l) => [l.newName ?? l.name, perBasis(l)]));
    expect(got).toEqual({
      "Large Eggs": { kcal: 70, p: 6, c: 0, f: 5 },
      "Banana, medium": { kcal: 105, p: 1.3, c: 27, f: 0.4 },
      "Chicken breast, cooked": { kcal: 160, p: 30, c: 0, f: 3.5 },
      "White rice, cooked": { kcal: 115, p: 2.6, c: 25.6, f: 0 },
      "Canola oil": { kcal: 120, p: 0, c: 0, f: 14 },
      "Frozen mixed vegetables, cooked": { kcal: 69, p: 2.3, c: 12.6, f: 0 },
      "Mozzarella cheese": { kcal: 29, p: 2.5, c: 0.7, f: 2.1 },
      "Horizon Organic 2% milk (DHA)": { kcal: 130, p: 8, c: 13, f: 5 },
    });
  });
});
