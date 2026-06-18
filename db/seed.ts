import "./env";
import { db } from "./index";
import { profile, foods, meals, mealItems, mealStatus, logEntries } from "./schema";

// ---------------------------------------------------------------------------
// MacroChat / Kal — Phase 1 seed (meal plan v1, locked)
//
// Macros in `foods` are per ONE serving unit. `estimated` records the [est]/[label]
// source from the plan doc; it is NOT a column yet — when the is_estimated flag
// lands in Phase 2, every estimated:true food should default the flag to true.
// ---------------------------------------------------------------------------

const FOODS = [
  { name: "Egg, large",            brand: null,                 serving: "1 egg",    kcal: 70,  p: 6.0, c: 0.5,  f: 5.0,  estimated: true },
  { name: "Whole wheat bread",     brand: "Nature's Own 100%",  serving: "1 slice",  kcal: 60,  p: 4.0, c: 11.0, f: 1.0,  estimated: false },
  { name: "Peanut butter",         brand: "SKIPPY Extra Crunchy", serving: "1 tbsp", kcal: 95,  p: 3.5, c: 3.5,  f: 8.0,  estimated: false },
  { name: "Banana, medium",        brand: null,                 serving: "1 banana", kcal: 105, p: 1.0, c: 27.0, f: 0.4,  estimated: true },
  { name: "Chicken breast, cooked", brand: null,                serving: "1 oz",     kcal: 47,  p: 8.8, c: 0.0,  f: 1.0,  estimated: true },
  { name: "White rice, cooked",    brand: null,                 serving: "1 cup",    kcal: 200, p: 4.0, c: 44.0, f: 0.4,  estimated: true },
  { name: "Canola oil",            brand: null,                 serving: "1 tbsp",   kcal: 120, p: 0.0, c: 0.0,  f: 14.0, estimated: true },
  { name: "Frozen mixed vegetables", brand: null,               serving: "1 cup",    kcal: 70,  p: 3.0, c: 14.0, f: 0.5,  estimated: true },
  { name: "Dry-roasted peanuts",   brand: null,                 serving: "1 oz",     kcal: 165, p: 7.0, c: 6.0,  f: 14.0, estimated: true },
] as const;

const MEALS = [
  { name: "Breakfast",      sortOrder: 1, timeHint: "morning" },
  { name: "Lunch",          sortOrder: 2, timeHint: "midday" },
  { name: "Snack",          sortOrder: 3, timeHint: "afternoon" },
  { name: "Dinner",         sortOrder: 4, timeHint: "post-soccer ~11pm" },
  { name: "Peanuts (graze)", sortOrder: 5, timeHint: "throughout day" },
] as const;

// meal name -> [food name, quantity (multiple of serving)]
const MEAL_ITEMS: Array<[string, string, number]> = [
  ["Breakfast", "Egg, large", 4],
  ["Breakfast", "Whole wheat bread", 4],
  ["Breakfast", "Peanut butter", 2],
  ["Breakfast", "Banana, medium", 1],
  ["Lunch", "Chicken breast, cooked", 6],
  ["Lunch", "White rice, cooked", 2.5],
  ["Lunch", "Canola oil", 1],
  ["Lunch", "Frozen mixed vegetables", 2],
  ["Snack", "Whole wheat bread", 2],
  ["Snack", "Peanut butter", 2],
  ["Snack", "Banana, medium", 1],
  ["Dinner", "Chicken breast, cooked", 6],
  ["Dinner", "White rice, cooked", 2.5],
  ["Dinner", "Canola oil", 1],
  ["Dinner", "Frozen mixed vegetables", 2],
  ["Peanuts (graze)", "Dry-roasted peanuts", 1.5],
];

// Targets = the full-day plan totals (the realistic day, not a max).
const PROFILE = {
  id: 1,
  heightCm: 175, // 5'9"
  weightLb: "170",
  age: 30,
  sex: "male",
  bodyFatPct: "15.0",
  goalWeightLb: "160",
  goalDate: "2027-01-01",
  activityLevel: "active",
  targetKcal: 3560,
  targetProteinG: 212,
  targetCarbsG: 421,
  targetFatG: 124,
};

async function seed() {
  // FK-safe wipe so the seed is repeatable.
  await db.delete(logEntries);
  await db.delete(mealStatus);
  await db.delete(mealItems);
  await db.delete(meals);
  await db.delete(foods);
  await db.delete(profile);

  const insertedFoods = await db
    .insert(foods)
    .values(
      FOODS.map((food) => ({
        name: food.name,
        brand: food.brand,
        servingDesc: food.serving,
        kcal: food.kcal,
        proteinG: String(food.p),
        carbsG: String(food.c),
        fatG: String(food.f),
      })),
    )
    .returning({ id: foods.id, name: foods.name });
  const foodId = new Map(insertedFoods.map((f) => [f.name, f.id]));

  const insertedMeals = await db
    .insert(meals)
    .values(MEALS.map((m) => ({ name: m.name, sortOrder: m.sortOrder, timeHint: m.timeHint })))
    .returning({ id: meals.id, name: meals.name });
  const mealId = new Map(insertedMeals.map((m) => [m.name, m.id]));

  await db.insert(mealItems).values(
    MEAL_ITEMS.map(([meal, food, qty]) => ({
      mealId: mealId.get(meal)!,
      foodId: foodId.get(food)!,
      quantity: String(qty),
    })),
  );

  await db.insert(profile).values(PROFILE);

  console.log(
    `Seeded: ${insertedFoods.length} foods, ${insertedMeals.length} meals, ${MEAL_ITEMS.length} meal_items, 1 profile.`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
