import { describe, it, expect } from "vitest";
import { parseLabelNutrition } from "./label-vision";

describe("parseLabelNutrition", () => {
  it("parses a clean JSON object from the model", () => {
    const out = parseLabelNutrition(
      `{"name":"Dry Roasted Peanuts","servingGrams":28,"kcal":180,"proteinG":8,"carbsG":4,"fatG":15}`,
    );
    expect(out).toEqual({
      name: "Dry Roasted Peanuts",
      servingGrams: 28,
      kcal: 180,
      proteinG: 8,
      carbsG: 4,
      fatG: 15,
    });
  });

  it("extracts JSON even when wrapped in prose/fences", () => {
    const out = parseLabelNutrition('Here you go:\n```json\n{"servingGrams":30,"kcal":200,"proteinG":5,"carbsG":36,"fatG":1}\n```');
    expect(out?.kcal).toBe(200);
    expect(out?.name).toBeNull(); // no name in JSON
  });

  it("rounds kcal, 1-decimal macros, and 2-decimal serving", () => {
    const out = parseLabelNutrition(`{"servingGrams":28.349,"kcal":179.6,"proteinG":8.04,"carbsG":3.97,"fatG":15.02}`);
    expect(out).toEqual({ name: null, servingGrams: 28.35, kcal: 180, proteinG: 8, carbsG: 4, fatG: 15 });
  });

  it("returns null when serving or kcal is missing/invalid", () => {
    expect(parseLabelNutrition(`{"kcal":180,"proteinG":8}`)).toBeNull(); // no serving
    expect(parseLabelNutrition(`{"servingGrams":0,"kcal":180}`)).toBeNull(); // serving <= 0
    expect(parseLabelNutrition(`not json at all`)).toBeNull();
  });
});
