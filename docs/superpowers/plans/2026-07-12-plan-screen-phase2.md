# Plan Screen Phase 2 Implementation Plan — 3D figure + weight trend

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development,
> task-by-task with Sonnet workers (owner cost policy: Fable orchestrates/reviews only;
> escalate inline after 2 worker failures on the same task). Steps use checkbox syntax.

**Goal:** Replace the Phase-1 flat profile form on `/plan` with the interactive three.js
mannequin island + four per-region editor cards, add the weight-trend chart to the weight
editor, and land the deferred macros-dim-while-editing polish in the meal editor — per
`docs/superpowers/specs/2026-07-11-plan-screen-design.md` (build-order item 2) with
**`design/plan-figure.html` as the visual source of truth** (port its scene code; don't
reinvent it). Owner decisions 2026-07-12: no deploy before/during this phase; include the
inert "use my photos →" pill + note.

**Architecture:** No schema changes, no new routes. New reads go through the existing
server-loader pattern (`/plan` page `Promise.all`); profile edits keep using
`PATCH /api/profile`. The 3D figure is a client-only island (`next/dynamic`, `ssr: false`)
so three.js never enters the server bundle and only loads on `/plan`. Chart math lives in
a pure, DB-free lib so it's unit-testable (jsdom can't WebGL; the figure itself is verified
in a browser, not vitest).

---

## Decisions most likely to change (review these first)

