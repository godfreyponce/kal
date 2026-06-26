import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { foods, mealItems, meals } from "../db/schema";

export type GroceryInput = {
  name: string;
  brand?: string | null;
  store?: string | null;
  link?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  servingGrams: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  purchaseWeightG?: number | null;
  price?: number | null;
  isEstimated?: boolean;
};

export type GroceryView = {
  id: number;
  name: string;
  brand: string | null;
  store: string | null;
  link: string | null;
  imageUrl: string | null;
  category: string | null;
  servingGrams: number | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  purchaseWeightG: number | null;
  price: number | null;
};

/** A grocery plus the meals (by id) whose plan references it. [] = Pantry. */
export type GroceryGroupItem = GroceryView & { mealIds: number[] };
export type MealGroup = { id: number; name: string; plannedKcal: number };
export type GroceryGroups = { groceries: GroceryGroupItem[]; meals: MealGroup[] };

type Row = typeof foods.$inferSelect;
const numOrNull = (v: string | null): number | null => (v === null ? null : Number(v));
const strOrNull = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : v.toFixed(2);

function toView(r: Row): GroceryView {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    store: r.store,
    link: r.link,
    imageUrl: r.imageUrl,
    category: r.category,
    servingGrams: numOrNull(r.servingGrams),
    kcal: r.kcal,
    proteinG: Number(r.proteinG),
    carbsG: Number(r.carbsG),
    fatG: Number(r.fatG),
    purchaseWeightG: numOrNull(r.purchaseWeight),
    price: numOrNull(r.price),
  };
}

export async function listGroceries(): Promise<GroceryView[]> {
  const rows = await db.select().from(foods).orderBy(asc(foods.name));
  return rows.map(toView);
}

/**
 * Everything the Groceries screen needs to group by meal or by category in one
 * read: every grocery tagged with the meals it belongs to (empty = Pantry), plus
 * each meal's name and planned-kcal subtotal for the shelf headers.
 */
export async function getGroceryGroups(): Promise<GroceryGroups> {
  const [rows, items, mealRows] = await Promise.all([
    db.select().from(foods).orderBy(asc(foods.name)),
    db
      .select({
        mealId: mealItems.mealId,
        foodId: mealItems.foodId,
        quantity: mealItems.quantity,
        kcal: foods.kcal,
      })
      .from(mealItems)
      .innerJoin(foods, eq(mealItems.foodId, foods.id)),
    db
      .select({ id: meals.id, name: meals.name })
      .from(meals)
      .orderBy(asc(meals.sortOrder)),
  ]);

  const mealIdsByFood = new Map<number, number[]>();
  const plannedKcal = new Map<number, number>();
  for (const it of items) {
    const ids = mealIdsByFood.get(it.foodId) ?? [];
    if (!ids.includes(it.mealId)) ids.push(it.mealId);
    mealIdsByFood.set(it.foodId, ids);
    plannedKcal.set(
      it.mealId,
      (plannedKcal.get(it.mealId) ?? 0) + Math.round(it.kcal * Number(it.quantity)),
    );
  }

  return {
    groceries: rows.map((r) => ({ ...toView(r), mealIds: mealIdsByFood.get(r.id) ?? [] })),
    meals: mealRows.map((m) => ({ id: m.id, name: m.name, plannedKcal: plannedKcal.get(m.id) ?? 0 })),
  };
}

export async function createGrocery(input: GroceryInput): Promise<GroceryView> {
  const [row] = await db
    .insert(foods)
    .values({
      name: input.name,
      brand: input.brand ?? null,
      store: input.store ?? null,
      link: input.link ?? null,
      imageUrl: input.imageUrl ?? null,
      category: input.category ?? null,
      servingDesc: `${input.servingGrams} g`,
      servingGrams: input.servingGrams.toFixed(2),
      kcal: Math.round(input.kcal),
      proteinG: input.proteinG.toFixed(2),
      carbsG: input.carbsG.toFixed(2),
      fatG: input.fatG.toFixed(2),
      isEstimated: input.isEstimated ?? false,
      purchaseWeight: strOrNull(input.purchaseWeightG),
      price: strOrNull(input.price),
    })
    .returning();
  return toView(row);
}

export async function updateGrocery(
  id: number,
  patch: Partial<GroceryInput>,
): Promise<GroceryView | null> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.brand !== undefined) set.brand = patch.brand;
  if (patch.store !== undefined) set.store = patch.store;
  if (patch.link !== undefined) set.link = patch.link;
  if (patch.imageUrl !== undefined) set.imageUrl = patch.imageUrl;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.servingGrams !== undefined) {
    set.servingGrams = patch.servingGrams.toFixed(2);
    set.servingDesc = `${patch.servingGrams} g`;
  }
  if (patch.kcal !== undefined) set.kcal = Math.round(patch.kcal);
  if (patch.proteinG !== undefined) set.proteinG = patch.proteinG.toFixed(2);
  if (patch.carbsG !== undefined) set.carbsG = patch.carbsG.toFixed(2);
  if (patch.fatG !== undefined) set.fatG = patch.fatG.toFixed(2);
  if (patch.isEstimated !== undefined) set.isEstimated = patch.isEstimated;
  if (patch.purchaseWeightG !== undefined) set.purchaseWeight = strOrNull(patch.purchaseWeightG);
  if (patch.price !== undefined) set.price = strOrNull(patch.price);

  if (Object.keys(set).length === 0) {
    const [row] = await db.select().from(foods).where(eq(foods.id, id));
    return row ? toView(row) : null;
  }
  const [row] = await db.update(foods).set(set).where(eq(foods.id, id)).returning();
  return row ? toView(row) : null;
}

/** Throws if the food is referenced by meal_items or log_entries (FK restrict). */
export async function deleteGrocery(id: number): Promise<void> {
  await db.delete(foods).where(eq(foods.id, id));
}
