// Pure form model for the Groceries editor. No React, no DB: the GroceryGroupItem
// import is type-only, so nothing here pulls in lib/groceries' db client.
import type { GroceryGroupItem } from "./groceries";
import { parseServing } from "./resolve-item";
import { toGrams } from "./units";

export type WeightUnit = "g" | "oz" | "lb";

export type FormState = {
  id: number | null;
  name: string;
  brand: string;
  store: string;
  link: string;
  imageUrl: string;
  category: string;
  serving: string;
  servingUnit: WeightUnit;
  myServing: string;       // display serving: grams/oz for weighed, count for unit foods
  myServingUnit: WeightUnit;
  basisUnit: string | null; // "tbsp"/"egg"/… for count foods; null = weighed or new
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  purchase: string;
  purchaseUnit: WeightUnit;
  price: string;
};

export const EMPTY: FormState = {
  id: null, name: "", brand: "", store: "", link: "", imageUrl: "", category: "",
  serving: "", servingUnit: "g", myServing: "", myServingUnit: "g", basisUnit: null,
  kcal: "", proteinG: "", carbsG: "", fatG: "",
  purchase: "", purchaseUnit: "lb", price: "",
};

const CATEGORIES = ["protein", "carb", "fat", "dairy", "fruit", "veg", "other"] as const;

export function toForm(g: GroceryGroupItem): FormState {
  return {
    id: g.id,
    name: g.name,
    brand: g.brand ?? "",
    store: g.store ?? "",
    link: g.link ?? "",
    imageUrl: g.imageUrl ?? "",
    category: (CATEGORIES as readonly string[]).includes(g.category ?? "") ? g.category! : "",
    serving: g.servingGrams != null ? String(g.servingGrams) : "",
    servingUnit: "g",
    myServing:
      g.servingGrams != null
        ? String(+(g.displayQty * g.servingGrams).toFixed(1))
        : String(g.displayQty),
    myServingUnit: "g",
    basisUnit: g.servingGrams != null ? null : parseServing(g.servingDesc).unit,
    kcal: String(g.kcal),
    proteinG: String(g.proteinG),
    carbsG: String(g.carbsG),
    fatG: String(g.fatG),
    purchase: g.purchaseWeightG != null ? String(g.purchaseWeightG) : "",
    purchaseUnit: "g",
    price: g.price != null ? String(g.price) : "",
  };
}

export type GroceryPatchBody = {
  name: string;
  brand: string | null;
  store: string | null;
  link: string | null;
  imageUrl: string | null;
  category: string | null;
  servingGrams?: number;
  displayQty: number | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  purchaseWeightG: number | null;
  price: number | null;
};

export function buildGroceryPatch(
  form: FormState,
): { ok: true; body: GroceryPatchBody } | { ok: false; error: string } {
  const isCount = form.basisUnit !== null;
  const serving = Number(form.serving);
  const kcal = Number(form.kcal);
  if (
    !form.name.trim() ||
    !Number.isFinite(kcal) ||
    (!isCount && (!Number.isFinite(serving) || serving <= 0))
  ) {
    return {
      ok: false,
      error: "Name and calories are required (plus a positive serving size for weighed foods).",
    };
  }
  // Count foods (eggs, tbsp, slices) must NOT send servingGrams — updateGrocery
  // rewrites servingDesc to "<n> g" whenever it arrives, clobbering "1 tbsp".
  const servingGrams = isCount ? null : toGrams(serving, form.servingUnit);
  let displayQty: number | null = null;
  if (form.myServing.trim() !== "") {
    const v = Number(form.myServing);
    if (!Number.isFinite(v) || v <= 0) {
      return { ok: false, error: "My serving must be a positive number." };
    }
    displayQty = isCount ? v : toGrams(v, form.myServingUnit) / servingGrams!;
  }
  return {
    ok: true,
    body: {
      name: form.name.trim(),
      brand: form.brand || null,
      store: form.store || null,
      link: form.link || null,
      imageUrl: form.imageUrl || null,
      category: form.category || null,
      ...(servingGrams != null ? { servingGrams } : {}),
      displayQty,
      kcal,
      proteinG: Number(form.proteinG) || 0,
      carbsG: Number(form.carbsG) || 0,
      fatG: Number(form.fatG) || 0,
      purchaseWeightG:
        form.purchase.trim() === "" ? null : toGrams(Number(form.purchase), form.purchaseUnit),
      price: form.price.trim() === "" ? null : Number(form.price),
    },
  };
}
