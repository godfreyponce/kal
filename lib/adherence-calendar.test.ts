// DB-free: imports only ./adherence-calendar. No `import "../db/env"` needed.
import { describe, expect, it } from "vitest";
import { buildCalMonth, classifyHistoryRows, historyMonthRange } from "./adherence-calendar";

const T = { kcal: 2200, proteinG: 165 }; // real Macros shape (lib/adherence-view.ts): kcal + proteinG only

const HIST = {
  firstLogDate: "2026-04-06",
  days: [
    { date: "2026-04-06", state: "on" as const },
    { date: "2026-04-07", state: "onx" as const },
    { date: "2026-04-08", state: "off" as const },
    // 2026-04-09 missing on purpose -> unlogged
    { date: "2026-04-10", state: "on" as const },
  ],
};

describe("classifyHistoryRows", () => {
  it("maps hit+clean to on, hit+extras to onx, miss to off", () => {
    expect(classifyHistoryRows([
      { date: "2026-04-06", kcal: 2200, proteinG: 165, hasExtras: false },
      { date: "2026-04-07", kcal: 2200, proteinG: 165, hasExtras: true },
      { date: "2026-04-08", kcal: 3000, proteinG: 165, hasExtras: false },
    ], T)).toEqual([
      { date: "2026-04-06", state: "on" },
      { date: "2026-04-07", state: "onx" },
      { date: "2026-04-08", state: "off" },
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
        { date: "2026-04-06", state: "on" as const },
        { date: "2026-04-07", state: "on" as const },
        // 2026-04-08 missing on purpose -> unlogged, no "off" row involved
        { date: "2026-04-09", state: "on" as const },
      ],
    };
    const result = buildCalMonth(2026 * 12 + 3, histUnloggedGap, "2026-07-16");
    expect(result.summary.bestStreak).toBe(2);
  });
});
