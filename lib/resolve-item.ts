// Resolves a plan/log quantity (a multiplier of the food's serving) into an
// absolute amount + computed macros. The model and UI must only ever see the
// output of this — never a bare multiplier like "6×".

import { OZ_TO_G } from "./units";

export type ServingBasis = { perAmount: number; unit: string };

export type FoodBasis = {
  name: string;
  servingDesc: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** cooked/raw ratio (meats) or dry→cooked (rice); raw = cooked ÷ yield. */
  rawToCookedYield?: number | null;
};

export type ResolvedItem = {
  amountLabel: string; // "170 g (6 oz)", "4 slice", "1 tbsp"
  rawLabel: string | null; // "raw ≈ 227 g (8 oz)" — only weighed foods with a yield
  kcal: number; // rounded per line so lines + totals stay consistent
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type MacroTotals = Pick<ResolvedItem, "kcal" | "proteinG" | "carbsG" | "fatG">;

/** "100 g" -> {100, "g"}; "1 slice" -> {1, "slice"}; "serving" -> {1, "serving"}. */
export function parseServing(desc: string): ServingBasis {
  const match = desc.trim().match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (!match) return { perAmount: 1, unit: desc.trim() };
  return { perAmount: Number(match[1]), unit: match[2] };
}

const trim1 = (x: number) => +x.toFixed(1);

/** Kitchen-scale oz hint, rounded to the nearest 0.5 oz. */
export const ozHint = (grams: number) => {
  const oz = Math.round((grams / OZ_TO_G) * 2) / 2;
  return `${oz % 1 === 0 ? oz : oz.toFixed(1)} oz`;
};

export function resolveItem(quantity: number, food: FoodBasis): ResolvedItem {
  const { perAmount, unit } = parseServing(food.servingDesc);
  const amount = trim1(quantity * perAmount);
  const isGrams = unit === "g";
  const yieldRatio = food.rawToCookedYield ?? null;
  const rawGrams = isGrams && yieldRatio ? Math.round(amount / yieldRatio) : null;
  return {
    amountLabel: isGrams ? `${amount} g (${ozHint(amount)})` : `${amount} ${unit}`,
    rawLabel: rawGrams === null ? null : `raw ≈ ${rawGrams} g (${ozHint(rawGrams)})`,
    kcal: Math.round(food.kcal * quantity),
    proteinG: trim1(food.proteinG * quantity),
    carbsG: trim1(food.carbsG * quantity),
    fatG: trim1(food.fatG * quantity),
  };
}

/** "1059 kcal, 70g P, 140g C, 22g F" — whole grams, matching the plan-line style. */
export function formatMacros(t: MacroTotals): string {
  const g = (x: number) => Math.round(x);
  return `${Math.round(t.kcal)} kcal, ${g(t.proteinG)}g P, ${g(t.carbsG)}g C, ${g(t.fatG)}g F`;
}

/** "- Chicken breast, cooked: 170 g (6 oz) -> 281 kcal, 53g P, 0g C, 6g F [raw ≈ 227 g (8 oz)]" */
export function formatPlanLine(item: ResolvedItem, foodName: string): string {
  const raw = item.rawLabel ? ` [${item.rawLabel}]` : "";
  return `- ${foodName}: ${item.amountLabel} -> ${formatMacros(item)}${raw}`;
}

export type PlanMeal = {
  id: number;
  name: string;
  status: string;
  items: Array<{ quantity: number; food: FoodBasis }>;
};

/**
 * The meal-plan block injected into the system prompt: every item fully resolved
 * (absolute amount + computed macros) with a per-meal total. The model reads
 * arithmetic that is already done — it never sees a multiplier.
 */
export function buildPlanBlock(meals: PlanMeal[]): string {
  return meals
    .map((meal) => {
      const header = `${meal.name.toUpperCase()} [meal id ${meal.id}] [${meal.status}]`;
      if (meal.items.length === 0) return `${header}\n(no items)`;
      const resolved = meal.items.map((it) => resolveItem(it.quantity, it.food));
      const lines = resolved.map((r, i) => formatPlanLine(r, meal.items[i].food.name));
      const total = `${meal.name.toUpperCase()} TOTAL: ${formatMacros(sumResolved(resolved))}`;
      return [header, ...lines, total].join("\n");
    })
    .join("\n\n");
}

/** Totals sum the per-line (already line-rounded kcal) values so lines + total agree. */
export function sumResolved(items: ResolvedItem[]): MacroTotals {
  return items.reduce(
    (acc, it) => ({
      kcal: acc.kcal + it.kcal,
      proteinG: acc.proteinG + it.proteinG,
      carbsG: acc.carbsG + it.carbsG,
      fatG: acc.fatG + it.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}
