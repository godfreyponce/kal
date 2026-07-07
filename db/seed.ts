import "./env";
import { db } from "./index";
import { profile, foods, meals, mealItems, mealStatus, logEntries } from "./schema";
import { FOODS_V2, MEALS_V2, MEAL_ITEMS_V2, computeTargets } from "./seed-data";

// ---------------------------------------------------------------------------
// Kal — Seed v2 (unit-resolution fix). Data lives in ./seed-data.ts.
//
// ⚠️ FULL WIPE: deletes log history, meal statuses, and ALL foods (including
// owner-added groceries). For updating a live DB in place, use
// db/apply-seed-v2.ts instead.
// ---------------------------------------------------------------------------

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
  ...computeTargets(),
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
      FOODS_V2.map((food) => ({
        name: food.name,
        brand: food.brand,
        servingDesc: food.servingDesc,
        servingGrams: food.servingGrams === null ? null : String(food.servingGrams),
        kcal: food.kcal,
        proteinG: String(food.p),
        carbsG: String(food.c),
        fatG: String(food.f),
        isEstimated: food.isEstimated,
        rawToCookedYield: food.rawToCookedYield === null ? null : String(food.rawToCookedYield),
        displayQty: food.displayQty === null ? null : String(food.displayQty),
        category: food.category,
      })),
    )
    .returning({ id: foods.id, name: foods.name });
  const foodId = new Map(insertedFoods.map((f) => [f.name, f.id]));

  const insertedMeals = await db
    .insert(meals)
    .values(MEALS_V2.map((m) => ({ name: m.name, sortOrder: m.sortOrder, timeHint: m.timeHint })))
    .returning({ id: meals.id, name: meals.name });
  const mealId = new Map(insertedMeals.map((m) => [m.name, m.id]));

  await db.insert(mealItems).values(
    MEAL_ITEMS_V2.map(([meal, food, qty]) => ({
      mealId: mealId.get(meal)!,
      foodId: foodId.get(food)!,
      quantity: String(qty),
    })),
  );

  await db.insert(profile).values(PROFILE);

  console.log(
    `Seeded v2: ${insertedFoods.length} foods, ${insertedMeals.length} meals, ${MEAL_ITEMS_V2.length} meal_items, 1 profile (targets ${PROFILE.targetKcal} kcal / ${PROFILE.targetProteinG}P / ${PROFILE.targetCarbsG}C / ${PROFILE.targetFatG}F).`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
