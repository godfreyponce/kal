// Pure calendar model for the #23 adherence history sheet. DB-free on purpose:
// tests need no DATABASE_URL (same split as adherence-view.ts vs adherence.ts).
import { judgeDay, dayVerdict, type Macros, type DayVerdict, type DayCell } from "./adherence-view";

export type JudgedState = "on" | "onx" | "off"; // onx = on plan with extras
export type CalDayState = JudgedState | "unlogged" | "today" | "future" | "pre";
export interface JudgedDay { date: string; state: JudgedState; kcal: number; proteinG: number }
export interface AdherenceHistory { days: JudgedDay[]; firstLogDate: string | null }
export interface HistoryRow { date: string; kcal: number; proteinG: number; hasExtras: boolean }
export interface CalCell { day: number; date: string; state: CalDayState; consumed: Macros | null }
export interface CalMonth {
  label: string;               // "July 2026"
  leading: number;             // blank cells before day 1 (Mon-first)
  cells: CalCell[];
  summary: { on: number; judged: number; bestStreak: number };
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export function classifyHistoryRows(rows: HistoryRow[], targets: Macros): JudgedDay[] {
  return rows.map(r => ({
    date: r.date,
    state: judgeDay({ kcal: r.kcal, proteinG: r.proteinG }, targets)
      ? (r.hasExtras ? "onx" : "on")
      : "off",
    kcal: r.kcal,
    proteinG: r.proteinG,
  }));
}

export function historyMonthRange(history: AdherenceHistory, today: string): { first: number; last: number } {
  const idx = (s: string) => { const d = new Date(s + "T00:00:00Z"); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const last = idx(today);
  return { first: history.firstLogDate ? Math.min(idx(history.firstLogDate), last) : last, last };
}

export function buildCalMonth(monthIdx: number, history: AdherenceHistory, today: string): CalMonth {
  const y = Math.floor(monthIdx / 12), m = monthIdx % 12;
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const leading = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;   // Mon-first
  const byDate = new Map(history.days.map(d => [d.date, d]));
  const cells: CalCell[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const logged = byDate.get(date);
    let state: CalDayState;
    if (date === today) state = "today";
    else if (date > today) state = "future";
    else if (!history.firstLogDate || date < history.firstLogDate) state = "pre";
    else state = logged?.state ?? "unlogged";
    const consumed = state === "on" || state === "onx" || state === "off"
      ? { kcal: logged!.kcal, proteinG: logged!.proteinG }
      : null;
    cells.push({ day, date, state, consumed });
  }
  let on = 0, judged = 0, streak = 0, bestStreak = 0;
  for (const c of cells) {
    if (c.state === "on" || c.state === "onx") { on++; judged++; streak++; bestStreak = Math.max(bestStreak, streak); }
    else if (c.state === "off" || c.state === "unlogged") { judged++; streak = 0; }
    // today/future/pre: neither judged nor streak-breaking
  }
  return { label: `${MONTHS[m]} ${y}`, leading, cells, summary: { on, judged, bestStreak } };
}

// The calendar's states are finer than the strip's (two greens, a pre-history state),
// so map onto the strip's before reusing its copy. Extras are the one thing the shared
// verdict cannot know about, so they are appended here.
const TO_DAY_STATE: Partial<Record<CalDayState, DayCell["state"]>> = {
  on: "on-plan", onx: "on-plan", off: "off-plan", unlogged: "unlogged", today: "today",
};

/** The popup's verdict line, or null for a day the calendar has nothing to say about. */
export function calDayVerdict(
  state: CalDayState,
  consumed: Macros | null,
  targets: Macros,
): DayVerdict | null {
  const mapped = TO_DAY_STATE[state];
  if (!mapped) return null; // future | pre
  const v = dayVerdict({ date: "", dow: "", state: mapped, consumed }, targets);
  return state === "onx" ? { ...v, text: `${v.text}, with extras` } : v;
}

const shiftDay = (iso: string, delta: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

/**
 * The run of on-plan days ending at the most recent judged day. Walks history
 * backwards from `today` (exclusive: today is not judged yet) and stops at the
 * first day that is off plan or has no row at all.
 */
export function currentStreak(history: AdherenceHistory, today: string): number {
  const byDate = new Map(history.days.map(d => [d.date, d]));
  let streak = 0;
  for (let iso = shiftDay(today, -1); ; iso = shiftDay(iso, -1)) {
    if (history.firstLogDate && iso < history.firstLogDate) return streak;
    const day = byDate.get(iso);
    if (!day || day.state === "off") return streak;
    streak++;
  }
}

/**
 * The longest run of on-plan days in all of history — the record the current run is
 * measured against, so it spans months. `history.days` holds logged days only and is
 * date-ascending, so a non-consecutive date is an unlogged gap and breaks the run.
 */
export function bestStreak(history: AdherenceHistory): number {
  let best = 0, run = 0, prev: string | null = null;
  for (const d of history.days) {
    if (d.state === "off") run = 0;
    else {
      run = prev && shiftDay(prev, 1) === d.date ? run + 1 : 1;
      best = Math.max(best, run);
    }
    prev = d.date;
  }
  return best;
}
