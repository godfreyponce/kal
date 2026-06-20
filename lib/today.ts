import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { foods, mealItems, meals, mealStatus, weighIns } from "../db/schema";
import { getDaySummary, type DaySummary } from "./day-summary";
import type { MealStatusValue } from "./meal-status";

export type TodayMeal = {
  id: number;
  name: string;
  timeHint: string | null;
  plannedKcal: number;
  status: MealStatusValue;
  /** The next meal still to eat — highlighted as "now" in the UI. */
  isNow: boolean;
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
  const summary = await getDaySummary(date);

  // Planned kcal per meal = sum(food.kcal * quantity) over its items.
  const items = await db
    .select({
      mealId: mealItems.mealId,
      kcal: foods.kcal,
      quantity: mealItems.quantity,
    })
    .from(mealItems)
    .innerJoin(foods, eq(mealItems.foodId, foods.id));

  const plannedKcal = new Map<number, number>();
  for (const it of items) {
    const add = Math.round(it.kcal * Number(it.quantity));
    plannedKcal.set(it.mealId, (plannedKcal.get(it.mealId) ?? 0) + add);
  }

  const mealRows = await db
    .select({ id: meals.id, name: meals.name, timeHint: meals.timeHint })
    .from(meals)
    .orderBy(asc(meals.sortOrder));

  const statusRows = await db
    .select({ mealId: mealStatus.mealId, status: mealStatus.status })
    .from(mealStatus)
    .where(eq(mealStatus.date, date));
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
    };
  });

  const [latest] = await db
    .select({ date: weighIns.date, weightLb: weighIns.weightLb })
    .from(weighIns)
    .orderBy(desc(weighIns.date))
    .limit(1);

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
