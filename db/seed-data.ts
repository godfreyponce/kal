// ---------------------------------------------------------------------------
// Seed v2 — unit-resolution fix (2026-07-02).
//
// Every food carries ONE explicit unit: weighed foods are per 100 g
// (serving_grams=100 — the user has a food scale; grams kill fractional-oz
// ambiguity), countable/volume foods use their natural unit. Cooked weight is
// canonical; raw_to_cooked_yield exists only for the future shopping feature.
// meal_items quantities are multipliers of that basis, chosen so they encode
// absolute amounts (chicken 1.7 × 100 g = 170 g) — nothing ever renders a
// bare multiplier.
//
// Shared by db/seed.ts (full wipe reseed) and db/apply-seed-v2.ts (surgical
// in-place update of the live DB).
// ---------------------------------------------------------------------------

export type SeedFood = {
  name: string;
  brand: string | null;
  servingDesc: string;
  servingGrams: number | null;
  kcal: number;
  p: number;
  c: number;
  f: number;
  isEstimated: boolean; // false = straight off a product label
  rawToCookedYield: number | null; // meats: cooked/raw; rice: dry→cooked ×3
  category: string;
};

export const FOODS_V2: SeedFood[] = [
  { name: "Egg, large",                      brand: null,                    servingDesc: "1 egg",    servingGrams: null, kcal: 70,  p: 6.0,  c: 0.5,  f: 5.0,  isEstimated: true,  rawToCookedYield: null, category: "protein" },
  { name: "Whole wheat bread",               brand: "Nature's Own 100%",     servingDesc: "1 slice",  servingGrams: null, kcal: 60,  p: 4.0,  c: 11.0, f: 1.0,  isEstimated: false, rawToCookedYield: null, category: "carb" },
  { name: "Peanut butter",                   brand: "SKIPPY Extra Crunchy",  servingDesc: "1 tbsp",   servingGrams: null, kcal: 95,  p: 3.5,  c: 3.5,  f: 8.0,  isEstimated: false, rawToCookedYield: null, category: "fat" },
  { name: "Banana, medium",                  brand: null,                    servingDesc: "1 banana", servingGrams: null, kcal: 105, p: 1.3,  c: 27.0, f: 0.4,  isEstimated: true,  rawToCookedYield: null, category: "fruit" },
  { name: "Chicken breast, cooked",          brand: null,                    servingDesc: "100 g",    servingGrams: 100,  kcal: 165, p: 31.0, c: 0.0,  f: 3.6,  isEstimated: true,  rawToCookedYield: 0.75, category: "protein" },
  { name: "Ground beef 90/10, cooked",       brand: null,                    servingDesc: "100 g",    servingGrams: 100,  kcal: 215, p: 26.0, c: 0.0,  f: 12.0, isEstimated: true,  rawToCookedYield: 0.72, category: "protein" },
  { name: "White rice, cooked",              brand: null,                    servingDesc: "100 g",    servingGrams: 100,  kcal: 130, p: 2.7,  c: 28.0, f: 0.3,  isEstimated: true,  rawToCookedYield: 3.0,  category: "carb" },
  { name: "Canola oil",                      brand: null,                    servingDesc: "1 tbsp",   servingGrams: null, kcal: 120, p: 0.0,  c: 0.0,  f: 14.0, isEstimated: true,  rawToCookedYield: null, category: "fat" },
  { name: "Frozen mixed vegetables, cooked", brand: null,                    servingDesc: "100 g",    servingGrams: 100,  kcal: 55,  p: 2.5,  c: 11.0, f: 0.4,  isEstimated: true,  rawToCookedYield: null, category: "veg" },
  // Real GV label (180 kcal / 8P / 4C / 15F per 28 g) scaled to 100 g — supersedes the plan doc's 590-kcal estimate.
  { name: "Dry-roasted peanuts, salted",     brand: "Great Value",           servingDesc: "100 g",    servingGrams: 100,  kcal: 643, p: 28.6, c: 14.3, f: 53.6, isEstimated: false, rawToCookedYield: null, category: "fat" },
];

export const MEALS_V2 = [
  { name: "Breakfast",       sortOrder: 1, timeHint: "morning" },
  { name: "Lunch",           sortOrder: 2, timeHint: "midday" },
  { name: "Snack",           sortOrder: 3, timeHint: "afternoon" },
  { name: "Dinner",          sortOrder: 4, timeHint: "post-soccer ~11pm" },
  { name: "Peanuts (graze)", sortOrder: 5, timeHint: "throughout day" },
] as const;

// [meal, food, quantity (multiplier of the food's serving basis)]
// Weighed foods: quantity × 100 g, e.g. 1.7 = 170 g.
export const MEAL_ITEMS_V2: Array<[string, string, number]> = [
  ["Breakfast", "Egg, large", 4],
  ["Breakfast", "Whole wheat bread", 4],
  ["Breakfast", "Peanut butter", 2],
  ["Breakfast", "Banana, medium", 1],
  ["Lunch", "Chicken breast, cooked", 1.7],
  ["Lunch", "White rice, cooked", 4],
  ["Lunch", "Canola oil", 1],
  ["Lunch", "Frozen mixed vegetables, cooked", 2.5],
  ["Snack", "Whole wheat bread", 2],
  ["Snack", "Peanut butter", 2],
  ["Snack", "Banana, medium", 1],
  ["Dinner", "Chicken breast, cooked", 1.7],
  ["Dinner", "White rice, cooked", 4],
  ["Dinner", "Canola oil", 1],
  ["Dinner", "Frozen mixed vegetables, cooked", 2.5],
  ["Peanuts (graze)", "Dry-roasted peanuts, salted", 0.4],
];

/**
 * Targets = the full-day plan totals, derived from the food data itself
 * (owner's rule: numbers come from the food source, never hand-picked).
 * ~330 kcal over ~3,250 maintenance — lean-bulk pace; weekly weigh-in governs.
 */
export function computeTargets() {
  const byName = new Map(FOODS_V2.map((f) => [f.name, f]));
  const total = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const [, foodName, qty] of MEAL_ITEMS_V2) {
    const food = byName.get(foodName);
    if (!food) throw new Error(`Meal item references unknown food: ${foodName}`);
    total.kcal += food.kcal * qty;
    total.p += food.p * qty;
    total.c += food.c * qty;
    total.f += food.f * qty;
  }
  return {
    targetKcal: Math.round(total.kcal),
    targetProteinG: Math.round(total.p),
    targetCarbsG: Math.round(total.c),
    targetFatG: Math.round(total.f),
  };
}
