// app/plan/page.tsx
import Link from "next/link";
import { getProfile } from "@/lib/profile";
import { getPlanView } from "@/lib/plan";
import { listMemoryFacts } from "@/lib/memory";
import { listGroceries } from "@/lib/groceries";
import { getOverridesForDate } from "@/lib/overrides";
import { todayInAppTz } from "@/lib/time";
import { listWeighIns } from "@/lib/weigh-ins";
import { getWeekAdherence, getWeekDayFoods, getAdherenceHistory } from "@/lib/adherence";
import { ProfileSection } from "./profile-section";
import { WeeklyAdherence } from "./weekly-adherence";
import { MealPlanEditor } from "./meal-plan-editor";
import { MemoryList } from "./memory-list";

// Reads live DB — must render per request (see the force-dynamic gotcha).
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const today = todayInAppTz();
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 90);
  const since = d.toISOString().slice(0, 10);
  const [profile, plan, facts, groceries, overrides, weighIns, weekAdherence, weekDayFoods, adherenceHistory] =
    await Promise.all([
      getProfile(),
      getPlanView(),
      listMemoryFacts(),
      listGroceries(),
      getOverridesForDate(today),
      listWeighIns(since),
      getWeekAdherence(today),
      getWeekDayFoods(today),
      getAdherenceHistory(today),
    ]);
  const overridesByMeal = Array.from(overrides, ([mealId, lines]) => ({
    mealId,
    items: lines.map((l) => ({
      foodId: l.foodId,
      quantity: l.quantity,
      foodName: l.food.name,
      servingDesc: l.food.servingDesc,
      servingGrams: l.food.servingGrams,
      unitKcal: l.food.kcal,
    })),
  }));

  return (
    <main className="app plan">
      <div className="head-row anim">
        <div>
          <h1 className="head-title">Plan</h1>
          <div className="head-date">PROFILE MEALS MEMORY</div>
        </div>
        <Link href="/" className="plan-back">‹ Today</Link>
      </div>

      <section>
        <div className="plan-kick anim" style={{ animationDelay: "0.05s" }}>
          Adherence <small>this week</small>
        </div>
        <div className="anim" style={{ animationDelay: "0.08s" }}>
          <WeeklyAdherence week={weekAdherence} foodsByDate={weekDayFoods} history={adherenceHistory} today={today} />
        </div>
      </section>

      <section>
        <div className="plan-kick anim" style={{ animationDelay: "0.11s" }}>
          Profile <small>drag to rotate, tap to edit</small>
        </div>
        <ProfileSection profile={profile} weighIns={weighIns} />
      </section>

      <section>
        <div className="plan-kick anim" style={{ animationDelay: "0.17s" }}>
          Meal plan <small>{plan.meals.length} meals</small>
        </div>
        <MealPlanEditor plan={plan} groceries={groceries} overridesByMeal={overridesByMeal} />
      </section>

      <section>
        <div className="plan-kick anim" style={{ animationDelay: "0.2s" }}>
          Memory <small>{facts.length} facts</small>
        </div>
        <MemoryList facts={facts} />
      </section>
    </main>
  );
}
