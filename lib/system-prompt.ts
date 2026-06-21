import { asc, desc, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { foods, mealItems, meals, mealStatus, memoryFacts, profile, weighIns } from "../db/schema";
import { getDaySummary } from "./day-summary";

const m = (x: number) => Math.round(x);

function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the system prompt for a chat request: profile, targets, today's consumed/
 * remaining, the meal plan with today's per-meal status, recent weight, and the
 * editable memory facts. Assembled fresh each request so the model always grounds
 * on real numbers rather than inventing them.
 */
export async function assembleSystemPrompt(date: string): Promise<string> {
  const since = shiftDate(date, -30);

  // All reads are independent — one parallel batch instead of seven sequential
  // round-trips (neon-http does one HTTP request per query).
  const [[p], summary, mealRows, items, statusRows, weights, facts] = await Promise.all([
    db.select().from(profile).where(eq(profile.id, 1)),
    getDaySummary(date),
    db.select().from(meals).orderBy(asc(meals.sortOrder)),
    db
      .select({ mealId: mealItems.mealId, quantity: mealItems.quantity, foodName: foods.name })
      .from(mealItems)
      .innerJoin(foods, eq(mealItems.foodId, foods.id)),
    db
      .select({ mealId: mealStatus.mealId, status: mealStatus.status })
      .from(mealStatus)
      .where(eq(mealStatus.date, date)),
    db
      .select({ date: weighIns.date, weightLb: weighIns.weightLb })
      .from(weighIns)
      .where(gte(weighIns.date, since))
      .orderBy(desc(weighIns.date))
      .limit(10),
    db.select({ content: memoryFacts.content }).from(memoryFacts).orderBy(asc(memoryFacts.createdAt)),
  ]);
  const itemsByMeal = new Map<number, string[]>();
  for (const it of items) {
    const list = itemsByMeal.get(it.mealId) ?? [];
    list.push(`${Number(it.quantity)}× ${it.foodName}`);
    itemsByMeal.set(it.mealId, list);
  }
  const statusByMeal = new Map(statusRows.map((s) => [s.mealId, s.status]));

  const planLines = mealRows.map((meal) => {
    const status = statusByMeal.get(meal.id) ?? "pending";
    const itemList = itemsByMeal.get(meal.id)?.join(", ") ?? "(no items)";
    return `  - [id ${meal.id}] ${meal.name} [${status}]: ${itemList}`;
  });

  let weightLine = "No weigh-ins on record.";
  if (weights.length > 0) {
    const latest = weights[0];
    const sevenAgo = shiftDate(date, -7);
    const last7 = weights.filter((w) => w.date >= sevenAgo).map((w) => Number(w.weightLb));
    const avg = last7.length ? (last7.reduce((a, w) => a + w, 0) / last7.length).toFixed(1) : null;
    weightLine = `Latest ${Number(latest.weightLb)} lb on ${latest.date}` + (avg ? `; 7-day avg ${avg} lb.` : ".");
  }

  const memoryBlock = facts.length
    ? facts.map((f) => `  - ${f.content}`).join("\n")
    : "  (none yet)";

  const { targets, consumed, remaining } = summary;

  return `You are Kal, a personal nutrition assistant for the app's single owner. Be direct and quantitative.

PROFILE: ${p.age}yo ${p.sex}, ${p.heightCm}cm, ${Number(p.weightLb)}lb${
    p.bodyFatPct ? `, ${Number(p.bodyFatPct)}% body fat` : ""
  }${p.goalWeightLb ? `, goal ${Number(p.goalWeightLb)}lb${p.goalDate ? ` by ${p.goalDate}` : ""}` : ""}${
    p.activityLevel ? `, ${p.activityLevel}` : ""
  }.
DAILY TARGETS: ${targets.kcal} kcal / ${targets.proteinG}P / ${targets.carbsG}C / ${targets.fatG}F.
TODAY (${date}): consumed ${m(consumed.kcal)} kcal / ${m(consumed.proteinG)}P / ${m(consumed.carbsG)}C / ${m(
    consumed.fatG,
  )}F; remaining ${m(remaining.kcal)} kcal / ${m(remaining.proteinG)}P / ${m(remaining.carbsG)}C / ${m(
    remaining.fatG,
  )}F.
MEAL PLAN + STATUS TODAY:
${planLines.join("\n")}
WEIGHT: ${weightLine}
MEMORY:
${memoryBlock}

Rules:
- Ground every recommendation in the remaining macros above. Use tools to read/write data; never invent numbers.
- To record eating, prefer set_meal_status('eaten') for a planned meal (it fills the gaps without double-counting); use log_food for anything off-plan.
- After a write, briefly confirm what changed and the updated remaining macros (call get_day_summary if unsure).
- Keep answers short and concrete. You may suggest target adjustments but never change targets yourself.`;
}
