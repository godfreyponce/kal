// Pure calendar model for the #23 adherence history sheet. DB-free on purpose:
// tests need no DATABASE_URL (same split as adherence-view.ts vs adherence.ts).
import { judgeDay, type Macros } from "./adherence-view";

export type JudgedState = "on" | "onx" | "off"; // onx = on plan with extras
export type CalDayState = JudgedState | "unlogged" | "today" | "future" | "pre";
export interface JudgedDay { date: string; state: JudgedState }
export interface AdherenceHistory { days: JudgedDay[]; firstLogDate: string | null }
export interface HistoryRow { date: string; kcal: number; proteinG: number; hasExtras: boolean }
export interface CalCell { day: number; date: string; state: CalDayState }
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
  const byDate = new Map(history.days.map(d => [d.date, d.state]));
  const cells: CalCell[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    let state: CalDayState;
    if (date === today) state = "today";
    else if (date > today) state = "future";
    else if (!history.firstLogDate || date < history.firstLogDate) state = "pre";
    else state = byDate.get(date) ?? "unlogged";
    cells.push({ day, date, state });
  }
  let on = 0, judged = 0, streak = 0, bestStreak = 0;
  for (const c of cells) {
    if (c.state === "on" || c.state === "onx") { on++; judged++; streak++; bestStreak = Math.max(bestStreak, streak); }
    else if (c.state === "off" || c.state === "unlogged") { judged++; streak = 0; }
    // today/future/pre: neither judged nor streak-breaking
  }
  return { label: `${MONTHS[m]} ${y}`, leading, cells, summary: { on, judged, bestStreak } };
}