### D1. Profile section layout — figure on top, four region cards below
- **Chosen:** `ProfileForm` (flat 7-field grid) is replaced by a `ProfileSection` client
  component: the figure island (400px, rounded 16) on top, then ONE editor card that swaps
  per region (design behavior), then the Phase-1 "Daily targets derived from the meal plan"
  line kept as a quiet footer under the card.
  - Regions → fields: **head** = age + sex · **chest** = weight + goal weight + trend chart
    · **waist** = body fat + height · **legs** = activity. Default region: **chest**.
  - Each card PATCHes only its own fields (the route already accepts partial patches).
  - Sex and activity stay **free-text inputs** (Phase-1 precedent; design hints dropdowns —
    cheap to swap later, and we don't have a blessed enum for activity).
- **Alternatives:** keep the flat form below the figure (less design-faithful, zero-risk);
  dropdowns for sex/activity (needs enum decisions from the owner).
- **Cost to change later:** low — cards are thin wrappers over the existing save logic.
- **Note:** the targets footer is NOT in the Figure design's profile section; it's kept
  because the owner accepted it in Phase 1. Say the word and it moves/goes.

### D2. Weight-trend chart shape
- **Chosen:** chart shows **all weigh-ins from the last 90 days**, x-positioned by real
  date (time-scaled — uneven gaps show as uneven spacing), spanning first→last point
  across the full width like the design.
  - Y domain: min/max over weights ∪ goal (when set), padded, gridlines at 5-lb steps
    with right-aligned labels; dashed accent goal line + `GOAL 160` label only when
    `goalWeightLb` is set.
  - Latest point emphasized (white ring + accent dot). Crosshair on pointermove snaps to
    the nearest point and drives the mono readout (`JUL 11 171.5 LB`); pointerleave resets
    to latest. `touch-action: pan-y` on the SVG.
  - Below: last **3** weigh-ins, newest first, each with a delta vs the previous weigh-in
    (first-ever shows no delta).
  - **Sparse/empty data:** 1 point → single dot + goal line, no path; 0 points → the trend
    block collapses to one quiet line: `no weigh-ins yet — log one in chat`.
- **Alternatives:** fixed 7-week weekly buckets like the mock (lies about real data);
  all-time window (unbounded growth).
- **Cost to change later:** trivial — window and bucket rules live in one pure function.

### D3. Chart data plumbing — server loader, no new route
- **Chosen:** new `lib/weigh-ins.ts` → `listWeighIns(since: string)` (asc), read in the
  `/plan` page `Promise.all` and passed down as props. The `since` parameter is an explicit
  date string (not "days back") so tests can use `2099-*` sentinel windows without touching
  real rows.
- **Alternative:** `GET /api/weigh-ins` REST route — rejected; nothing would call it
  (page is server-rendered, chart interactivity is client-side over passed data).
- **Cost to change later:** low.

### D4. Macros-dim + live totals (the deferred issue-#5 item)
- **Chosen:** while a meal edit is open, `MealPlanEditor` computes client-side:
  - `baselineMealKcal` = Σ `quantity × unitKcal` over the meal's ORIGINAL items,
  - `pendingMealKcal` = same formula over the current edit items,
  - strip shows `PLAN round(plan.totals.kcal − baseline + pending) KCAL`.
  - When `pending ≠ baseline`, the P/C/F macro spans dim to opacity 0.35 (design value)
    and the kcal number is the live pending one; on cancel/save everything snaps back to
    server truth via `router.refresh()`.
  - Baseline uses the SAME client formula as pending (not the server-resolved `meal.kcal`)
    so opening an edit never falsely dims — resolved kcal can differ from `q × unitKcal`
    for yield-adjusted foods, and we only care about *relative* change until save.
- **NOT included:** the design's pre-save "targets will recalculate" banner. Phase 1
  already shows the post-save banner, and a pre-save banner is only true for the
  every-day scope — flag if you want it (scope-gated), it's cheap to add.
- **Cost to change later:** trivial.

### D5. three.js integration
- **Chosen:** npm deps `three@^0.185` + dev `@types/three` (matches the design's pinned
  0.185.1). **No react-three-fiber** — the source of truth is imperative three.js code;
  porting it directly is lower-risk and lighter than translating to R3F.
  - `app/plan/profile-section.tsx` (`"use client"`): owns `selectedRegion` state, the four
    editor cards, targets footer, and mounts the figure via
    `dynamic(() => import("./figure-canvas"), { ssr: false, loading: … })`.
  - `app/plan/figure-canvas.tsx` (`"use client"`, client-only chunk): the whole island —
    canvas, chips, leader-line SVG, height rule, photos pill. Ports the design file's
    scene (lines ~797–1016: mannequin primitives, lights, blob shadow, OrbitControls
    constraints, raycast tap-vs-drag, idle rotation, IntersectionObserver pause,
    ResizeObserver, per-frame chip projection with away-fade, region emissive tint).
    Props: `{ chipValues, heightLabel, selectedRegion, onSelectRegion }`.
  - **Chips are plain DOM and render even when WebGL/import fails** — region editing never
    depends on 3D. Failure shows the design's text fallback in place of the canvas;
    leader lines stay hidden (nothing to project onto).
  - React StrictMode double-mount: init in `useEffect` with FULL cleanup (cancel RAF,
    dispose renderer/geometries/materials, disconnect both observers, remove listeners).
  - `prefers-reduced-motion` disables idle rotation. `touch-action: pan-y` on the canvas.
- **Alternatives:** R3F (+@react-three/drei) — more idiomatic React, but a second
  dependency layer and a full rewrite of proven code.
- **Cost to change later:** HIGH — this is the expensive piece; that's why it ports the
  approved design code nearly verbatim instead of improvising.

### D6. Chip copy & null handling
- head `AGE, SEX` → `30 M` (first letter of sex, uppercased) · chest `WEIGHT` → `171.5 lb`
  · waist `BODY FAT` → `15 %` or `—` when null · legs `ACTIVITY` → value or `—`.
  Height rule label `HEIGHT 175 CM`. All values live from the profile prop (refresh after
  save updates them).

### D7. Photos pill (inert, Phase-3 marker)
- Design's `use my photos →` pill bottom-right of the canvas; tap toggles the note copy:
  *"send a few photos (front-facing, arms slightly out) — an image-to-3d pass turns them
  into your model. stored privately on blob storage, never in the public repo. the
  mannequin stands in until then."* No upload, no handler beyond the toggle.

---

## Global constraints (house rules — same as Phase 1, plus figure-specific)

- Next 16: `ctx.params` is a Promise; `/plan` already `force-dynamic` — after build the
  route table must still show `/plan` as `ƒ`.
- **No schema changes. No new/changed routes.** Don't touch `lib/tools.ts`,
  `lib/system-prompt.ts`, or `db/`.
- Drizzle numerics are strings — `Number()` at the boundary.
- Integration tests hit live Neon: own sentinel per FILE (weigh-ins tests use `2099-*`
  dates), cleanup in `afterEach` AND `afterAll`; suite runs sequentially.
- Repo is PUBLIC: no env values, no owner personal data (chip/chart values come from the
  DB at runtime; never hardcode the owner's real numbers outside tests' sentinels).
- CSS: append to `app/globals.css`, namespaced `fig-*` / `tr-*` (+ small `plan-*`
  additions). Map design tokens → app tokens; design's `--hairline` → app `--border`;
  **never `var(--surface)`** (undefined app-wide, issue #19) — use `#fff`.
  After editing globals.css: `rm -rf .next`, restart dev, hard-refresh (Turbopack gotcha).
- No interpunct (·) separators in UI copy.
- jsdom can't WebGL: `figure-canvas.tsx` gets NO vitest coverage — testable logic goes in
  pure libs (Tasks 1–2); the figure is verified in a real browser (Task 8).
- Dev: `PORT=3100 npm run dev`. Verify per task: named vitest file, `npx tsc --noEmit`.
- Commit after every green task (`refs #5`); never commit with a red suite.

---

### Task 1: `lib/weigh-ins.ts` — weigh-in list read

**Files:** create `lib/weigh-ins.ts`, `lib/weigh-ins.test.ts`

**Interfaces:**
- Consumes: `db`, `weighIns` from schema.
- Produces: `listWeighIns(since: string): Promise<WeighInView[]>` where
  `WeighInView = { date: string; weightLb: number }`, ascending by date, `gte(date, since)`.
  Task 4's page loader imports this.

- [ ] Failing test first (`npx vitest run lib/weigh-ins.test.ts`): insert sentinel rows
  (`2099-06-01`, `2099-06-03`, `2099-06-08` — table has a unique date, use
  `onConflictDoUpdate` like the POST route), call `listWeighIns("2099-06-01")` and
  `listWeighIns("2099-06-03")`, assert ascending order, numeric `weightLb`, and window
  filtering; cleanup deletes `gte(date, "2099-01-01")` in afterEach + afterAll.
- [ ] Implement (~15 lines, mirror the `get_weight_trend` query in `lib/tools.ts:428`).
- [ ] `npx tsc --noEmit` clean → commit `feat(plan): lib/weigh-ins — window read for the trend chart (refs #5)`.

---

### Task 2: `lib/trend-geometry.ts` — pure chart math

**Files:** create `lib/trend-geometry.ts`, `lib/trend-geometry.test.ts`

**Interfaces (Task 3 consumes exactly these):**
```ts
export type TrendPoint = { x: number; y: number; date: string; weightLb: number };
export type TrendGeometry = {
  points: TrendPoint[];          // time-scaled x across [PAD_L, W-PAD_R]; single point → centered
  pathD: string | null;          // null when < 2 points
  gridlines: { y: number; label: string }[];   // 5-lb steps inside the padded domain
  goalY: number | null;          // null when goal is null or out of drawable range? NO — clamp: include goal in domain, so always drawable when set
  xLabels: { first: string; last: string } | null;  // "MAY 30" / "JUL 11" style, null when 0 points
};
export function buildTrendGeometry(
  entries: { date: string; weightLb: number }[],  // ascending
  goalWeightLb: number | null,
  viewBox?: { w: number; h: number },             // default 340×132 like the design
): TrendGeometry;
export function nearestPoint(points: TrendPoint[], x: number): TrendPoint | null;
export function recentLog(
  entries: { date: string; weightLb: number }[],  // ascending
  n?: number,                                     // default 3
): { date: string; weightLb: number; delta: number | null }[];  // newest first; delta vs previous weigh-in
```
- Date labels: `"MMM D"` uppercased, no year (`JUL 4`), formatted from the `YYYY-MM-DD`
  string with UTC parsing (`new Date(date + "T00:00:00Z")`) — never local-tz drift.
- Y domain: `[min, max]` over weights ∪ goal (when non-null), padded ~8% each side;
  y increases downward (SVG).

- [ ] Failing tests first: 0 entries (empty points, null path/labels), 1 entry (centered
  dot, no path), many entries with UNEVEN date gaps (x spacing proportional to days),
  goal below all weights (goalY inside viewBox, domain stretched), goal null (goalY null,
  domain from weights only), gridline labels at 5-lb multiples, `nearestPoint` snapping,
  `recentLog` deltas incl. first-ever null delta and n > entries.
- [ ] Implement. No DB, no DOM — plain math.
- [ ] `npx tsc --noEmit` clean → commit `feat(plan): trend-geometry — pure chart math for the weight trend (refs #5)`.

---

### Task 3: `app/plan/weight-trend.tsx` — chart component + CSS

**Files:** create `app/plan/weight-trend.tsx`; append `tr-*` styles to `app/globals.css`
(port the design's `.trend/.tr-*` block, lines 176–190, mapping tokens per Global
Constraints).

**Interfaces:**
- Consumes: Task 2's exports; props `{ entries: WeighInView[]; goalWeightLb: number | null }`.
- Produces: `<WeightTrend …/>` — Task 4 mounts it inside the chest editor card.

- [ ] `"use client"`. Render per D2: grid + labels, dashed goal line + label (when set),
  path + point dots, emphasized latest point, crosshair line, mono readout in the header
  row, recent-log rows, empty/single-point states. Crosshair via `pointermove`/`pointerleave`
  on the SVG using `nearestPoint` (design script lines 722–741 is the reference behavior).
  `role="img"` + descriptive `aria-label` like the design's.
- [ ] Verify: `npx tsc --noEmit` + `npm run lint` clean (visual check lands in Task 4;
  geometry is already unit-tested).
- [ ] Commit `feat(plan): weight-trend chart component (refs #5)`.

---

### Task 4: `ProfileSection` — region cards + chart mount + page wiring

**Files:** create `app/plan/profile-section.tsx`; modify `app/plan/page.tsx`;
**delete `app/plan/profile-form.tsx`** (its save/validation logic is absorbed into the
region cards — the file's own comment says Phase 2 does this); append `fig-*`/editor-card
styles to `globals.css` (design `.ed*` block, lines 141–163).

**Interfaces:**
- Consumes: `ProfileView`, `WeighInView`, `<WeightTrend/>`; `todayInAppTz`/date math for
  the 90-day window (`since` computed server-side in page.tsx: shift today by −90 days —
  reuse the `shiftDate` helper if exported, else compute with the same UTC pattern).
- Produces: `<ProfileSection profile={ProfileView} weighIns={WeighInView[]} />`;
  page passes `listWeighIns(since)` output. Placeholder figure slot: a plain 400px
  `.fig3d` div containing ONLY the (working) chips rail + height rule + photos pill —
  Task 5/6 replace the placeholder body with the canvas. Chips already switch the editor
  card (D5: chips are DOM, independent of WebGL).

- [ ] Build per D1/D6/D7: region state (default `chest`), chip rail with live values +
  active state, one editor card that swaps per region, per-card save PATCHing only its
  fields (port validation/error/saved-state handling from the deleted `profile-form.tsx` —
  NaN pre-checks, `gr-error` display, `Saved ✓`), targets footer, photos pill + note
  toggle. Chest card embeds `<WeightTrend/>` under the two inputs plus the design's hint
  line ("every weigh-in you log lands here — no deadline on the goal…").
- [ ] page.tsx: add `listWeighIns` to the `Promise.all`, swap `ProfileForm` →
  `ProfileSection`. Nothing else on the page changes.
- [ ] Verify: `npm test` green, `npx tsc --noEmit` clean, then dev server + browser at
  440px: chips switch cards, each region saves (restore values after), chart renders real
  weigh-ins, hover crosshair snaps, empty-goal hides the goal line.
- [ ] Commit `feat(plan): profile section — region editor cards + weight trend (refs #5)`.

---

### Task 5: three.js dep + `figure-canvas.tsx` scene core

**Files:** `npm i three && npm i -D @types/three`; create `app/plan/figure-canvas.tsx`;
modify `app/plan/profile-section.tsx` (dynamic import mounts the canvas into the
placeholder); append `fig3d` styles (design lines 88–97, 136–139).

**Interfaces:**
- Consumes: `three`, `three/examples/jsm/controls/OrbitControls.js` (npm path for the
  design's `three/addons/` import-map alias).
- Produces: `<FigureCanvas selectedRegion={r} onSelectRegion={(r) => …} />` default export
  (dynamic-import friendly), rendering canvas + fallback text only (chips stay in
  `profile-section` until Task 6 moves them in — Task 6 owns the projection wiring).

- [ ] Port the design scene EXACTLY (lines 811–950): renderer (pixelRatio ≤ 2, alpha),
  camera + `setViewOffset` RAIL_SHIFT −34, hemisphere + key light, mannequin primitives
  with `meshesByRegion`, blob-shadow CanvasTexture, OrbitControls constraints (no zoom/pan,
  damping, polar clamp), raycast tap-vs-drag (6px threshold) → `onSelectRegion`, idle
  rotation gated by `interacting`/`prefers-reduced-motion`, IntersectionObserver render
  pause, ResizeObserver, region emissive tint driven by the `selectedRegion` prop.
- [ ] React wrapper per D5: single `useEffect` init, refs for mutable scene handles, FULL
  cleanup (StrictMode-safe), try/catch on renderer creation → design's fallback text
  (`3d unavailable — needs webgl`).
- [ ] In `profile-section.tsx`: `const FigureCanvas = dynamic(() => import("./figure-canvas"), { ssr: false, loading: () => <div className="fig-loading" /> })`.
- [ ] Verify: `npx tsc --noEmit`, `npm run build` (route table: `/plan` still `ƒ`; three
  must NOT appear in shared/server chunks — it's `/plan`-only client JS), then browser:
  mannequin renders + idle-rotates, drag rotates (vertical swipe still scrolls), tap on
  chest/head/waist/legs switches the editor card, tint follows selection.
- [ ] Commit `feat(plan): three.js mannequin island — scene core (refs #5)`.

---

### Task 6: figure overlay — chips move in, leader lines, height rule, pill

**Files:** modify `app/plan/figure-canvas.tsx`, `app/plan/profile-section.tsx`;
append `chip`/`leaders`/`dim` styles (design lines 100–134, 166–174).

**Interfaces:**
- Consumes: Task 5's scene internals (anchors/markers, camera, render loop).
- Produces: the full island per design — chips (now inside the island wrapper, values via
  props `chipValues: { head: string; chest: string; waist: string; legs: string }` and
  `heightLabel: string`), per-frame projected dotted leader lines + pins with away-fade
  (design lines 952–1003: static chip measurement cached, remeasured on resize),
  `onSelectRegion` from chip taps, photos pill + note (moves in from the placeholder),
  active-chip accent state from `selectedRegion`.
- Fallback contract (D5): when WebGL failed, chips/pill/height-rule still render and work;
  leaders SVG stays hidden.

- [ ] Implement; delete the Task-4 placeholder rail from `profile-section.tsx` (chip
  markup now lives in the island; selection state stays lifted in `ProfileSection`).
- [ ] Verify in browser at 440px: leaders track the body during idle rotation and drag,
  pins/lines fade when their region faces away, chip tap + body tap both switch cards,
  chip values update after a profile save (edit weight → save → chip shows new value),
  pill toggles the note, reduced-motion (emulate via devtools) stops idle spin, kill
  WebGL (devtools → rendering → emulate `webgl` off or block the chunk) → text fallback
  with working chips.
- [ ] `npx tsc --noEmit` + `npm test` → commit `feat(plan): figure overlay — chips, leader lines, height rule, photos pill (refs #5)`.

---

### Task 7: macros-dim + live totals in `MealPlanEditor` (independent — may run parallel to Tasks 1–6)

**Files:** modify `app/plan/meal-plan-editor.tsx`; tiny CSS addition if needed
(opacity transition on the macro spans, design line 699 behavior).

- [ ] Implement per D4: capture `baselineMealKcal` at `beginEdit` (Σ `q × unitKcal` over
  the original items), derive `pendingMealKcal` from `items` state each render, strip kcal
  shows `Math.round(plan.totals.kcal − baseline + pending)`, macro spans get a dimmed
  class (opacity 0.35, ~150ms transition) when `pending !== baseline`; cancel/save
  restores automatically (state clears + `router.refresh()`). Editing-meal header kcal
  also goes live (design keeps `815 kcal` current while stepping).
- [ ] Verify: `npx tsc --noEmit`; browser: open a meal edit → step a quantity → strip kcal
  moves + macros dim; set quantity back → undims; cancel → server totals restored;
  save (just-today) → refreshed totals, no dim. `npm test` still green.
- [ ] Commit `fix(plan): live pending totals + macros dim while a meal edit is open (refs #5)`.

---

### Task 8: integration review wave (Fable, not a worker)

- [ ] Full gates: `npm test`, `npx tsc --noEmit`, `npm run build` → `/plan` is `ƒ`.
- [ ] Browser pass at 440px covering the spec's verification list (rotate, tap each
  region, save each card, chart hover, meal edit dim, pill note, reduced-motion, WebGL-off
  fallback) + code review of the diff (esp. figure disposal/StrictMode and bundle split).
- [ ] Comment on issue #6: the weight chart now exists on /plan (spec says resolve #6's
  scope when built) — owner decides what remains of #6.
- [ ] Update STATE.md "Now" (Phase 2 built, pending owner review; still NOT deployed).
  HISTORY.md entry and issue closure wait for owner acceptance per AGENTS.md.

---

## Improvisation zones (expect drift here; posture: conservative + log it)

- **RAIL_SHIFT/camera framing at odd widths** — port −34 as-is; if chips overlap the body
  below 380px, adjust the shift/chip width minimally and note it in the task report.
- **Dense daily weigh-ins** — crosshair snapping and point dots may crowd; if >~40 points,
  drop per-point dots (keep path + latest) rather than redesigning; log it.
- **three.js version drift** — if `three@^0.185` isn't installable or OrbitControls import
  path moved, pin the nearest working minor and note the exact version in the commit.
- **StrictMode double-mount artifacts** (double canvas, WebGL context loss) — the cleanup
  contract in D5 is the fix; if contexts still leak, gate init with a ref and log it.
- **Chart y-domain edge cases** (all identical weights, goal far below) — clamp padding so
  the line never sits on an edge; tests in Task 2 pin the chosen behavior.

## Verification (phase gate)

`npm test` green · `npx tsc --noEmit` clean · build route table `/plan` = `ƒ` · browser
pass per Task 8 · then the owner's phone pass: rotate the figure, tap each region, edit
each card, hover the trend chart, stepper-edit a meal and watch the macros dim. Deploy
only on owner go (explicitly out of scope here).
