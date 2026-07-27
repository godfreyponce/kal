// DB-free: imports only ./adherence-calendar. No `import "../db/env"` needed.
import { describe, expect, it } from "vitest";
import {
  bestStreak,
  buildCalMonth,
  calDayVerdict,
  classifyHistoryRows,
  currentStreak,
  historyMonthRange,
} from "./adherence-calendar";

const T = { kcal: 2200, proteinG: 165 }; // real Macros shape (lib/adherence-view.ts): kcal + proteinG only

const HIST = {
  firstLogDate: "2026-04-06",
  days: [
    { date: "2026-04-06", state: "on" as const, kcal: 2200, proteinG: 165 },
    { date: "2026-04-07", state: "onx" as const, kcal: 2250, proteinG: 170 },
    { date: "2026-04-08", state: "off" as const, kcal: 3000, proteinG: 165 },
    // 2026-04-09 missing on purpose -> unlogged
    { date: "2026-04-10", state: "on" as const, kcal: 2150, proteinG: 168 },
  ],
};

describe("classifyHistoryRows", () => {
  it("maps hit+clean to on, hit+extras to onx, miss to off, and carries the macros", () => {
    expect(classifyHistoryRows([
      { date: "2026-04-06", kcal: 2200, proteinG: 165, hasExtras: false },
      { date: "2026-04-07", kcal: 2200, proteinG: 165, hasExtras: true },
      { date: "2026-04-08", kcal: 3000, proteinG: 165, hasExtras: false },
    ], T)).toEqual([
      { date: "2026-04-06", state: "on", kcal: 2200, proteinG: 165 },
      { date: "2026-04-07", state: "onx", kcal: 2200, proteinG: 165 },
      { date: "2026-04-08", state: "off", kcal: 3000, proteinG: 165 },
    ]);
  });
});

describe("historyMonthRange", () => {
  it("spans first-log month to today's month", () =>
    expect(historyMonthRange(HIST, "2026-07-16")).toEqual({ first: 2026 * 12 + 3, last: 2026 * 12 + 6 }));
  it("collapses to today's month when history is empty", () =>
    expect(historyMonthRange({ firstLogDate: null, days: [] }, "2026-07-16")).toEqual({ first: 2026 * 12 + 6, last: 2026 * 12 + 6 }));
});

describe("buildCalMonth", () => {
  const april = buildCalMonth(2026 * 12 + 3, HIST, "2026-07-16");
  const states = Object.fromEntries(april.cells.map(c => [c.day, c.state]));
  it("labels and aligns Mon-first", () => {
    expect(april.label).toBe("April 2026");
    expect(april.leading).toBe(2);            // Wed Apr 1 2026
    expect(april.cells).toHaveLength(30);
  });
  it("marks pre / judged / unlogged states", () => {
    expect(states[5]).toBe("pre");
    expect(states[6]).toBe("on");
    expect(states[7]).toBe("onx");
    expect(states[8]).toBe("off");
    expect(states[9]).toBe("unlogged");       // in logged era, no row -> miss
  });
  it("summary counts both greens as on and breaks streak on unlogged", () => {
    // judged: 6..30 = 25 days (4 logged + 21 unlogged); on = 3 (04-06 on, 04-07 onx, 04-10 on)
    // NOTE: the plan brief's reference test asserted on:2 here, but HIST has three
    // on/onx days in April (04-06, 04-07, 04-10) — see task-1-report.md for detail.
    expect(april.summary).toEqual({ on: 3, judged: 25, bestStreak: 2 });
  });
  const july = buildCalMonth(2026 * 12 + 6, HIST, "2026-07-16");
  const jstates = Object.fromEntries(july.cells.map(c => [c.day, c.state]));
  it("marks today and future", () => {
    expect(jstates[16]).toBe("today");
    expect(jstates[17]).toBe("future");
    expect(jstates[15]).toBe("unlogged");
  });

  it("an unlogged gap (no off day) still breaks the streak", () => {
    const histUnloggedGap = {
      firstLogDate: "2026-04-06",
      days: [
        { date: "2026-04-06", state: "on" as const, kcal: 2200, proteinG: 165 },
        { date: "2026-04-07", state: "on" as const, kcal: 2200, proteinG: 165 },
        // 2026-04-08 missing on purpose -> unlogged, no "off" row involved
        { date: "2026-04-09", state: "on" as const, kcal: 2200, proteinG: 165 },
      ],
    };
    const result = buildCalMonth(2026 * 12 + 3, histUnloggedGap, "2026-07-16");
    expect(result.summary.bestStreak).toBe(2);
  });
});

