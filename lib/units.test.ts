import { describe, it, expect } from "vitest";
import { toGrams, weightToServings, OZ_TO_G } from "./units";

describe("toGrams", () => {
  it("passes grams through unchanged", () => {
    expect(toGrams(200, "g")).toBe(200);
  });
  it("converts ounces", () => {
    expect(toGrams(8, "oz")).toBeCloseTo(226.796, 2);
    expect(OZ_TO_G).toBe(28.3495);
  });
  it("converts pounds", () => {
    expect(toGrams(1, "lb")).toBeCloseTo(453.592, 2);
    expect(toGrams(4.35, "lb")).toBeCloseTo(1973.13, 1);
  });
});

describe("weightToServings", () => {
  it("divides grams by the serving weight", () => {
    expect(weightToServings(200, 100)).toBe(2);
    expect(weightToServings(226.796, 113.398)).toBeCloseTo(2, 4);
  });
});
