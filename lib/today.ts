import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { foods, mealItems, meals, mealStatus, weighIns } from "../db/schema";
import { getDaySummary, type DaySummary } from "./day-summary";
import type { MealStatusValue } from "./meal-status";
import { getOverridesForDate } from "./overrides";
import { resolveItem } from "./resolve-item";

/** One plan item, resolved for display — never a bare multiplier. */
export type TodayMealItem = {
  foodName: string;
  /** The planned amount on the plate: "170 g (6 oz)", "4 egg". */
  amountLabel: string;
  rawLabel: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** The food's 1-serving basis: "100 g (3.5 oz)", "1 egg". */
  servingLabel: string;
  serving: { kcal: number; proteinG: number; carbsG: number; fatG: number };
};

export type TodayMeal = {
  id: number;
  name: string;
  timeHint: string | null;
  plannedKcal: number;
  status: MealStatusValue;
  /** The next meal still to eat — highlighted as "now" in the UI. */
  isNow: boolean;
  items: TodayMealItem[];
  /** True when meal_overrides replaced this meal's items for `date` (today only). */
  adjusted: boolean;
};

export type WeighIn = { date: string; weightLb: number };

export type TodayView = {
  date: string;
  summary: DaySummary;
  meals: TodayMeal[];
  eatenCount: number;
  latestWeighIn: WeighIn | null;
  /** True on Sundays with no weigh-in logged yet — surfaces the quick-add card. */
  weighInDue: boolean;
};

/** Everything the Today screen renders, in one read. No LLM involved. */
export async function getTodayView(date: string): Promise<TodayView> {
  // All six reads are independent — fire them in one parallel batch so the
  // page (and every router.refresh after a log) pays one round-trip, not six.
  const [summary, items, mealRows, statusRows, latestRows, overrides] = await Promise.all([
    getDaySummary(date),
    db
      .select({
        mealId: mealItems.mealId,
        quantity: mealItems.quantity,
        name: foods.name,
        servingDesc: foods.servingDesc,
        kcal: foods.kcal,
        proteinG: foods.proteinG,
        carbsG: foods.carbsG,
        fatG: foods.fatG,
        rawToCookedYield: foods.rawToCookedYield,
      })
      .from(mealItems)
      .innerJoin(foods, eq(mealItems.foodId, foods.id))
      .orderBy(asc(mealItems.id)),
    db
      .select({ id: meals.id, name: meals.name, timeHint: meals.timeHint })
      .from(meals)
      .orderBy(asc(meals.sortOrder)),
    db
      .select({ mealId: mealStatus.mealId, status: mealStatus.status })
      .from(mealStatus)
      .where(eq(mealStatus.date, date)),
    db
      .select({ date: weighIns.date, weightLb: weighIns.weightLb })
      .from(weighIns)
      .orderBy(desc(weighIns.date))
      .limit(1),
    getOverridesForDate(date),
  ]);

  // Resolve every plan item once (absolute amount + macros + 1-serving basis);
  // plannedKcal per meal = sum of the line-rounded item kcal, so rows and
  // popup lines always agree.
  const itemsByMeal = new Map<number, TodayMealItem[]>();
  const plannedKcal = new Map<number, number>();
  for (const it of items) {
    const food = {
      name: it.name,
      servingDesc: it.servingDesc,
      kcal: it.kcal,
      proteinG: Number(it.proteinG),
      carbsG: Number(it.carbsG),
      fatG: Number(it.fatG),
      rawToCookedYield: it.rawToCookedYield === null ? null : Number(it.rawToCookedYield),
    };
    const plate = resolveItem(Number(it.quantity), food);
    const one = resolveItem(1, food);
    const list = itemsByMeal.get(it.mealId) ?? [];
    list.push({
      foodName: it.name,
      amountLabel: plate.amountLabel,
      rawLabel: plate.rawLabel,
      kcal: plate.kcal,
      proteinG: plate.proteinG,
      carbsG: plate.carbsG,
      fatG: plate.fatG,
      servingLabel: one.amountLabel,
      serving: { kcal: one.kcal, proteinG: one.proteinG, carbsG: one.carbsG, fatG: one.fatG },
    });
    itemsByMeal.set(it.mealId, list);
    plannedKcal.set(it.mealId, (plannedKcal.get(it.mealId) ?? 0) + plate.kcal);
  }

  // Day-scoped overrides replace the template's items for this date only.
  for (const [mealId, lines] of overrides) {
    const list: TodayMealItem[] = [];
    let kcalSum = 0;
    for (const line of lines) {
      const plate = resolveItem(line.quantity, line.food);
      const one = resolveItem(1, line.food);
      list.push({
        foodName: line.food.name,
        amountLabel: plate.amountLabel,
        rawLabel: plate.rawLabel,
        kcal: plate.kcal,
        proteinG: plate.proteinG,
        carbsG: plate.carbsG,
        fatG: plate.fatG,
        servingLabel: one.amountLabel,
        serving: { kcal: one.kcal, proteinG: one.proteinG, carbsG: one.carbsG, fatG: one.fatG },
      });
      kcalSum += plate.kcal;
    }
    itemsByMeal.set(mealId, list);
    plannedKcal.set(mealId, kcalSum);
  }

  const statusByMeal = new Map(statusRows.map((s) => [s.mealId, s.status as MealStatusValue]));

  let nowAssigned = false;
  const mealsView: TodayMeal[] = mealRows.map((m) => {
    const status = statusByMeal.get(m.id) ?? "pending";
    const isNow = !nowAssigned && status !== "eaten";
    if (isNow) nowAssigned = true;
    return {
      id: m.id,
      name: m.name,
      timeHint: m.timeHint,
      plannedKcal: plannedKcal.get(m.id) ?? 0,
      status,
      isNow,
      items: itemsByMeal.get(m.id) ?? [],
      adjusted: overrides.has(m.id),
    };
  });

  const [latest] = latestRows;

  const isSunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
  const weighInDue = isSunday && latest?.date !== date;

  return {
    date,
    summary,
    meals: mealsView,
    eatenCount: mealsView.filter((m) => m.status === "eaten").length,
    latestWeighIn: latest ? { date: latest.date, weightLb: Number(latest.weightLb) } : null,
    weighInDue,
  };
}