describe("buildCalMonth consumed", () => {
  const april = buildCalMonth(2026 * 12 + 3, HIST, "2026-07-16");
  const byDay = Object.fromEntries(april.cells.map(c => [c.day, c.consumed]));
  it("attaches macros to judged days only", () => {
    expect(byDay[6]).toEqual({ kcal: 2200, proteinG: 165 });   // on
    expect(byDay[8]).toEqual({ kcal: 3000, proteinG: 165 });   // off
    expect(byDay[9]).toBeNull();                                // unlogged, no row
    expect(byDay[5]).toBeNull();                                // pre
  });
});

describe("calDayVerdict", () => {
  it("reuses the shared copy for the judged states", () => {
    expect(calDayVerdict("on", { kcal: 2200, proteinG: 165 }, T)).toEqual({ kind: "hit", text: "✓ on plan" });
    expect(calDayVerdict("onx", { kcal: 2200, proteinG: 165 }, T)).toEqual({ kind: "hit", text: "✓ on plan, with extras" });
    expect(calDayVerdict("off", { kcal: 3000, proteinG: 165 }, T)).toEqual({ kind: "miss", text: "✕ 800 over kcal" });
    expect(calDayVerdict("off", { kcal: 2200, proteinG: 100 }, T)).toEqual({ kind: "miss", text: "✕ short protein" });
    expect(calDayVerdict("unlogged", null, T)).toEqual({ kind: "miss", text: "✕ off plan" });
    expect(calDayVerdict("today", { kcal: 900, proteinG: 60 }, T)).toEqual({ kind: "wip", text: "in progress" });
  });
  it("has nothing to say about days outside the logged era", () => {
    expect(calDayVerdict("future", null, T)).toBeNull();
    expect(calDayVerdict("pre", null, T)).toBeNull();
  });
});

describe("currentStreak", () => {
  it("counts back from yesterday and stops at the first miss or gap", () => {
    expect(currentStreak(HIST, "2026-04-11")).toBe(1);  // 04-10 on, 04-09 unlogged
    expect(currentStreak(HIST, "2026-04-09")).toBe(0);  // 04-08 off
    expect(currentStreak(HIST, "2026-04-08")).toBe(2);  // 04-07 onx, 04-06 on
  });
  it("returns 0 with no history", () =>
    expect(currentStreak({ firstLogDate: null, days: [] }, "2026-07-16")).toBe(0));
});

describe("bestStreak", () => {
  it("takes the longest run in all of history, broken by a miss or a gap", () => {
    expect(bestStreak(HIST)).toBe(2);  // 04-06 + 04-07; 04-08 off, then 04-09 is a gap
  });
  it("keeps counting across a month boundary", () => {
    const hist = {
      firstLogDate: "2026-04-29",
      days: [
        { date: "2026-04-29", state: "on" as const, kcal: 2200, proteinG: 165 },
        { date: "2026-04-30", state: "on" as const, kcal: 2200, proteinG: 165 },
        { date: "2026-05-01", state: "onx" as const, kcal: 2200, proteinG: 165 },
      ],
    };
    expect(bestStreak(hist)).toBe(3);
  });
  it("returns 0 with no history, and 0 when nothing was ever on plan", () => {
    expect(bestStreak({ firstLogDate: null, days: [] })).toBe(0);
    expect(bestStreak({
      firstLogDate: "2026-04-06",
      days: [{ date: "2026-04-06", state: "off" as const, kcal: 3000, proteinG: 100 }],
    })).toBe(0);
  });
});
