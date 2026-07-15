// Pure display + rule logic for weekly adherence. NO DB import — safe to pull into
// client components (the strip's tap-to-open modal). Mirrors lib/trend-geometry.ts.

export type Macros = { kcal: number; proteinG: number };

export type DayState =
  | "on-plan"   // past day, judged, passed
  | "off-plan"  // past day, judged, failed (has log entries)
  | "unlogged"  // past day, no log entries at all
  | "today"     // the current day, in progress — never judged, never counted
  | "ahead";    // a day later this week — nothing to show

export type DayCell = {
  date: string;              // YYYY-MM-DD
  dow: string;               // positional: M T W T F S S
  state: DayState;
  consumed: Macros | null;   // null for "ahead"; present (possibly {0,0}) otherwise
};

export type WeekAdherence = {
  targets: Macros;
  days: DayCell[];           // exactly 7, Monday→Sunday
  onPlanCount: number;       // count of days in state "on-plan" (0..7)
};

// One logged food for a day-detail row.
export type DayFood = { name: string; amountLabel: string; kcal: number; proteinG: number };

export type DayVerdict = { kind: "hit" | "miss" | "wip" | "ahead"; text: string };

// The day rule, in one place.
export const KCAL_TOLERANCE = 0.1; // ±10% of target
export const PROTEIN_FLOOR = 0.9;  // ≥90% of target

export const kcalWithinBand = (c: Macros, t: Macros): boolean =>
  c.kcal >= t.kcal * (1 - KCAL_TOLERANCE) && c.kcal <= t.kcal * (1 + KCAL_TOLERANCE);
export const proteinMet = (c: Macros, t: Macros): boolean =>
  c.proteinG >= t.proteinG * PROTEIN_FLOOR;

export function judgeDay(consumed: Macros, targets: Macros): boolean {
  return kcalWithinBand(consumed, targets) && proteinMet(consumed, targets);
}

const num = (n: number) => Math.round(n).toLocaleString("en-US");

// The verdict copy, shared by the strip cell and the day-detail modal.
// Spec §4a resolved: kcal failure is primary and shows its direction; a within-band
// day that fails only protein shows "short protein".
export function dayVerdict(day: DayCell, targets: Macros): DayVerdict {
  if (day.state === "ahead") return { kind: "ahead", text: "not yet" };
  if (day.state === "today") return { kind: "wip", text: "in progress" };
  if (day.state === "unlogged") return { kind: "miss", text: "✕ off plan" };
  if (day.state === "on-plan") return { kind: "hit", text: "✓ on plan" };
  const c = day.consumed ?? { kcal: 0, proteinG: 0 }; // off-plan
  if (!kcalWithinBand(c, targets)) {
    return {
      kind: "miss",
      text: c.kcal > targets.kcal
        ? `✕ ${num(c.kcal - targets.kcal)} over kcal`
        : `✕ ${num(targets.kcal - c.kcal)} under kcal`,
    };
  }
  return { kind: "miss", text: "✕ short protein" };
}

import { resolveItem } from "./resolve-item";

// One raw row from the week's log_entries⋈foods join.
export type DayFoodRow = {
  date: string;
  quantity: number;          // multiplier of the food's serving
  kcal: number;              // stored per-entry (what was logged) — authoritative
  proteinG: number;          // stored per-entry
  name: string;
  servingDesc: string;
  rawToCookedYield: number | null;
};

// Bucket the week's rows into per-date, in-order food lists. Amount label comes from
// resolveItem (needs only serving/quantity/yield); displayed kcal/protein are the
// STORED per-entry values so they agree with the strip's summed totals.
export function bucketDayFoods(rows: DayFoodRow[]): Record<string, DayFood[]> {
  const out: Record<string, DayFood[]> = {};
  for (const r of rows) {
    const { amountLabel } = resolveItem(r.quantity, {
      name: r.name,
      servingDesc: r.servingDesc,
      rawToCookedYield: r.rawToCookedYield,
      kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, // unused by amountLabel
    });
    (out[r.date] ??= []).push({
      name: r.name.replace(/,\s*cooked$/i, ""),
      amountLabel,
      kcal: r.kcal,
      proteinG: r.proteinG,
    });
  }
  return out;
}
