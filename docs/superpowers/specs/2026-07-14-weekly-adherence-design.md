# Weekly adherence on /plan — design (issue #6)

**Status:** design approved 2026-07-14, awaiting spec-review gate before planning.
**Issue:** #6 (re-scoped from "Trends screen: weight chart + weekly adherence").
**Visual reference:** `design/plan-adherence-final.html` (open in a browser; the left card
is Tuesday with a hover forced open, the right card is the same week finished on Sunday).

## 1. Scope

#6 originally asked for a Trends screen with a weight chart and weekly adherence. The weight
chart was already built into /plan during #5 Phase 2 (`lib/trend-geometry.ts` +
`app/plan/weight-trend.tsx`), so this issue is **re-scoped to just the adherence half**, added
to /plan as a new section — no new screen, no new route.

The feature is a **weekly-adherence module**: a headline "X/7 days on plan" and a seven-bar
strip, one bar per day of the current calendar week, showing how each day's calories landed
against target.

Decisions locked with the owner (recorded on the issue and refined over the mockup rounds):

- **Metric:** "X/7 days on plan." A day is *on plan* when its logged calories are within ±10%
  of the calorie target AND its logged protein is ≥90% of the protein target.
- **Window:** a **fixed Monday→Sunday calendar week** (not a rolling 7 days). The day letters
  never move. Today is shown live and fills as the day's log grows; days later in the week are
  shown empty and unjudged.
- **Denominator is always 7.** The count grows through the week and resets to 0/7 each Monday.
- **Unlogged past day = off-plan.** No special rule needed — 0 kcal is outside ±10% of any
  target — but the UI renders it distinctly from a logged-but-missed day.
