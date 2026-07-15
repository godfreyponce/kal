import "../db/env"; // adherence.ts transitively imports ../db (getWeekAdherence); load DATABASE_URL first
import { describe, it, expect } from "vitest";
import { judgeDay, weekDays, classifyWeek } from "./adherence";

const TARGETS = { kcal: 2200, proteinG: 180 }; // 90% protein = 162; ±10% kcal = [1980, 2420]

describe("judgeDay", () => {
  it("within kcal band and protein over floor → on plan", () => {
    expect(judgeDay({ kcal: 2180, proteinG: 184 }, TARGETS)).toBe(true);
  });
  it("kcal 1% past the +10% edge → off plan", () => {
    // 2200 * 1.11 = 2442 > 2420
    expect(judgeDay({ kcal: 2442, proteinG: 184 }, TARGETS)).toBe(false);
  });
  it("kcal exactly at the −10% edge → on plan (inclusive)", () => {
    // 2200 * 0.9 = 1980
    expect(judgeDay({ kcal: 1980, proteinG: 184 }, TARGETS)).toBe(true);
  });
  it("protein exactly at 90% floor → on plan (inclusive)", () => {
    // 180 * 0.9 = 162
    expect(judgeDay({ kcal: 2200, proteinG: 162 }, TARGETS)).toBe(true);
  });
  it("protein just under the 90% floor → off plan", () => {
    expect(judgeDay({ kcal: 2200, proteinG: 161 }, TARGETS)).toBe(false);
  });
  it("nothing logged (0,0) → off plan", () => {
    expect(judgeDay({ kcal: 0, proteinG: 0 }, TARGETS)).toBe(false);
  });
});

describe("weekDays", () => {
  it("a mid-week date returns Mon→Sun of that week", () => {
    // 2026-07-14 is a Tuesday
    expect(weekDays("2026-07-14")).toEqual([
      "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16",
      "2026-07-17", "2026-07-18", "2026-07-19",
    ]);
  });
  it("a Sunday returns THIS week (not next) — Sunday is the last cell", () => {
    expect(weekDays("2026-07-19")).toEqual([
      "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16",
      "2026-07-17", "2026-07-18", "2026-07-19",
    ]);
  });
  it("a Monday returns itself as the first cell", () => {
    expect(weekDays("2026-07-13")[0]).toBe("2026-07-13");
  });
});

describe("classifyWeek", () => {
  it("mixed finished week: hit / logged-miss / unlogged / today → right states and count", () => {
    const map = new Map<string, { kcal: number; proteinG: number }>([
      ["2026-07-13", { kcal: 2180, proteinG: 184 }], // Mon on-plan
      ["2026-07-14", { kcal: 2246, proteinG: 176 }], // Tue on-plan
      ["2026-07-15", { kcal: 2680, proteinG: 175 }], // Wed off-plan (kcal over)
      ["2026-07-16", { kcal: 2185, proteinG: 171 }], // Thu on-plan
      // 2026-07-17 Fri absent → unlogged
      ["2026-07-18", { kcal: 2090, proteinG: 168 }], // Sat on-plan
      ["2026-07-19", { kcal: 1980, proteinG: 166 }], // Sun = today, not judged
    ]);
    const week = classifyWeek("2026-07-19", TARGETS, map);
    expect(week.days.map((d) => d.state)).toEqual([
      "on-plan", "on-plan", "off-plan", "on-plan", "unlogged", "on-plan", "today",
    ]);
    expect(week.onPlanCount).toBe(4);
    expect(week.days.map((d) => d.dow)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
  });

  it("today is never counted even if its partial log would pass the rule", () => {
    const map = new Map([["2026-07-14", { kcal: 2200, proteinG: 180 }]]); // Tue, a passing day
    const week = classifyWeek("2026-07-14", TARGETS, map);
    expect(week.days[1].state).toBe("today");
    expect(week.onPlanCount).toBe(0);
  });

  it("days after today are 'ahead' with null consumed", () => {
    const week = classifyWeek("2026-07-14", TARGETS, new Map()); // Tuesday
    expect(week.days.map((d) => d.state)).toEqual([
      "unlogged", "today", "ahead", "ahead", "ahead", "ahead", "ahead",
    ]);
    expect(week.days[2].consumed).toBeNull();
  });
});
