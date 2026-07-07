// Turns a grocery + the owner's display_qty into what the card shows: an
// oz-first amount, macros AT that amount (always via resolveItem — never
// hand-scaled), and the optional tap-flip (cooked↔raw for yield foods, my
// serving↔1 unit for count foods). Pure; safe to import from client code.

import { ozHint, parseServing, resolveItem, type MacroTotals } from "./resolve-item";

export type ServingDisplayFood = {
  name: string;
  servingDesc: string;
  displayQty: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  rawToCookedYield: number | null;
};

export type ServingLabel = { amount: string; suffix: "cooked" | "uncooked" | null };

export type ServingDisplay = {
  title: string;
  base: ServingLabel;
  baseMacros: MacroTotals;
  flip: (ServingLabel & { macros: MacroTotals }) | null;
};

const trim1 = (x: number) => +x.toFixed(1);
const macrosOf = (qty: number, food: ServingDisplayFood): MacroTotals => {
  const r = resolveItem(qty, food);
  return { kcal: r.kcal, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG };
};

export function servingDisplay(food: ServingDisplayFood): ServingDisplay {
  const { perAmount, unit } = parseServing(food.servingDesc);
  const title = food.name.replace(/,\s*cooked$/i, "");
  const amount = trim1(food.displayQty * perAmount);
  const baseMacros = macrosOf(food.displayQty, food);

  if (unit === "g") {
    const yieldRatio = food.rawToCookedYield;
    if (yieldRatio == null || yieldRatio <= 0) {
      return { title, base: { amount: `${ozHint(amount)} (${amount} g)`, suffix: null }, baseMacros, flip: null };
    }
    const rawGrams = Math.round(amount / yieldRatio);
    return {
      title,
      base: { amount: `${ozHint(amount)} (${amount} g)`, suffix: "cooked" },
      baseMacros,
      flip: { amount: `${ozHint(rawGrams)} (${rawGrams} g)`, suffix: "uncooked", macros: baseMacros },
    };
  }

  const base: ServingLabel = { amount: `${amount} ${unit}`, suffix: null };
  if (food.displayQty <= 1) return { title, base, baseMacros, flip: null };
  return { title, base, baseMacros, flip: { amount: `1 ${unit}`, suffix: null, macros: macrosOf(1, food) } };
}
