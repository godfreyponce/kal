import { describe, expect, it } from "vitest";
import { buildGroceryPatch, toForm, type FormState } from "./grocery-form";
import type { GroceryGroupItem } from "./groceries";

// A weighed food: 170 g per serving, owner eats one serving.
const weighed: FormState = {
  id: 1, name: "Chicken breast", brand: "Kirkland", store: "Costco", link: "",
  imageUrl: "", category: "protein",
  serving: "170", servingUnit: "g", myServing: "170", myServingUnit: "g", basisUnit: null,
  kcal: "280", proteinG: "53", carbsG: "0", fatG: "6",
  purchase: "", purchaseUnit: "lb", price: "",
};

// A count food: the basis is "tbsp", so there is no gram serving size at all.
const count: FormState = { ...weighed, name: "Olive oil", basisUnit: "tbsp", serving: "", myServing: "2" };

describe("buildGroceryPatch", () => {
  it("sends servingGrams and a servings-ratio displayQty for a weighed food", () => {
    const r = buildGroceryPatch(weighed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.servingGrams).toBe(170);
    expect(r.body.displayQty).toBe(1);
    expect(r.body.kcal).toBe(280);
    expect(r.body.brand).toBe("Kirkland");
  });

  it("converts oz to grams for both the serving size and my serving", () => {
    const r = buildGroceryPatch({ ...weighed, serving: "6", servingUnit: "oz", myServing: "12", myServingUnit: "oz" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.servingGrams).toBeCloseTo(170.097, 3);
    expect(r.body.displayQty).toBeCloseTo(2, 6);
  });

  // THE LANDMINE. updateGrocery rewrites servingDesc to "<n> g" whenever
  // servingGrams arrives, which would clobber "1 tbsp" into "170 g".
  it("omits servingGrams entirely for a count food", () => {
    const r = buildGroceryPatch(count);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("servingGrams" in r.body).toBe(false);
    expect(r.body.displayQty).toBe(2); // raw count, NOT divided by anything
  });

  it("accepts a count food with no serving size", () => {
    expect(buildGroceryPatch({ ...count, serving: "" }).ok).toBe(true);
  });

  it("clears displayQty when my serving is blank", () => {
    const r = buildGroceryPatch({ ...weighed, myServing: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.displayQty).toBeNull();
  });

  it("nulls the optional strings when blank", () => {
    const r = buildGroceryPatch({ ...weighed, brand: "", store: "", link: "", imageUrl: "", category: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.brand).toBeNull();
    expect(r.body.store).toBeNull();
    expect(r.body.link).toBeNull();
    expect(r.body.imageUrl).toBeNull();
    expect(r.body.category).toBeNull();
  });

  it("converts the package weight from lb and nulls a blank price", () => {
    const r = buildGroceryPatch({ ...weighed, purchase: "6", purchaseUnit: "lb", price: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.purchaseWeightG).toBeCloseTo(2721.552, 3);
    expect(r.body.price).toBeNull();
  });

  it("rejects a blank name", () => {
    expect(buildGroceryPatch({ ...weighed, name: "  " })).toEqual({
      ok: false,
      error: "Name and calories are required (plus a positive serving size for weighed foods).",
    });
  });

  it("rejects a zero serving size on a weighed food", () => {
    expect(buildGroceryPatch({ ...weighed, serving: "0" }).ok).toBe(false);
  });

  it("rejects a non-positive my serving", () => {
    expect(buildGroceryPatch({ ...weighed, myServing: "0" })).toEqual({
      ok: false,
      error: "My serving must be a positive number.",
    });
  });

  // Pinning existing behavior, not endorsing it: Number("") is 0 and 0 is finite,
  // so a blank calorie box saves as 0 rather than erroring. Preserved deliberately.
  it("treats a blank calorie box as zero", () => {
    const r = buildGroceryPatch({ ...weighed, kcal: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.kcal).toBe(0);
  });

  it("trims the name", () => {
    const r = buildGroceryPatch({ ...weighed, name: "  Chicken breast  " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.name).toBe("Chicken breast");
  });
});

describe("toForm", () => {
  const base = {
    id: 7, name: "Olive oil", brand: null, store: null, link: null, imageUrl: null,
    category: "fat", rawToCookedYield: null, kcal: 119, proteinG: 0, carbsG: 0, fatG: 13.5,
    purchaseWeightG: null, price: null, isEstimated: true, mealIds: [],
  };

  it("derives basisUnit from servingDesc for a count food", () => {
    const g = { ...base, servingGrams: null, servingDesc: "1 tbsp", displayQty: 2 } as GroceryGroupItem;
    const f = toForm(g);
    expect(f.basisUnit).toBe("tbsp");
    expect(f.myServing).toBe("2");
    expect(f.serving).toBe("");
  });

  it("leaves basisUnit null and scales my serving to grams for a weighed food", () => {
    const g = { ...base, servingGrams: 170, servingDesc: "170 g", displayQty: 1.5 } as GroceryGroupItem;
    const f = toForm(g);
    expect(f.basisUnit).toBeNull();
    expect(f.serving).toBe("170");
    expect(f.myServing).toBe("255");
  });
});
