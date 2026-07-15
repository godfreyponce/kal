// app/plan/weekly-adherence.tsx
// Server component — renders the approved weekly-adherence design
// (design/plan-adherence-final.html). No "use client": the only interactivity is a
// pure-CSS :hover tooltip. Mobile tap-for-detail is issue #22.
import type { WeekAdherence, DayCell } from "@/lib/adherence";

const TRACK_PX = 64;   // .track height
const TARGET_PX = 48;  // kcal target height within the track (matches .e-line top: 16px)
const KCAL_TOLERANCE = 0.1;
const PROTEIN_FLOOR = 0.9;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHDAY = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const num = (n: number) => Math.round(n).toLocaleString("en-US");

// px from the track floor; target kcal sits at TARGET_PX, clamped to the track.
const barPx = (kcal: number, targetKcal: number) =>
  Math.min(TRACK_PX, Math.round((kcal / targetKcal) * TARGET_PX));

function Cell({ day, targets }: { day: DayCell; targets: WeekAdherence["targets"] }) {
  const label = MONTHDAY(day.date);

  if (day.state === "ahead") {
    return (
      <div className="cell ahead">
        <div className="tip"><b>{label}</b><br /><span className="verdict v-ahead">not yet</span></div>
        <div className="track ahead" />
        <span className="pdot hide" />
        <span className="dow">{day.dow}</span>
      </div>
    );
  }

  const c = day.consumed ?? { kcal: 0, proteinG: 0 };

  if (day.state === "today") {
    const left = targets.kcal - c.kcal;
    return (
      <div className="cell today">
        <span className="now-tag">now</span>
        <div className="tip">
          <b>{label} · today</b><br />
          kcal <span className="k-now">{num(c.kcal)}</span> of {num(targets.kcal)}<br />
          protein <span className="k-now">{num(c.proteinG)}</span> of {num(targets.proteinG)} g<br />
          <span className="verdict v-wip">{left >= 0 ? `${num(left)} kcal left` : `${num(-left)} over target`}</span>
        </div>
        <div className="track"><div className="fill now" style={{ height: `${barPx(c.kcal, targets.kcal)}px` }} /></div>
        <span className="pdot now" />
        <span className="dow">{day.dow}</span>
      </div>
    );
  }

  if (day.state === "unlogged") {
    return (
      <div className="cell">
        <div className="tip"><b>{label}</b><br />nothing logged<br /><span className="verdict v-miss">✕ off plan</span></div>
        <div className="track void" />
        <span className="pdot short" />
        <span className="dow">{day.dow}</span>
      </div>
    );
  }

  // on-plan | off-plan — a past, logged day.
  const kcalOk = c.kcal >= targets.kcal * (1 - KCAL_TOLERANCE) && c.kcal <= targets.kcal * (1 + KCAL_TOLERANCE);
  const proteinOk = c.proteinG >= targets.proteinG * PROTEIN_FLOOR;
  const hit = day.state === "on-plan";

  // Verdict copy. Spec §4a only specified "over kcal"; a day logged BELOW the −10% band
  // ("under kcal") and the both-fail case are resolved here — kcal failure is primary and
  // shows its direction; a within-band-but-low-protein day shows "short protein".
  let verdict: string;
  if (!kcalOk) {
    verdict = c.kcal > targets.kcal ? `✕ ${num(c.kcal - targets.kcal)} over kcal` : `✕ ${num(targets.kcal - c.kcal)} under kcal`;
  } else if (!proteinOk) {
    verdict = "✕ short protein";
  } else {
    verdict = "✓ on plan";
  }

  return (
    <div className="cell">
      <div className="tip">
        <b>{label}</b><br />
        kcal <span className={kcalOk ? "k-ok" : "k-bad"}>{num(c.kcal)}</span> of {num(targets.kcal)}<br />
        protein <span className={proteinOk ? "k-ok" : "k-bad"}>{num(c.proteinG)}</span> of {num(targets.proteinG)} g<br />
        <span className={`verdict ${hit ? "v-hit" : "v-miss"}`}>{verdict}</span>
      </div>
      <div className="track">
        <div className={`fill ${hit ? "hit" : "miss tex-miss"}`} style={{ height: `${barPx(c.kcal, targets.kcal)}px` }} />
      </div>
      <span className={`pdot ${proteinOk ? "ok" : "short"}`} />
      <span className="dow">{day.dow}</span>
    </div>
  );
}

export function WeeklyAdherence({ week }: { week: WeekAdherence }) {
  const { targets, days, onPlanCount } = week;
  return (
    <div className="adh-body" role="group" aria-label={`${onPlanCount} of 7 days on plan this week`}>
      <div className="adh-hero">
        <div className="adh-num">{onPlanCount}<small>/7</small></div>
        <div className="adh-lbl">days on plan</div>
        <div className="adh-legend">
          <div className="leg-row"><span className="leg-dash" />{num(targets.kcal)} kcal</div>
          <div className="leg-row"><span className="leg-dot" />{num(targets.proteinG)} g protein</div>
        </div>
      </div>
      <div className="adh-strip">
        <div className="plot">
          <div className="e-line" />
          <div className="cells">
            {days.map((day) => (
              <Cell key={day.date} day={day} targets={targets} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