- **History beyond this week is out of scope.** The strip only ever shows the current week.
  Longer history is a follow-on (issue #23, swipe-up calendar).

## 2. Architecture

Mirror the existing weight-trend split: **pure, testable logic in `lib/`; a dumb presentation
component in `app/plan/`; the page's `Promise.all` feeds it.**

```
lib/adherence.ts          — types + pure logic + one thin query
app/plan/weekly-adherence.tsx — server component, renders the strip (CSS-only hover)
app/plan/page.tsx         — adds getWeekAdherence() to Promise.all, renders <WeeklyAdherence/>
app/globals.css           — .adh-* styles (section "Plan — weekly adherence")
lib/adherence.test.ts     — unit tests for the pure logic
```

The strip is a **server component**. The only interactivity is the hover tooltip, which the
mockup implements in pure CSS (`:hover`), so no `"use client"`, no hydration, no fetch. (Mobile
tap-for-detail is deliberately deferred to issue #22; there is no hover on touch.) The page is
already `export const dynamic = "force-dynamic"`, so each visit reflects the current day's log.

## 3. Data model & pure logic (`lib/adherence.ts`)

```ts
type Macros = { kcal: number; proteinG: number };

// Thresholds — the day rule, in one place.
const KCAL_TOLERANCE = 0.10;   // ±10% of target
const PROTEIN_FLOOR  = 0.90;   // ≥90% of target

export type DayState =
  | "on-plan"     // past day, judged, passed
  | "off-plan"    // past day, judged, failed (but has log entries)
  | "unlogged"    // past day, no log entries at all
  | "today"       // the current day, in progress, not judged
  | "ahead";      // a day later this week, nothing to show

export type DayCell = {
  date: string;          // YYYY-MM-DD
  dow: string;           // "M" | "T" | "W" | "T" | "F" | "S" | "S"
  state: DayState;
  consumed: Macros | null;   // null for "ahead"; present (possibly 0) otherwise
};

export type WeekAdherence = {
  targets: Macros;       // kcal + protein targets from profile
  days: DayCell[];       // exactly 7, Monday→Sunday
  onPlanCount: number;   // number of days in state "on-plan" (0..7)
};
```

### 3a. `judgeDay(consumed, targets): boolean` — the rule (pure)

```ts
export function judgeDay(consumed: Macros, targets: Macros): boolean {
  const kcalOk =
    consumed.kcal >= targets.kcal * (1 - KCAL_TOLERANCE) &&
    consumed.kcal <= targets.kcal * (1 + KCAL_TOLERANCE);
  const proteinOk = consumed.proteinG >= targets.proteinG * PROTEIN_FLOOR;
  return kcalOk && proteinOk;
}
```

### 3b. `weekDays(today: string): string[]` — the calendar math (pure)

Returns the 7 ISO dates Monday→Sunday for the week containing `today`. Civil-date arithmetic on
the string, matching the existing page.tsx pattern (`new Date(today + "T00:00:00Z")` then
`setUTCDate`). Day-of-week via `getUTCDay()` (0=Sun..6=Sat); Monday offset = `(dow + 6) % 7`.
No local-time `Date` math (Vercel runs UTC — see the STATE.md gotcha).

### 3c. `classifyWeek(today, targets, consumedByDate): WeekAdherence` — pure

Takes the query result as a `Map<string, Macros>` (dates with at least one log entry) so it is
unit-testable **without a database**. For each of the 7 dates from `weekDays(today)`:

- `date > today` → `ahead`, `consumed: null`.
- `date === today` → `today`, `consumed` = that date's sum (0 if none). Not judged, not counted.
- `date < today`:
  - not in the map → `unlogged`, `consumed: { kcal: 0, proteinG: 0 }`.
  - in the map → `judgeDay(consumed, targets)` → `on-plan` or `off-plan`.

`onPlanCount` = count of `on-plan` days. `dow` letters are positional (M T W T F S S).

### 3d. `getWeekAdherence(today?): Promise<WeekAdherence>` — thin query wrapper

Follows `getDaySummary`'s shape. `today` defaults to `todayInAppTz()`. Runs two queries in one
`Promise.all`:

1. profile targets (`targetKcal`, `targetProteinG`).
2. one grouped sum over `log_entries` where `date` ∈ [monday, sunday], `GROUP BY date`, selecting
   `date`, `sum(kcal)`, `sum(protein_g)` — the same `sql\`coalesce(sum(...))\`.mapWith(Number)`
   idiom as `getDaySummary`. Future days in range simply return no rows.

Build the `Map<string, Macros>` from the rows, then `return classifyWeek(today, targets, map)`.
One HTTP round-trip per query (neon-http), batched — no N+1.

## 4. UI (`app/plan/weekly-adherence.tsx` + globals.css)

Placement: a new `<section>` in `app/plan/page.tsx` **between Profile and Meal plan** (first
child after Profile), with the standard `plan-sec-head` kicker row:

```
[ Adherence ]                              [ this week ]
```

### Layout (see `design/plan-adherence-final.html`)

A `plan-card` containing a flex row: a left **hero block** and a right **strip**.

**Hero block** (fixed width, left):
- `X/7` — big mono number (`onPlanCount` / 7). The `/7` is muted.
- `DAYS ON PLAN` — mono micro-label.
- **Legend, two rows**, which double as the definition of the two marks:
  - `— {targetKcal} kcal` — a short dashed stroke (the target line) + the kcal target.
  - `● {targetProteinG} g protein` — a green dot (the protein mark) + the protein target.

**Strip** (flex-1, right): a 7-column plot.
- One **dashed horizontal line** spans all seven columns at the kcal-target height — this is the
  only reference line (variant E). Bars are zero-based; the target sits at 48px of a 64px track.
- Each column: a **bar** (kcal), a **protein dot** below it, and the **day letter**.
- **Hover tooltip** (CSS-only) per column, showing both macros and the verdict (§4a).

### Per-state rendering

| `state`    | bar                                   | protein dot        | letter        |
|------------|---------------------------------------|--------------------|---------------|
| `on-plan`  | green, height ∝ kcal                   | filled green       | faint         |
| `off-plan` | terracotta-red + 45° texture, ∝ kcal  | filled green / red ring per protein | faint |
| `unlogged` | empty track with a red diagonal strike, no fill | red ring | faint         |
| `today`    | accent terracotta, ∝ kcal-so-far, `NOW` tag above | dashed accent ring | accent, bold |
| `ahead`    | pale empty track, no fill             | hidden (space kept)| very faint    |

The **miss texture** (a 45° hatch over the red fill) is required: red/green alone is only
marginally colorblind-safe, so hit/miss must not rest on hue alone. The protein dot is filled
green when protein ≥ floor, a red ring when short — a second, independent channel from the bar.

Bar height math lives in the component (trivial linear scale; `px = kcal / targetKcal * 48`,
clamped to the 64px track). Keeping it out of `lib/` keeps the pure logic presentation-free.

### 4a. Tooltip content

- past logged day: `{dow date}` / `kcal {got} of {target}` / `protein {got} of {target} g` /
  verdict `✓ on plan` or `✕ {n} over kcal` / `✕ short protein` (whichever failed; kcal-over shown
  as `consumed − target`).
- unlogged past day: `{dow date}` / `nothing logged` / `✕ off plan`.
- today: `{dow date} · today` / `kcal {got} of {target}` / `protein {got} of {target} g` /
  `{target − got} kcal left`.
- ahead: `{dow date}` / `not yet`.

"Over kcal" is measured against the **target** (the line), e.g. 2,680 vs 2,200 = "480 over" —
consistent with the target-line design (no ±10% ceiling is drawn).

## 5. Edge cases

- **Monday, early:** 0/7, one live bar, six `ahead` days. Verified acceptable in the mockups —
  the emptiest the module ever looks.
- **Empty profile targets:** targets are `NOT NULL` in schema, so always present. No guard.
- **No log entries all week:** all past days `unlogged`, today's bar at 0, count 0/7.
- **Protein numeric type:** `protein_g` is DB `numeric`; the `sum(...).mapWith(Number)` returns a
  JS number, as in `getDaySummary`. Compare as numbers.
- **DST / timezone:** all "today" and week-boundary math goes through `todayInAppTz()` and
  civil-date string arithmetic — never local `new Date()` day math.

## 6. Testing (`lib/adherence.test.ts`)

Unit tests for the pure logic (where the bugs live), matching `trend-geometry.test.ts` style —
no DB:

- `judgeDay`: on-plan; kcal 1% over the +10% edge → off; kcal at −10% edge → on; protein at
  exactly 90% → on, just under → off; unlogged (0,0) → off.
- `weekDays`: a mid-week date returns Mon→Sun correctly; a Sunday returns that week (not the
  next); a Monday returns itself first.
- `classifyWeek`: mixed week (hit / logged-miss / unlogged / today / ahead) produces the right
  `state` per day and the right `onPlanCount`; a future `today` position leaves later days
  `ahead`; today is never counted even if its partial log would pass.

`getWeekAdherence` (the query) is exercised in-app via the page; no live-DB integration test —
its only logic is the query shape, and all judgement is in the unit-tested pure functions.

`npx tsc --noEmit` clean; `npm test` green.

## 7. Out of scope (follow-on issues, already filed)

- **#22** — tap a day for a mobile day-detail sheet (there is no hover on touch; this is the
  mobile path to per-day numbers). Should reuse/generalize `app/meal-popup.tsx`.
- **#23** — swipe-up gesture reveals a calendar history view beyond the current week. Widens the
  same `getWeekAdherence` query from a week to a month.

Both depend on this issue's `lib/adherence.ts` and each need their own gesture research +
3-variant mockups before building.
