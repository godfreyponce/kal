"use client";

// Client component — the strip renders server-provided data and opens a day-detail
// modal on tap (issue #22). Runtime helpers come from lib/adherence-view (DB-free);
// types come from lib/adherence (type-only import, erased). Desktop keeps the :hover tooltip.
import { useRef, useState } from "react";
import type { WeekAdherence, DayCell } from "@/lib/adherence";
import { dayVerdict, kcalWithinBand, proteinMet } from "@/lib/adherence-view";
import type { DayFood } from "@/lib/adherence-view";
import type { AdherenceHistory } from "@/lib/adherence-calendar";
import { DayDetailModal } from "./day-detail-modal";
import { AdherenceCalendar } from "./adherence-calendar";

const TRACK_PX = 64;   // .track height
const TARGET_PX = 48;  // kcal target height within the track (matches .e-line top: 16px)

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHDAY = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const num = (n: number) => Math.round(n).toLocaleString("en-US");

// px from the track floor; target kcal sits at TARGET_PX, clamped to the track.
const barPx = (kcal: number, targetKcal: number) =>
  Math.min(TRACK_PX, Math.round((kcal / targetKcal) * TARGET_PX));

function Cell({
  day,
  targets,
  onOpen,
}: {
  day: DayCell;
  targets: WeekAdherence["targets"];
  onOpen: (day: DayCell) => void;
}) {
  const label = MONTHDAY(day.date);

  if (day.state === "ahead") {
    return (
      <button type="button" className="cell ahead" disabled>
        <div className="tip"><b>{label}</b><br /><span className="verdict v-ahead">not yet</span></div>
        <div className="track ahead" />
        <span className="pdot hide" />
        <span className="dow">{day.dow}</span>
      </button>
    );
  }

  const c = day.consumed ?? { kcal: 0, proteinG: 0 };

  if (day.state === "today") {
    const left = targets.kcal - c.kcal;
    return (
      <button type="button" className="cell today" onClick={() => onOpen(day)}>
        <span className="now-tag">now</span>
        <div className="tip">
          <b>{label}, today</b><br />
          kcal <span className="k-now">{num(c.kcal)}</span> of {num(targets.kcal)}<br />
          protein <span className="k-now">{num(c.proteinG)}</span> of {num(targets.proteinG)} g<br />
          <span className="verdict v-wip">{left >= 0 ? `${num(left)} kcal left` : `${num(-left)} over target`}</span>
        </div>
        <div className="track"><div className="fill now" style={{ height: `${barPx(c.kcal, targets.kcal)}px` }} /></div>
        <span className="pdot now" />
        <span className="dow">{day.dow}</span>
      </button>
    );
  }

  if (day.state === "unlogged") {
    return (
      <button type="button" className="cell" onClick={() => onOpen(day)}>
        <div className="tip"><b>{label}</b><br />nothing logged<br /><span className="verdict v-miss">✕ off plan</span></div>
        <div className="track void" />
        <span className="pdot short" />
        <span className="dow">{day.dow}</span>
      </button>
    );
  }

  // on-plan | off-plan — a past, logged day. Number colors use the band checks;
  // the verdict copy is the shared dayVerdict (also used by the modal).
  const kcalOk = kcalWithinBand(c, targets);
  const proteinOk = proteinMet(c, targets);
  const hit = day.state === "on-plan";
  const verdict = dayVerdict(day, targets).text;

  return (
    <button type="button" className="cell" onClick={() => onOpen(day)}>
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
    </button>
  );
}

export function WeeklyAdherence({
  week,
  foodsByDate,
  history,
  today,
}: {
  week: WeekAdherence;
  foodsByDate: Record<string, DayFood[]>;
  history: AdherenceHistory;
  today: string;
}) {
  const { targets, days, onPlanCount } = week;
  const [open, setOpen] = useState<DayCell | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={bodyRef} className="adh-body" role="group" aria-label={`${onPlanCount} of 7 days on plan this week`}>
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
                <Cell key={day.date} day={day} targets={targets} onOpen={setOpen} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <AdherenceCalendar history={history} today={today} stripRef={bodyRef} />
      {open && (
        <DayDetailModal
          day={open}
          targets={targets}
          foods={foodsByDate[open.date] ?? []}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
