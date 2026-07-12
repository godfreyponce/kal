// lib/plan.ts
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { foods, mealItems, meals, profile } from "../db/schema";
import { NotFoundError, ValidationError } from "./errors";
import { resolveItem } from "./resolve-item";

export type PlanItemView = {
  id: number;
  foodId: number;
  foodName: string;
  brand: string | null;
  imageUrl: string | null;
  category: string | null;
  quantity: number;
  servingDesc: string;
  servingGrams: number | null;
  unitKcal: number;
  amountLabel: string;
  kcal: number;
};
export type PlanMealView = {
  id: number;
  name: string;
  timeHint: string | null;
  sortOrder: number;
  items: PlanItemView[];
  kcal: number;
};
export type PlanTargets = { kcal: number; proteinG: number; carbsG: number; fatG: number };
export type PlanView = { meals: PlanMealView[]; totals: PlanTargets };
export type RetargetResult = { old: PlanTargets; next: PlanTargets };
export type PlanItemInput = { foodId: number; quantity: number };

/** Sum raw food macros × qty, round ONCE at the end (matches computeTargets in db/seed-data.ts). */
function sumRawMacros(
  rows: Array<{ quantity: string; kcal: number; proteinG: string; carbsG: string; fatG: string }>,
): PlanTargets {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const r of rows) {
    const q = Number(r.quantity);
    t.kcal += r.kcal * q;
    t.p += Number(r.proteinG) * q;
    t.c += Number(r.carbsG) * q;
    t.f += Number(r.fatG) * q;
  }
  return {
    kcal: Math.round(t.kcal),
    proteinG: Math.round(t.p),
    carbsG: Math.round(t.c),
    fatG: Math.round(t.f),
  };
}

export async function getPlanView(): Promise<PlanView> {
  const [mealRows, itemRows] = await Promise.all([
    db.select().from(meals).orderBy(asc(meals.sortOrder)),
    db
      .select({
        id: mealItems.id,
        mealId: mealItems.mealId,
        foodId: mealItems.foodId,
        quantity: mealItems.quantity,
        foodName: foods.name,
        brand: foods.brand,
        imageUrl: foods.imageUrl,
        category: foods.category,
        servingDesc: foods.servingDesc,
        servingGrams: foods.servingGrams,
        kcal: foods.kcal,
        proteinG: foods.proteinG,
        carbsG: foods.carbsG,
        fatG: foods.fatG,
        rawToCookedYield: foods.rawToCookedYield,
      })
      .from(mealItems)
      .innerJoin(foods, eq(mealItems.foodId, foods.id))
      .orderBy(asc(mealItems.id)),
  ]);

  const byMeal = new Map<number, PlanItemView[]>();
  for (const r of itemRows) {
    const q = Number(r.quantity);
    const resolved = resolveItem(q, {
      name: r.foodName,
      servingDesc: r.servingDesc,
      kcal: r.kcal,
      proteinG: Number(r.proteinG),
      carbsG: Number(r.carbsG),
      fatG: Number(r.fatG),
      rawToCookedYield: r.rawToCookedYield === null ? null : Number(r.rawToCookedYield),
    });
    const list = byMeal.get(r.mealId) ?? [];
    list.push({
      id: r.id,
      foodId: r.foodId,
      foodName: r.foodName,
      brand: r.brand,
      imageUrl: r.imageUrl,
      category: r.category,
      quantity: q,
      servingDesc: r.servingDesc,
      servingGrams: r.servingGrams === null ? null : Number(r.servingGrams),
      unitKcal: r.kcal,
      amountLabel: resolved.amountLabel,
      kcal: resolved.kcal,
    });
    byMeal.set(r.mealId, list);
  }

  // Totals use the seed's rule: sum raw food macros × qty, round ONCE at the end
  // (matches computeTargets in db/seed-data.ts, so plan totals == derived targets).
  return {
    meals: mealRows.map((m) => {
      const items = byMeal.get(m.id) ?? [];
      return {
        id: m.id,
        name: m.name,
        timeHint: m.timeHint,
        sortOrder: m.sortOrder,
        items,
        kcal: items.reduce((s, i) => s + i.kcal, 0),
      };
    }),
    totals: sumRawMacros(itemRows),
  };
}

