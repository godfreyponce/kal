import { describe, it, expect } from "vitest";
import { normalizeOffProduct, normalizeFdcFood } from "./nutrition-lookup";

describe("normalizeOffProduct", () => {
  it("maps a populated OFF product (per 100g basis when no serving)", () => {
    const hit = normalizeOffProduct({
      code: "0078742110431",
      product_name: "Great Value Cocktail Peanuts",
      brands: "Great Value, Walmart",
      nutriments: {
        "energy-kcal_100g": 607,
        proteins_100g: 28.57,
        carbohydrates_100g: 14.29,
        fat_100g: 53.57,
      },
    });
    expect(hit).toEqual({
      source: "OpenFoodFacts",
      code: "0078742110431",
      name: "Great Value Cocktail Peanuts",
      brand: "Great Value",
      kcal: 607,
      proteinG: 28.6,
      carbsG: 14.3,
      fatG: 53.6,
      servingGrams: 100,
    });
  });

  it("scales per-100g down to the label serving when serving_quantity is present", () => {
    const hit = normalizeOffProduct({
      code: "1", product_name: "X", brands: "",
      nutriments: { "energy-kcal_100g": 643, proteins_100g: 28.6, carbohydrates_100g: 14.3, fat_100g: 53.6 },
      serving_quantity: 28,
    });
    expect(hit?.servingGrams).toBe(28);
    expect(hit?.kcal).toBe(180);
    expect(hit?.proteinG).toBe(8);
  });

  it("accepts brands as an array; missing macros become 0", () => {
    const hit = normalizeOffProduct({
      code: "2", product_name: "Y", brands: ["Walmart"],
      nutriments: { "energy-kcal_100g": 100 },
    });
    expect(hit?.brand).toBe("Walmart");
    expect(hit?.carbsG).toBe(0);
  });

  it("returns null when there is no kcal data, or no name", () => {
    expect(normalizeOffProduct({ code: "x", product_name: "GV", nutriments: {} })).toBeNull();
    expect(normalizeOffProduct({ code: "x", product_name: "", nutriments: { "energy-kcal_100g": 200 } })).toBeNull();
  });
});

describe("normalizeFdcFood", () => {
  it("maps a USDA branded food, scaling per-100g to the gram serving", () => {
    const hit = normalizeFdcFood({
      fdcId: 2524354,
      gtinUpc: "078742083186",
      description: "DRY ROASTED PEANUTS",
      brandName: "GREAT VALUE",
      servingSize: 28,
      servingSizeUnit: "GRM",
      foodNutrients: [
        { nutrientId: 1008, value: 643, unitName: "KCAL" },
        { nutrientId: 1003, value: 28.6 },
        { nutrientId: 1005, value: 14.3 },
        { nutrientId: 1004, value: 53.6 },
      ],
    });
    expect(hit).toEqual({
      source: "USDA",
      code: "078742083186",
      name: "DRY ROASTED PEANUTS",
      brand: "GREAT VALUE",
      kcal: 180, // 643 * 28/100
      proteinG: 8, // 28.6 * 0.28
      carbsG: 4, // 14.3 * 0.28
      fatG: 15, // 53.6 * 0.28
      servingGrams: 28,
    });
  });

  it("returns null when energy (1008) is absent", () => {
    expect(
      normalizeFdcFood({ fdcId: 1, description: "Z", foodNutrients: [{ nutrientId: 1003, value: 5 }] }),
    ).toBeNull();
  });
});
