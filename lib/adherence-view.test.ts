// DB-free: imports only ./adherence-view. No `import "../db/env"` needed.
import { describe, it, expect } from "vitest";
import { dayVerdict, judgeDay } from "./adherence-view";
import type { DayCell, Macros } from "./adherence-view";

const T: Macros = { kcal: 2200, proteinG: 165 }; // ±10% kcal = [1980,2420]; 90% protein = 148.5
const cell = (state: DayCell["state"], kcal: number, proteinG: number): DayCell => ({
  date: "2026-07-08", dow: "T", state, consumed: { kcal, proteinG },
});

describe("dayVerdict", () => {
  it("on-plan → hit ✓ on plan", () => {
    expect(dayVerdict(cell("on-plan", 2180, 168), T)).toEqual({ kind: "hit", text: "✓ on plan" });
  });
  it("off-plan over the kcal band → miss, over kcal", () => {
    expect(dayVerdict(cell("off-plan", 2600, 168), T)).toEqual({ kind: "miss", text: "✕ 400 over kcal" });
  });
  it("off-plan under the kcal band → miss, under kcal", () => {
    expect(dayVerdict(cell("off-plan", 1720, 168), T)).toEqual({ kind: "miss", text: "✕ 480 under kcal" });
  });
  it("off-plan within kcal band but low protein → miss, short protein", () => {
    // 2410 is within ±10% of 2200; protein 142 < 148.5
    expect(dayVerdict(cell("off-plan", 2410, 142), T)).toEqual({ kind: "miss", text: "✕ short protein" });
  });
  it("unlogged → miss ✕ off plan", () => {
    expect(dayVerdict({ ...cell("unlogged", 0, 0) }, T)).toEqual({ kind: "miss", text: "✕ off plan" });
  });
  it("today → wip in progress", () => {
    expect(dayVerdict(cell("today", 980, 74), T)).toEqual({ kind: "wip", text: "in progress" });
  });
  it("ahead → ahead not yet", () => {
    expect(dayVerdict({ date: "2026-07-20", dow: "S", state: "ahead", consumed: null }, T))
      .toEqual({ kind: "ahead", text: "not yet" });
  });
});

describe("judgeDay (moved, still exported)", () => {
  it("within band + protein floor → true", () => {
    expect(judgeDay({ kcal: 2180, proteinG: 168 }, T)).toBe(true);
  });
  it("nothing logged → false", () => {
    expect(judgeDay({ kcal: 0, proteinG: 0 }, T)).toBe(false);
  });
});

import { bucketDayFoods, type DayFoodRow } from "./adherence-view";

describe("bucketDayFoods", () => {
  const rows: DayFoodRow[] = [
    { date: "2026-07-08", quantity: 1, kcal: 520, proteinG: 38, name: "Oats + whey", servingDesc: "1 bowl", rawToCookedYield: null },
    { date: "2026-07-08", quantity: 3, kcal: 940, proteinG: 39, name: "Pizza", servingDesc: "1 slice", rawToCookedYield: null },
    { date: "2026-07-09", quantity: 1.7, kcal: 281, proteinG: 53, name: "Chicken breast, cooked", servingDesc: "100 g", rawToCookedYield: 0.75 },
  ];
  const out = bucketDayFoods(rows);

  it("buckets rows by date, preserving order", () => {
    expect(Object.keys(out)).toEqual(["2026-07-08", "2026-07-09"]);
    expect(out["2026-07-08"].map((f) => f.name)).toEqual(["Oats + whey", "Pizza"]);
  });
  it("labels a count serving as 'N unit' and uses stored kcal/protein", () => {
    expect(out["2026-07-08"][1]).toEqual({ name: "Pizza", amountLabel: "3 slice", kcal: 940, proteinG: 39 });
  });
  it("labels a grams serving with the oz hint and strips a ', cooked' suffix from the name", () => {
    // 1.7 × 100 g = 170 g (6 oz)
    expect(out["2026-07-09"][0]).toEqual({
      name: "Chicken breast", amountLabel: "170 g (6 oz)", kcal: 281, proteinG: 53,
    });
  });
});