/** Re-derive profile targets from the live plan (owner rule: never hand-picked). */
export async function recomputeTargets(): Promise<RetargetResult> {
  const rows = await db
    .select({
      quantity: mealItems.quantity,
      kcal: foods.kcal,
      proteinG: foods.proteinG,
      carbsG: foods.carbsG,
      fatG: foods.fatG,
    })
    .from(mealItems)
    .innerJoin(foods, eq(mealItems.foodId, foods.id));
  const [prev] = await db.select().from(profile).where(eq(profile.id, 1));
  const next: PlanTargets = sumRawMacros(rows);
  await db
    .update(profile)
    .set({
      targetKcal: next.kcal,
      targetProteinG: next.proteinG,
      targetCarbsG: next.carbsG,
      targetFatG: next.fatG,
    })
    .where(eq(profile.id, 1));
  return {
    old: {
      kcal: prev.targetKcal,
      proteinG: prev.targetProteinG,
      carbsG: prev.targetCarbsG,
      fatG: prev.targetFatG,
    },
    next,
  };
}

async function assertItemsValid(items: PlanItemInput[]) {
  for (const it of items) {
    if (!(it.quantity > 0)) throw new ValidationError("quantity must be positive");
  }
  if (items.length === 0) return;
  const rows = await db
    .select({ id: foods.id })
    .from(foods)
    .where(inArray(foods.id, items.map((i) => i.foodId)));
  const have = new Set(rows.map((r) => r.id));
  for (const it of items) {
    if (!have.has(it.foodId)) throw new ValidationError(`No food with id ${it.foodId}`);
  }
}

/** Replace a meal's TEMPLATE items (every day) and re-derive targets.
 *  Empty items = the meal stays but contributes nothing. */
export async function replaceMealItems(mealId: number, items: PlanItemInput[]): Promise<RetargetResult> {
  const [meal] = await db.select({ id: meals.id }).from(meals).where(eq(meals.id, mealId));
  if (!meal) throw new NotFoundError(`No meal with id ${mealId}`);
  await assertItemsValid(items);
  await db.delete(mealItems).where(eq(mealItems.mealId, mealId));
  if (items.length > 0) {
    await db.insert(mealItems).values(
      items.map((it) => ({ mealId, foodId: it.foodId, quantity: String(it.quantity) })),
    );
  }
  return recomputeTargets();
}

export async function createMeal(input: { name: string; timeHint?: string | null }): Promise<{ id: number }> {
  const name = input.name?.trim();
  if (!name) throw new ValidationError("name required");
  const rows = await db.select({ sortOrder: meals.sortOrder }).from(meals);
  const nextSort = rows.length === 0 ? 1 : Math.max(...rows.map((r) => r.sortOrder)) + 1;
  const [row] = await db
    .insert(meals)
    .values({ name, sortOrder: nextSort, timeHint: input.timeHint?.trim() || null })
    .returning({ id: meals.id });
  return row;
}

export async function updateMeal(
  id: number,
  patch: { name?: string; timeHint?: string | null },
): Promise<{ id: number } | null> {
  const set: Partial<typeof meals.$inferInsert> = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new ValidationError("name required");
    set.name = patch.name.trim();
  }
  if (patch.timeHint !== undefined) set.timeHint = patch.timeHint?.trim() || null;
  if (Object.keys(set).length === 0) throw new ValidationError("empty patch");
  const rows = await db.update(meals).set(set).where(eq(meals.id, id)).returning({ id: meals.id });
  return rows[0] ?? null;
}

/** Delete a meal (items cascade; day rows cascade; logs keep with meal_id null). */
export async function deleteMeal(id: number): Promise<RetargetResult> {
  const rows = await db.delete(meals).where(eq(meals.id, id)).returning({ id: meals.id });
  if (rows.length === 0) throw new NotFoundError(`No meal with id ${id}`);
  return recomputeTargets();
}
