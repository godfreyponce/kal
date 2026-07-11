# Plan screen (#5) — approved design ("Figure" direction)

*Owner-approved 2026-07-11 after three mockup rounds: `design/plan-variants.html` (A/B/C
exploration) → two theories (`plan-atlas.html`, `plan-figure.html`) → owner picked **Figure**
and approved its revision. `plan-figure.html` is the visual source of truth; Atlas is kept as
the explored alternative (its SVG plate remains the designated no-WebGL fallback and a
possible later "photo mode").*

## What it is

`/plan` — the first editing UI for the three data sources every screen reads but nothing can
change: the **profile**, the **meal-plan template**, and Kal's **memory facts**. One scrolling
screen, three sections, linked from the Today header (`chat-link` pill) with a `‹ Today` back
link. Light mode, existing tokens/fonts, mobile-first 440px. No interpunct (·) separators
anywhere — stacked or spaced text instead.

## Section 1 — Profile: interactive 3D figure

- **three.js island** (~92 KB gzip: core + OrbitControls), `'use client'` +
  `next/dynamic({ ssr: false })`, loaded only on `/plan`. Import map in mock; npm dep in prod.
- Body = procedural **drawing-mannequin** (capsule/sphere primitives, ball joints, clay
  material, soft hemisphere+key light, blob shadow). No model asset. Named meshes per region.
- Idle Y-rotation (pauses while dragging; disabled under `prefers-reduced-motion`). Drag to
  rotate only — `touch-action: pan-y` so vertical swipes scroll the page. Raycast tap → region.
- **Regions → editors**: head = age/sex · chest = weight & goal · waist = body fat & height ·
  legs = activity. Fixed callout chips on a left rail, connected by per-frame projected dotted
  leader lines + pins (SVG overlay; away-facing pins fade). Height dimension rule on the right.
- Editor card below the canvas switches per region. `PATCH /api/profile` (new `lib/profile.ts`).
- **Weight editor**: current weight + goal weight (**no goal date** — owner dropped deadlines;
  leave `profile.goal_date` column in place but stop reading/writing it) + **trend chart**:
  inline SVG line chart of `weigh_ins` (existing table), goal as dashed reference line, hover
  crosshair snapping to nearest weigh-in, recent-log rows with deltas. Overlaps issue #6's
  weight chart — resolve #6 scope when built.
- **"Use my photos" (production phase 3)**: owner sends 2–4 photos → one-off image-to-3D
  generator trial → GLB hosted on **Vercel Blob (private, never committed — repo is public)**
  → GLTFLoader swap-in; hotspot anchors re-positioned; mannequin stays as fallback/stand-in.
- WebGL/module failure → visible text fallback (mock) / SVG Atlas plate (prod ambition).

## Section 2 — Meal plan: editorial list + form-swap editing

- Meals as **sections with hairline rules** (not cards): serif name + time-hint + kcal
  subtotal + Edit button. Food rows: 48 px rounded thumb (`foods.image_url`, category-tinted
  bg, `mix-blend-mode: multiply` for packshots), name + per-unit metaline, amount stacked over
  kcal on the right.
- **Totals strip** ("PLAN 3603 KCAL · P/C/F") above; macros dim while an edit is pending.
- **Editing a meal** swaps its section into edit mode: hybrid steppers (− qty +, tap-to-type),
  per-row remove ×, "+ add item from groceries" picker, and a **"not in groceries? ask kal in
  chat →" hand-off** (chat `add_grocery` already exists).
- **Scope choice on save** — the owner's traveling case: segmented **"Just today / Every day"**.
  - *Just today* (default): writes `meal_overrides` for the date — the SAME engine as chat's
    ⇄ deviation feature (`lib/overrides.ts setMealOverride`); template untouched; auto-reverts.
  - *Every day*: mutates `meals`/`meal_items` (new REST routes + lib helpers) and the server
    **re-derives `profile.target*` from the new plan** (`computeTargets` logic over live data —
    targets always derive from the plan, never hand-picked). Recalc surfaced as an
    old → new banner ("3603 → 3663 kcal") with a reason line.
- Add/remove whole meals (every-day scope); `meal_items.food_id` FK is restrict — surface
  409s like the Groceries DELETE does.

## Section 3 — Memory: notebook list

- Facts as serif sentences + mono provenance metaline ("from chat jun 30" / "you added jul 08")
  + muted category dot. Count in the section header.
- Always-visible quiet ×; delete is immediate with a 5s **undo snackbar** (no confirm modal).
  "Clear all memory" at the bottom, same undo path. Ghost row "+ tell kal something".
- New REST: `GET/POST/PATCH/DELETE /api/memory-facts` (`lib/memory.ts`); chat's
  `add_memory_fact` keeps writing the same table.

## Build order (production)

1. **Core screen**: lib helpers + REST routes (profile, meals/meal-items with target
   re-derivation + override save path, memory-facts) with vitest integration tests;
   `/plan` page (`force-dynamic`, server loader + client sections); nav links; meals +
   memory + plain profile form first.
2. **Figure**: three.js mannequin island with regions/chips/editors + weight trend chart.
3. **Your model**: photo → GLB trial, private Blob hosting, swap-in.

Each phase is separately shippable; owner reviews between phases.

## Out of scope

Grocery/foods CRUD (exists), chat behavior changes, Trends screen beyond the weight chart
overlap noted above, dark mode, calendar view of weigh-ins (graph + log chosen).

## Verification

`npm test` green (new integration tests for routes/target re-derivation), `npx tsc --noEmit`
clean, build route table shows `/plan` as `ƒ`, then phone pass: edit each profile region,
stepper-edit a meal both scopes (⇄ appears on Today for just-today; targets banner for
every-day), delete/undo a memory fact, rotate the figure, hover the trend chart.
