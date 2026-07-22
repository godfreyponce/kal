import Link from "next/link";
import { todayInAppTz } from "@/lib/time";
import { getTodayView } from "@/lib/today";
import { MealList } from "./meal-list";
import { WeighIn } from "./weigh-in";
import { SignOut } from "./sign-out";
import { RefreshOnFocus } from "./refresh-on-focus";

// Today reflects live DB state + the current civil day, so it must be rendered
// per request. Without this, Next prerenders it static at build time and every
// router.refresh() refetches that frozen snapshot (stale date, 0 consumed).
export const dynamic = "force-dynamic";

const SEGMENTS = 9;
const RING_R = 74;
const RING_C = 2 * Math.PI * RING_R; // circumference

const n = (x: number) => Math.round(x).toLocaleString("en-US");

function headerDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .toUpperCase()
    .replace(",", "");
}

function MacroRow({
  label,
  remaining,
  consumed,
  target,
  color,
}: {
  label: string;
  remaining: number;
  consumed: number;
  target: number;
  color: string;
}) {
  const filled = Math.max(0, Math.min(SEGMENTS, Math.round((consumed / target) * SEGMENTS)));
  return (
    <div className="mrow">
      <div className="ml">
        <b>{n(remaining)}g</b>
        <small>{label}</small>
      </div>
      <div className="seg">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <i key={i} style={i < filled ? { background: color } : undefined} />
        ))}
      </div>
      <div className="mtarget">/ {n(target)}</div>
    </div>
  );
}

export default async function TodayPage() {
  const date = todayInAppTz();
  const { summary, meals, latestWeighIn, weighInDue } = await getTodayView(date);
  const { targets, consumed, remaining } = summary;

  const kcalPct = Math.max(0, Math.min(1, consumed.kcal / targets.kcal));
  const ringOffset = RING_C * (1 - kcalPct);

  return (
    <main className="app">
      <RefreshOnFocus />
      <div className="head-row anim">
        <div>
          <h1 className="head-title">Today</h1>
          <div className="head-date">{headerDate(date)}</div>
        </div>
        <div className="top-nav">
          <SignOut />
          <Link href="/plan" className="top-link">Plan</Link>
          <Link href="/groceries" className="top-link">Groceries</Link>
          <Link href="/chat" className="top-link">Chat ›</Link>
        </div>
      </div>

      {/* calorie ring */}
      <div className="ring-block anim" style={{ animationDelay: "0.05s" }}>
        <div className="ring-wrap">
          <svg width="172" height="172" viewBox="0 0 172 172">
            <circle cx="86" cy="86" r={RING_R} fill="none" stroke="var(--ring-track)" strokeWidth="11" />
            <circle
              cx="86"
              cy="86"
              r={RING_R}
              fill="none"
              stroke="var(--sm-choc)"
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={ringOffset}
              transform="rotate(-90 86 86)"
            />
          </svg>
          <div className="ring-center">
            <b>{n(remaining.kcal)}</b>
            <small>kcal left</small>
          </div>
        </div>
        <div className="ring-foot">
          <b>{n(consumed.kcal)}</b> of {n(targets.kcal)} eaten <span className="rf-pct">{Math.round(kcalPct * 100)}%</span>
        </div>
      </div>

      <div className="macros anim" style={{ animationDelay: "0.1s" }}>
        <MacroRow label="Protein" remaining={remaining.proteinG} consumed={consumed.proteinG} target={targets.proteinG} color="var(--sm-red)" />
        <MacroRow label="Carbs" remaining={remaining.carbsG} consumed={consumed.carbsG} target={targets.carbsG} color="var(--sm-caramel)" />
        <MacroRow label="Fat" remaining={remaining.fatG} consumed={consumed.fatG} target={targets.fatG} color="var(--sm-pill)" />
      </div>

      {weighInDue && <WeighIn date={date} latestWeighIn={latestWeighIn} />}

      <MealList key={date} meals={meals} date={date} />
    </main>
  );
}
