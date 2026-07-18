import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { foods, mealOverrides, meals } from "../db/schema";
import { NotFoundError, ValidationError } from "./errors";
import { formatMacros, formatPlanLine, resolveItem, sumResolved } from "./resolve-item";

export type OverrideItemInput = { foodId: number; quantity: number };

/** One override row joined with its food, numerics already Number()ed. */
export type OverrideLine = {
  foodId: number;
  quantity: number;
  food: {
    name: string;
    servingDesc: string;
    servingGrams: number | null;
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    rawToCookedYield: number | null;
  };
};

export type SetMealOverrideResult = {
  writeBatchId: string;
  /** Resolved display lines (absolute amounts, never multipliers). */
  lines: string[];
  total: string;
};

type FoodRow = typeof foods.$inferSelect;

function toBasis(f: FoodRow) {
  return {
    name: f.name,
    servingDesc: f.servingDesc,
    kcal: f.kcal,
    proteinG: Number(f.proteinG),
    carbsG: Number(f.carbsG),
    fatG: Number(f.fatG),
    rawToCookedYield: f.rawToCookedYield === null ? null : Number(f.rawToCookedYield),
  };
}

/**
 * Replace a meal's planned items FOR ONE DATE ONLY (the template is untouched).
 * Deletes any prior override rows for (date, meal) — last write wins — and
 * inserts the new list under a fresh write_batch_id for batch Undo.
 * (neon-http has no interactive txns; sequential statements, fine single-user.)
 */
export async function setMealOverride(
  date: string,
  mealId: number,
  items: OverrideItemInput[],
): Promise<SetMealOverrideResult> {
  if (items.length === 0) throw new ValidationError("items must be non-empty");
  const [meal] = await db.select({ id: meals.id }).from(meals).where(eq(meals.id, mealId));
  if (!meal) throw new NotFoundError(`No meal with id ${mealId}`);
  const rows = await db
    .select()
    .from(foods)
    .where(inArray(foods.id, items.map((i) => i.foodId)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const it of items) {
    if (!byId.has(it.foodId)) throw new ValidationError(`No food with id ${it.foodId}`);
    if (!(it.quantity > 0)) throw new ValidationError("quantity must be positive");
  }

  const writeBatchId = randomUUID();
  await db
    .delete(mealOverrides)
    .where(and(eq(mealOverrides.date, date), eq(mealOverrides.mealId, mealId)));
  await db.insert(mealOverrides).values(
    items.map((it) => ({
      date,
      mealId,
      foodId: it.foodId,
      quantity: String(it.quantity),
      writeBatchId,
    })),
  );

  const resolved = items.map((it) => resolveItem(it.quantity, toBasis(byId.get(it.foodId)!)));
  const lines = resolved.map((r, i) => formatPlanLine(r, byId.get(items[i].foodId)!.name));
  return { writeBatchId, lines, total: formatMacros(sumResolved(resolved)) };
}

/** All override rows for a date, joined with foods, keyed by meal id. */
export async function getOverridesForDate(date: string): Promise<Map<number, OverrideLine[]>> {
  const rows = await db
    .select({
      mealId: mealOverrides.mealId,
      foodId: mealOverrides.foodId,
      quantity: mealOverrides.quantity,
      name: foods.name,
      servingDesc: foods.servingDesc,
      servingGrams: foods.servingGrams,
      kcal: foods.kcal,
      proteinG: foods.proteinG,
      carbsG: foods.carbsG,
      fatG: foods.fatG,
      rawToCookedYield: foods.rawToCookedYield,
    })
    .from(mealOverrides)
    .innerJoin(foods, eq(mealOverrides.foodId, foods.id))
    .where(eq(mealOverrides.date, date))
    .orderBy(asc(mealOverrides.id));

  const map = new Map<number, OverrideLine[]>();
  for (const r of rows) {
    const list = map.get(r.mealId) ?? [];
    list.push({
      foodId: r.foodId,
      quantity: Number(r.quantity),
      food: {
        name: r.name,
        servingDesc: r.servingDesc,
        servingGrams: r.servingGrams === null ? null : Number(r.servingGrams),
        kcal: r.kcal,
        proteinG: Number(r.proteinG),
        carbsG: Number(r.carbsG),
        fatG: Number(r.fatG),
        rawToCookedYield: r.rawToCookedYield === null ? null : Number(r.rawToCookedYield),
      },
    });
    map.set(r.mealId, list);
  }
  return map;
}
