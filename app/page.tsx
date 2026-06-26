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
  const { summary, meals, eatenCount, latestWeighIn, weighInDue } = await getTodayView(date);
  const { targets, consumed, remaining } = summary;

  const kcalPct = Math.max(0, Math.min(1, consumed.kcal / targets.kcal));
  const ringOffset = RING_C * (1 - kcalPct);

  return (
    <main className="app">
      <RefreshOnFocus />
      <div className="head-row">
        <div>
          <h1 className="head-title">Today</h1>
          <div className="head-date">{headerDate(date)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <SignOut />
            <Link href="/groceries" className="chat-link">Groceries</Link>
            <Link href="/chat" className="chat-link">Chat →</Link>
          </div>
          <span className={`meals-count${eatenCount === 0 ? " none" : ""}`}>
            {eatenCount > 0 && <span className="dot" />}
            {eatenCount} / {meals.length} eaten
          </span>
        </div>
      </div>

      {/* calorie ring */}
      <div className="ring-block">
        <div className="ring-wrap">
          <svg width="172" height="172" viewBox="0 0 172 172">
            <circle cx="86" cy="86" r={RING_R} fill="none" stroke="var(--ring-track)" strokeWidth="11" />
            <circle
              cx="86"
              cy="86"
              r={RING_R}
              fill="none"
              stroke="var(--ink)"
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

      <div className="rule" />

      <div className="macros">
        <MacroRow label="Protein" remaining={remaining.proteinG} consumed={consumed.proteinG} target={targets.proteinG} color="var(--protein)" />
        <MacroRow label="Carbs" remaining={remaining.carbsG} consumed={consumed.carbsG} target={targets.carbsG} color="var(--carbs)" />
        <MacroRow label="Fat" remaining={remaining.fatG} consumed={consumed.fatG} target={targets.fatG} color="var(--fat)" />
      </div>

      {weighInDue && <WeighIn date={date} latestWeighIn={latestWeighIn} />}

      <div className="rule" />

      <MealList key={date} meals={meals} date={date} />
    </main>
  );
}
