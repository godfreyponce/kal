// ---------------------------------------------------------------------------
// Label data for the formerly estimated staples (#10). Each entry holds the
// label serving exactly as printed; perBasis() converts it to the food's
// existing serving basis, so no serving_desc or plan quantity has to move.
//
// Read by db/seed-data.test.ts (ties the seed literals to these labels) and
// db/apply-label-data.ts (writes the live rows by id).
// ---------------------------------------------------------------------------

export type LabelFood = {
  liveId: number;
  name: string; // live row's current name (guard)
  newName?: string;
  servingDesc: string; // live row's serving_desc (guard)
  basisG: number; // grams in one unit of the food's basis
  cookedPerRaw: number; // the seed's rawToCookedYield for a raw/dry label, else 1
  source: string;
  brand: string | null;
  store?: string; // absent = leave the live value as it is
  servingG: number; // label serving, grams
  kcal: number;
  p: number;
  c: number;
  f: number;
};

export const LABEL_FOODS: LabelFood[] = [
  {
    liveId: 1, name: "Large Eggs", servingDesc: "1 egg", basisG: 50, cookedPerRaw: 1,
    source: "Lucerne Large Eggs label, 1 egg (50 g), smartlabel.labelinsight.com/product/4981797",
    brand: "Lucerne", store: "Tom Thumb", servingG: 50, kcal: 70, p: 6, c: 0, f: 5,
  },
  {
    liveId: 4, name: "Banana, medium", servingDesc: "1 banana", basisG: 118, cookedPerRaw: 1,
    source: 'USDA SR Legacy "Bananas, raw" (NDB 09040, FDC 173944), medium 118 g',
    brand: null, servingG: 118, kcal: 105, p: 1.29, c: 26.95, f: 0.39,
  },
  {
    liveId: 5, name: "Chicken breast, cooked", servingDesc: "100 g", basisG: 100, cookedPerRaw: 0.75,
    source:
      'USDA SR Legacy "Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw" (FDC 171077), per 100 g ' +
      "(the Tom Thumb page for Signature Select with rib meat carries these same numbers)",
    brand: "Signature Select", store: "Tom Thumb", servingG: 100, kcal: 120, p: 22.5, c: 0, f: 2.62,
  },
  {
    liveId: 6, name: "White rice, cooked", servingDesc: "100 g", basisG: 100, cookedPerRaw: 3,
    source: "Kirkland Signature Thai Hom Mali Jasmine Rice, 52 g dry, costco.com item 100334875",
    brand: "Kirkland Signature", store: "Costco", servingG: 52, kcal: 180, p: 4, c: 40, f: 0,
  },
  {
    liveId: 7, name: "Canola oil", servingDesc: "1 tbsp", basisG: 14, cookedPerRaw: 1,
    source: "Kirkland Signature Canola Oil label, 1 Tbsp (14 g), Open Food Facts 0096619632596",
    brand: "Kirkland Signature", store: "Costco", servingG: 14, kcal: 120, p: 0, c: 0, f: 14,
  },
  {
    liveId: 8, name: "Frozen mixed vegetables, cooked", servingDesc: "100 g", basisG: 100, cookedPerRaw: 1,
    source: "Signature Select Mixed Vegetables label, 87 g (the owner's bag, live row 2033)",
    brand: "Signature Select", store: "Tom Thumb", servingG: 87, kcal: 60, p: 2, c: 11, f: 0,
  },
  {
    liveId: 1918, name: "Mozzarella cheese", servingDesc: "10 g", basisG: 10, cookedPerRaw: 1,
    source:
      "Lucerne Low-Moisture Part-Skim Shredded, 32 oz, 1/4 cup (28 g), smartlabel.labelinsight.com/product/5047337",
    brand: "Lucerne", store: "Tom Thumb", servingG: 28, kcal: 80, p: 7, c: 2, f: 6,
  },
  {
    liveId: 2034, name: "Whole milk", newName: "Horizon Organic 2% milk (DHA)", servingDesc: "1 cup", basisG: 240,
    cookedPerRaw: 1,
    source: "Horizon Organic 2% Reduced Fat Milk with DHA Omega-3, 1 cup (240 mL), owner's carton + horizon.com",
    brand: "Horizon Organic", servingG: 240, kcal: 130, p: 8, c: 13, f: 5,
  },
];

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Label serving -> one unit of the food's basis (cooked weight for raw/dry labels). */
export function perBasis(
  food: Pick<LabelFood, "basisG" | "cookedPerRaw" | "servingG" | "kcal" | "p" | "c" | "f">,
): { kcal: number; p: number; c: number; f: number } {
  const scale = food.basisG / food.cookedPerRaw / food.servingG;
  return {
    kcal: Math.round(food.kcal * scale),
    p: round1(food.p * scale),
    c: round1(food.c * scale),
    f: round1(food.f * scale),
  };
}
