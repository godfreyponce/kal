// Weight conversions. Storage is canonical grams; forms/chat speak oz/lb/g.
export const OZ_TO_G = 28.3495;
export const LB_TO_G = 453.592;

export function toGrams(value: number, unit: "g" | "oz" | "lb"): number {
  if (unit === "oz") return value * OZ_TO_G;
  if (unit === "lb") return value * LB_TO_G;
  return value;
}

/** Servings = weight in grams ÷ the food's per-serving gram weight. */
export function weightToServings(grams: number, servingGrams: number): number {
  return grams / servingGrams;
}
