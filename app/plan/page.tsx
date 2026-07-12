// app/plan/page.tsx
import Link from "next/link";
import { getProfile } from "@/lib/profile";
import { getPlanView } from "@/lib/plan";
import { listMemoryFacts } from "@/lib/memory";
import { listGroceries } from "@/lib/groceries";
import { getOverridesForDate } from "@/lib/overrides";
import { todayInAppTz } from "@/lib/time";
import { ProfileForm } from "./profile-form";

// Reads live DB — must render per request (see the force-dynamic gotcha).
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const today = todayInAppTz();
  const [profile, plan, facts, groceries, overrides] = await Promise.all([
    getProfile(),
    getPlanView(),
    listMemoryFacts(),
    listGroceries(),
    getOverridesForDate(today),
  ]);
  const adjustedMealIds = Array.from(overrides.keys());
  void groceries; void adjustedMealIds;

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
        </div>
        <ProfileForm profile={profile} />
      </section>

      <section>
        <div className="plan-sec-head">
          <span className="plan-kicker">Meal plan</span>
          <span className="plan-kicker">{plan.meals.length} meals</span>
        </div>
        {/* Task 8 mounts <MealPlanEditor plan={plan} groceries={groceries} adjustedMealIds={adjustedMealIds} /> here */}
      </section>

      <section>
        <div className="plan-sec-head">
          <span className="plan-kicker">Memory</span>
          <span className="plan-kicker">{facts.length} facts</span>
        </div>
        {/* Task 9 mounts <MemoryList facts={facts} /> here */}
      </section>
    </main>
  );
}
