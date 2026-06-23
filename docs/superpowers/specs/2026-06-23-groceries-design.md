# Groceries — Design Spec

*Date: 2026-06-23 · Status: approved, pre-implementation*

## Problem

Kal logs food, but macros for ad-hoc foods are estimated/free-form, which makes the
day's numbers untrustworthy. The owner wants a curated **Groceries** list — the real
items they buy, each with accurate label nutrition plus metadata — to be the **single
source of truth** for macros. In chat, the owner logs by **weight** ("8 oz uncooked
chicken") and Kal pulls macros only from that list, never guessing.

## Goals

1. A **Groceries screen** to add/edit/delete the items the owner buys, with accurate
   per-serving nutrition + metadata (brand, store, link, price, package weight).
2. **Weight-based logging** in chat (oz/g) against grocery items.
3. A **source-of-truth chat rule**: Kal never silently estimates. Off-list foods → Kal
   asks for the brand + label facts, saves the item to Groceries, then logs by weight.
4. Support **supplementary foods** (cooking oil, seasoning) as regular grocery items so
   cooking fat actually counts.

## Non-goals (explicitly deferred)

- **Inventory / "how much I have left."** `purchase_weight` is a recorded attribute the
  owner updates when re-buying; logging does **not** auto-decrement it.
- **Barcode / QR auto-fill.** The add form is the future home for a "scan" button, but
  scanning is not built now. Off-list capture is manual (owner reads the label to Kal).
- Migrating the meal plan to a weight basis. The plan, Today, and mark-eaten stay
  per-serving and untouched.

## Approach (chosen: A — extend `foods`)

"Groceries" IS the existing `foods` library, surfaced as a management screen and enriched.
Macros stay stored **per serving**; weight logging is pure conversion. This keeps the
proven snapshot machinery and leaves the meal plan / Today / mark-eaten untouched. The
owner never sees "servings" — the form takes what's on the label (serving size in grams +
macros), and chat always speaks weight.

Rejected: per-100g everywhere (ripples into meal-plan quantity semantics); a separate
`groceries` table (two parallel food libraries, chat must search both).

## Data model — new columns on `foods`

All nullable except `is_estimated`. No other table changes.

| Column            | Type             | Notes                                                        |
|-------------------|------------------|-------------------------------------------------------------|
| `store`           | text             | Where bought, e.g. "Walmart".                               |
| `link`            | text             | Optional product/label URL.                                 |
| `serving_grams`   | numeric(8,2)     | Grams in one serving — the weight basis for logging.        |
| `is_estimated`    | boolean NOT NULL default `false` | Provenance: `false` = off a real label.         |
| `purchase_weight` | numeric(8,2)     | Package weight bought, stored in **grams**. Recorded only.  |
| `price`           | numeric(8,2)     | What the owner paid (USD). Recorded only.                   |
| `category`        | text             | Optional tag for grouping on the screen (protein/oil/etc.). |

Existing macros (`kcal`, `protein_g`, `carbs_g`, `fat_g`) remain **per serving**. The 9
seeded foods get `serving_grams = null` and keep working by-serving; the owner fills a
weight in when they re-buy. No backfill.

**Units.** Canonical storage is grams. Conversion constant `1 oz = 28.3495 g`,
`1 lb = 453.592 g`. Forms accept g/oz (serving) and lb/oz/g (purchase weight) and convert
to grams on save. Chat echoes back the unit the owner spoke.

**Derived (display only).** Cost per 100 g and cost per serving from `price` +
`purchase_weight` / `serving_grams`. Not stored.

## Weight → macros conversion

`grams = oz × 28.3495` (or as given) → `servings = grams ÷ serving_grams` →
`macros = per_serving_macros × servings`, then snapshotted into `log_entries` exactly like
today (`quantity` stores the computed servings; absolute macros are snapshotted). If a
weight is given for a food with `serving_grams = null`, logging returns an error asking the
owner to set the serving weight first (Kal then asks and updates it).

