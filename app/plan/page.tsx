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
  const adjustedMealIds = Array.from(overrides.keys());

  return (
    <main className="app plan">
      <div className="head-row">
        <div>
          <h1 className="head-title">Plan</h1>
          <div className="head-date">PROFILE MEALS MEMORY</div>
        </div>
        <Link href="/" className="chat-link">‹ Today</Link>
      </div>
      <div className="rule" />

      <section>
        <div className="plan-sec-head">
          <span className="plan-kicker">Profile</span>
          <span className="plan-kicker">drag to rotate, tap to edit</span>
        </div>
        <ProfileSection profile={profile} weighIns={weighIns} />
      </section>

      <section>
        <div className="plan-sec-head">
          <span className="plan-kicker">Adherence</span>
          <span className="plan-kicker">this week</span>
        </div>
        <div className="plan-card">
          <WeeklyAdherence week={weekAdherence} foodsByDate={weekDayFoods} history={adherenceHistory} today={today} />
        </div>
      </section>

      <section>
        <div className="plan-sec-head">
          <span className="plan-kicker">Meal plan</span>
          <span className="plan-kicker">{plan.meals.length} meals</span>
        </div>
        <MealPlanEditor plan={plan} groceries={groceries} adjustedMealIds={adjustedMealIds} />
      </section>

      <section>
        <div className="plan-sec-head">
          <span className="plan-kicker">Memory</span>
          <span className="plan-kicker">{facts.length} facts</span>
        </div>
        <MemoryList facts={facts} />
      </section>
    </main>
  );
}
