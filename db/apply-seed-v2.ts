import "./env";
import { eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { profile, foods, meals, mealItems } from "./schema";
import { FOODS_V2, MEAL_ITEMS_V2, computeTargets } from "./seed-data";

// ---------------------------------------------------------------------------
// Surgical Seed-v2 apply — updates the LIVE DB in place. Run: npx tsx db/apply-seed-v2.ts
//
// Unlike db/seed.ts this preserves log history, meal statuses, weigh-ins,
// owner-added groceries, and product photos (image_url is never touched).
// Idempotent: matches foods by old OR new name. NOTE: pre-existing log_entries
// keep their snapshotted macros (still correct) but their `quantity` was a
// multiplier of the OLD serving basis — historical rows only, nothing rereads it.
// ---------------------------------------------------------------------------

// Foods renamed by seed v2: old live name -> seed-data name.
const RENAMES: Record<string, string> = {
  "Frozen mixed vegetables": "Frozen mixed vegetables, cooked",
  "Dry-roasted peanuts": "Dry-roasted peanuts, salted",
  "Egg, large": "Large Eggs",
};

async function apply() {
  const liveFoods = await db.select({ id: foods.id, name: foods.name }).from(foods);
  const idByName = new Map(liveFoods.map((f) => [f.name, f.id]));

  let updated = 0;
  let inserted = 0;
  for (const food of FOODS_V2) {
    const oldName = Object.entries(RENAMES).find(([, next]) => next === food.name)?.[0];
    const id = idByName.get(food.name) ?? (oldName ? idByName.get(oldName) : undefined);
    const values = {
      name: food.name,
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
    };
    if (id !== undefined) {
      await db.update(foods).set(values).where(eq(foods.id, id));
      idByName.set(food.name, id);
      updated++;
    } else {
      const [row] = await db
        .insert(foods)
        .values({ ...values, brand: food.brand })
        .returning({ id: foods.id });
      idByName.set(food.name, row.id);
      inserted++;
    }
  }

  const mealRows = await db.select({ id: meals.id, name: meals.name }).from(meals);
  const mealIdByName = new Map(mealRows.map((m) => [m.name, m.id]));
  for (const [mealName, foodName] of MEAL_ITEMS_V2) {
    if (!mealIdByName.has(mealName)) throw new Error(`Live DB is missing meal: ${mealName}`);
    if (!idByName.has(foodName)) throw new Error(`Food missing after update: ${foodName}`);
  }

  // Replace the plan items wholesale (plan template only — no FK from logs).
  await db.delete(mealItems).where(inArray(mealItems.mealId, [...mealIdByName.values()]));
  await db.insert(mealItems).values(
    MEAL_ITEMS_V2.map(([meal, food, qty]) => ({
      mealId: mealIdByName.get(meal)!,
      foodId: idByName.get(food)!,
      quantity: String(qty),
    })),
  );

  const targets = computeTargets();
  await db.update(profile).set(targets).where(eq(profile.id, 1));

  console.log(
    `Applied seed v2 surgically: ${updated} foods updated, ${inserted} inserted, ` +
      `${MEAL_ITEMS_V2.length} meal_items replaced, targets -> ` +
      `${targets.targetKcal} kcal / ${targets.targetProteinG}P / ${targets.targetCarbsG}C / ${targets.targetFatG}F.`,
  );
}

apply()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