## Chat behavior

### New tool: `add_grocery`
Inputs: `name`, `brand?`, `store?`, `link?`, `category?`, `serving_grams` (required),
per-serving `kcal`/`protein_g`/`carbs_g`/`fat_g`, `purchase_weight_g?`, `price?`.
Saves to the library with `is_estimated = false`. Returns the new id + a tool card.

### `log_food` — extended
Add `oz` and `grams` inputs. Resolution: `oz` → grams; with a weight + a food that has
`serving_grams`, convert to servings and log; otherwise fall back to the existing
`quantity` (servings) path. The tool card shows the weight the owner said
("Chicken · 8 oz · 227 kcal · 42P · 0C · 5F").

### `search_foods` — unchanged
Used to find the grocery before logging.

### System-prompt rules (added to `assembleSystemPrompt`)
- To log a food, **search the grocery library** and log by the weight the owner gives.
- **Never invent macros.** If the food isn't in the list, ask for the **brand** and the
  **label's nutrition facts** (serving size in grams + kcal/protein/carbs/fat), then call
  `add_grocery` to save it (source of truth), then `log_food` by weight.
- Cooking additions (oil, seasoning) are grocery items too — log them alongside the main
  food so cooking fat counts.
- Photo/QR auto-fill is a future capability; for now capture label facts via chat.

## Groceries screen (`/groceries`)

- `app/groceries/page.tsx` — server component, **`export const dynamic = "force-dynamic"`**
  (reads live DB; per the known prerender gotcha — build route table must show `ƒ`).
  Reads `listGroceries()` directly for first paint.
- `app/groceries/groceries-list.tsx` (client) — lists items (optionally grouped by
  `category`), each showing name, brand, store, serving size, per-serving macros, and
  derived cost/serving. Add/edit/delete via a form: name, brand, store, link, category,
  serving size (number + g/oz), the four macros, purchase weight (number + lb/oz/g), price.
  Optimistic update + `router.refresh()`, matching the Today/Chat patterns.
- **Nav:** a "Groceries" link on the Today header next to "Chat →".
- **Delete guard:** `foods` is FK-referenced by `meal_items` (restrict) and `log_entries`
  (restrict). Deleting a referenced food fails at the DB; the API returns a clear error and
  the UI shows "in use" instead of a crash.
- Style: warm-monochrome minimalist, matching existing `globals.css`. The add form leaves
  visual room for a future "scan barcode" button (not built).

## REST + lib

- `lib/groceries.ts`: `listGroceries()`, `createGrocery(input)`, `updateGrocery(id, input)`,
  `deleteGrocery(id)`, plus a small units helper (`ozToGrams`, `lbToGrams`,
  `weightToServings`). The chat tools reuse the same lib.
- `GET /api/groceries` — list. `POST /api/groceries` — create.
- `PATCH /api/groceries/[id]` — update. `DELETE /api/groceries/[id]` — delete (returns a
  clean error when the food is referenced).
- The client screen mutates only through these routes (swappable-brain rule); the server
  page reads the lib directly for initial paint, same as Today.

## Testing (TDD, live DB, own sentinel dates)

- **Units/conversion** (`lib/groceries.test.ts` or `lib/units.test.ts`): oz→g, lb→g, and
  weight→servings→per-serving-macros math is correct.
- **`add_grocery`**: inserts a food with `serving_grams` set and `is_estimated = false`.
- **`log_food` by weight**: snapshots the correct absolute macros for a known
  `serving_grams` food on a sentinel date; reverts the test state.
- `npx tsc --noEmit` stays clean; `npm test` green.

## Out-of-scope follow-ups (note for STATE backlog)

- Barcode/QR photo auto-fill of the grocery form.
- Inventory decrement + low-stock from `purchase_weight`.
- Cost analytics (cost per day / per meal) beyond the per-item display figure.
