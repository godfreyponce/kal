# Groceries "my serving" display — design

**Date:** 2026-07-07 · **Status:** approved by owner (mockup + design sections)
**Mockup (owner-approved):** `design/groceries-serving-display.html` (open in a browser;
logos in `design/logos/`)

## Problem

Grocery cards show macros for the food's storage basis (per 100 g for weighed foods, per
1 unit for count foods). The owner thinks in *their* serving — "6 oz cooked chicken" — so a
card reading `165 kcal / 100g` forces mental math and is inconsistent with how every other
surface (Today popup, chat plan lines) presents resolved amounts.

## What changes (owner-visible)

1. Each card shows macros scaled to the owner's own serving, oz-first for weighed foods:
   `Chicken breast · Walmart-logo · 6 oz (170 g) cooked → 281 kcal, 52.7P, 6.1F`.
2. The serving amount is tappable (dotted underline) when a flip applies:
   - **Cooked↔raw flip** — gram-based foods with a stored `raw_to_cooked_yield`
     (chicken, rice). `6 oz (170 g) cooked ↔ 8 oz (227 g) uncooked`. Same food, so
     **macros do not change**; the raw side is what to weigh before cooking.
   - **1-unit flip** — count foods with display qty > 1 (peanut butter only, today).
     `2 tbsp (190 kcal) ↔ 1 tbsp (95 kcal)` — **macros scale with the amount**.
   - No flip otherwise (veg, peanuts, eggs, bread, oil, banana).
3. The store word in the subtitle becomes the store's logo (Walmart spark+wordmark,
   Costco Wholesale), from `foods.store`. This ABSORBS the "store badge" requirement
   previously parked for the Groceries design rework.
4. `Egg, large` is renamed **`Large Eggs`** (real DB rename, owner's wording). Card titles
   also strip a trailing `", cooked"` display-only — the amount already says cooked
   (same rule as the Today popup, 2026-07-06).
5. `$/srv` in the card foot reflects the displayed serving (chicken cost × 1.7). It does
   not change when a toggle is flipped.

## Decisions + rationale

- **Approach A: `display_qty` multiplier column** (owner-approved). One nullable numeric
  on `foods`; a multiplier of the existing serving basis — the same convention as
  `meal_items.quantity`. Feeds the existing `resolveItem(quantity, food)` unchanged.
  Rejected: `display_grams` (dual semantics for count foods), rebasing the serving basis
  (breaks the per-100 g invariant from the 2026-07-02 unit-resolution fix).
- **Invariant preserved:** macros are always computed by `resolveItem` — never hand-scaled.
- **Units: oz (g) together, oz first** (owner-approved) — "6 oz (170 g)". Count foods keep
  natural units ("2 tbsp", "1 egg").
- **Groceries screen only.** Today, popup, chat tools, and the system prompt are untouched;
  `display_qty` is display-only and never feeds `computeTargets()` or plan lines.

## Data

- **Migration `0004`:** `foods.display_qty numeric(8,3)` NULL. Null ⇒ 1.
- **Pre-fill (live Neon, surgical script — no wipe, apply-seed-v2 pattern):**

  | Food | display_qty | Card shows |
  |---|---|---|
  | Chicken breast, cooked | 1.7 | 6 oz (170 g) cooked ↔ 8 oz (227 g) uncooked |
  | White rice, cooked | 4 | 14 oz (400 g) cooked ↔ 4.5 oz (133 g) uncooked |
  | Frozen mixed vegetables, cooked | 2.5 | 9 oz (250 g) |
  | Dry-roasted peanuts, salted | 0.4 | 1.5 oz (40 g) |
  | Peanut butter | 2 | 2 tbsp ↔ 1 tbsp |
  | Large Eggs / bread / oil / banana | null | 1 egg / 1 slice / 1 tbsp / 1 banana |

- Same script renames `Egg, large` → `Large Eggs`.
- **`db/seed-data.ts` updated to match** (display qtys + the eggs rename, including any
  by-name meal-item references to eggs) so reset/re-apply paths preserve this. Targets are
  unaffected.

## Library

- `lib/groceries.ts`: `GroceryView` gains `displayQty` (number, default 1), `servingDesc`,
  and `rawToCookedYield` (the card needs the basis + yield to render/flip).
  `createGrocery`/`updateGrocery` accept `displayQty`.
- **New pure helper** (TDD; in `lib/`, importable by the client component like
  `lib/units.ts` is): takes the food view and returns the card display —
  `{ label, flipLabel | null, flipKind: "raw" | "unit" | null, macros }`:
  - weighed food (`servingDesc` in grams): oz-first label; `flipKind: "raw"` iff
    `rawToCookedYield` set (flip label from `displayGrams / yield`, macros unchanged);
  - count food: `"<qty> <unit>"`; `flipKind: "unit"` iff qty > 1 (flip = 1 unit,
    macros from `resolveItem(1, food)`);
  - macros via `resolveItem(displayQty, food)`; oz rounding via the existing 0.5-oz hint.
  - title helper strips trailing `", cooked"` (display-only).

## UI (`app/groceries/groceries-list.tsx` + `globals.css`)

- Subtitle meta row: store logo (or plain text fallback), then the serving button
  (`.gcard-srv`, dotted underline when flippable; plain text when static). The old
  `100g` / `no weight` text is gone.
- Logos: `public/stores/walmart.svg`, `public/stores/costco.svg` (move from
  `design/logos/`). Matched from `foods.store` case-insensitively ("walmart", "costco");
  anything else renders as text like today. `<img>` ~11 px tall (13 px Costco), `alt` =
  store name.
- kcal, bar numbers, and `$/srv` render at the displayed serving. Bar *widths* are
  ratio-based and identical at any qty (only numbers change on the PB flip).
- Flip state is ephemeral client state per card (resets on re-render/refresh).

## Edit form + REST

- Form gains "My serving": weighed foods → number + g/oz select, converted on save to
  `displayQty = toGrams(value, unit) / servingGrams`; count foods → plain number labeled
  with the basis unit (from `parseServing(servingDesc).unit`).
- `GET /api/groceries` returns `displayQty`; `POST`/`PATCH` accept it (reject ≤ 0 with 400).

## Out of scope

- The full Groceries design rework (backlog #1) — this is a targeted consistency patch;
  the rework note should drop its store-badge line (absorbed here).
- Flips for weighed no-yield foods (veg → 100 g etc.) — not asked for.
- Inventory decrement, `is_estimated` surfacing, chat/tool changes.

## Testing / verification

1. TDD the new display helper: oz-first label, raw flip (macros equal), unit flip
   (macros scale), static cases, qty-null ⇒ 1, title strip.
2. `lib/groceries` round-trip test: `displayQty` through create/update/list.
3. `npx tsc --noEmit` clean; full vitest suite green (48/48 + new).
4. Live: dev server on :3100 — cards match the approved mockup against real data
   (including logo fallback for a food with no/unknown store); REST PATCH `displayQty`
   exercised via curl; flip both toggle kinds in the browser.
5. Owner verifies on the phone after deploy.
