// The synthetic context every eval case starts from. Every number is invented: no owner data.
// Food names follow the library's "Noun, modifier" form, which the #57 case depends on.
import type { foods } from "../db/schema";
import type { PromptContext } from "../lib/system-prompt";

export type FoodRow = typeof foods.$inferSelect;
export type EvalContext = { prompt: PromptContext; foods: FoodRow[] };

export const FIXTURE_DATE = "2026-03-10";

type FoodInput = Pick<FoodRow, "id" | "name" | "servingDesc" | "kcal"> & {
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingGrams: number;
  rawToCookedYield?: number;
};

function food(f: FoodInput): FoodRow {
  return {
    id: f.id,
    name: f.name,
    brand: null,
    servingDesc: f.servingDesc,
    kcal: f.kcal,
    proteinG: f.proteinG.toFixed(2),
    carbsG: f.carbsG.toFixed(2),
    fatG: f.fatG.toFixed(2),
    store: null,
    link: null,
    imageUrl: null,
    category: null,
    servingGrams: f.servingGrams.toFixed(2),
    isEstimated: false,
    rawToCookedYield: f.rawToCookedYield === undefined ? null : f.rawToCookedYield.toFixed(2),
    displayQty: null,
    oneOff: false,
    purchaseWeight: null,
    price: null,
    createdAt: new Date(0),
  };
}

const eggs = food({ id: 1, name: "Eggs, large", servingDesc: "1 egg", servingGrams: 50, kcal: 72, proteinG: 6.3, carbsG: 0.4, fatG: 4.8 });
const rice = food({ id: 2, name: "White rice, cooked", servingDesc: "100 g", servingGrams: 100, kcal: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3, rawToCookedYield: 3 });
const banana = food({ id: 3, name: "Banana, medium", servingDesc: "1 banana", servingGrams: 118, kcal: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4 });
const chicken = food({ id: 4, name: "Chicken breast, cooked", servingDesc: "100 g", servingGrams: 100, kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6, rawToCookedYield: 0.75 });
const oil = food({ id: 5, name: "Olive oil", servingDesc: "1 tbsp", servingGrams: 14, kcal: 119, proteinG: 0, carbsG: 0, fatG: 13.5 });
const yogurt = food({ id: 6, name: "Greek yogurt, plain nonfat", servingDesc: "1 cup", servingGrams: 170, kcal: 100, proteinG: 17, carbsG: 6, fatG: 0.7 });
const oats = food({ id: 7, name: "Oats, dry", servingDesc: "40 g", servingGrams: 40, kcal: 150, proteinG: 5, carbsG: 27, fatG: 3 });

function planItem(mealId: number, f: FoodRow, quantity: number): PromptContext["items"][number] {
  return {
    mealId,
    quantity: quantity.toFixed(3),
    foodName: f.name,
    servingDesc: f.servingDesc,
    kcal: f.kcal,
    proteinG: f.proteinG,
    carbsG: f.carbsG,
    fatG: f.fatG,
    rawToCookedYield: f.rawToCookedYield,
  };
}

const targets = { kcal: 2600, proteinG: 170, carbsG: 300, fatG: 80 };

export const FIXTURE: EvalContext = {
  foods: [eggs, rice, banana, chicken, oil, yogurt, oats],
  prompt: {
    profile: {
      id: 1,
      heightCm: 178,
      weightLb: "170.40",
      age: 30,
      sex: "male",
      bodyFatPct: "18.0",
      goalWeightLb: "165.00",
      goalDate: "2026-06-01",
      activityLevel: "moderately active",
      targetKcal: targets.kcal,
      targetProteinG: targets.proteinG,
      targetCarbsG: targets.carbsG,
      targetFatG: targets.fatG,
    },
    summary: {
      date: FIXTURE_DATE,
      targets,
      consumed: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      remaining: { ...targets },
    },
    meals: [
      { id: 1, name: "Breakfast" },
      { id: 2, name: "Lunch" },
      { id: 3, name: "Snack" },
      { id: 4, name: "Dinner" },
    ],
    items: [
      planItem(1, eggs, 4),
      planItem(1, oats, 1),
      planItem(2, chicken, 2),
      planItem(2, rice, 2.5),
      planItem(2, oil, 1),
      planItem(3, banana, 1),
      planItem(3, yogurt, 1),
      planItem(4, chicken, 2),
      planItem(4, rice, 2),
    ],
    statuses: [],
    weights: [
      { date: "2026-03-09", weightLb: "170.40" },
      { date: "2026-03-05", weightLb: "171.00" },
    ],
    memoryFacts: [{ content: "Prefers grams over ounces." }],
    overrides: new Map(),
  },
};
