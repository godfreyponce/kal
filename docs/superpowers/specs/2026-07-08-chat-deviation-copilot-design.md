# Chat Deviation Copilot — Design

**Date:** 2026-07-08 · **Status:** owner-approved design (this doc is the spec)

## Problem

The chat's core purpose is handling *deviation days*: the owner is traveling, didn't prep,
or is eating out, and wants to converse with Kal about what to eat instead while still
hitting the day's targets. Today the model knows only the ~9 library foods, the rules
forbid it from guessing macros for anything else, and it has no way to reflect a deviation
in the app. The feature must stay cheap to run.

## Decisions (made with the owner, 2026-07-07/08)

1. **Scope = B + C1.** Kal advises on substitutions, logs what was actually eaten, and may
   adapt **today's plan only** (a day-scoped overlay). The recurring meal template is
   NEVER modified from chat (template editing belongs to the future Plan screen).
2. **Knowledge ladder** for off-plan foods: database lookup → owner-provided source
   (link or photo) → clearly-flagged estimate confirmed by the owner. Never silent guessing.
3. **Model stays Haiku** (`ANTHROPIC_MODEL` default). Sonnet remains a one-line env change
   if advice quality disappoints. **Prompt caching** is part of this feature (was backlog #2).
4. **No memory overhaul.** `memory_facts` + `add_memory_fact` already cover "remember my
   go-to travel swap"; a prompt rule nudges Kal to save repeated substitutions as facts.
5. **Parked:** grocery spend tracking (owner idea, separate future brainstorm — needs a
   purchases-over-time model; `foods.price` alone can't answer "what did I spend this week").

## The knowledge ladder (system-prompt rules + tools)

When the owner asks about a food that isn't in the library, Kal must climb in order:

**Rung 1 — `search_nutrition` (new tool).** Wraps `searchNutrition(q)` from
`lib/nutrition-lookup.ts` (USDA FDC + OpenFoodFacts, merged, source-tagged, capped 8).
Real label data wins; strong on packaged/US-brand foods, patchy on restaurant food.

**Rung 2 — ask the owner for a source.** Before estimating, Kal asks for a menu/nutrition
link or a label/menu photo:
- **`fetch_page` (new tool).** Fetches an owner-pasted URL server-side, strips HTML to
  text, caps length (~20k chars), returns it for Kal to read macros from. Best-effort:
  bot-walled sites (Walmart/Amazon/Target — proven 2026-06-26) return an honest error and
  Kal says so. http/https only; private/localhost addresses rejected.
- **Photo in chat** (own phase, cut-able — see below): the owner attaches a photo of a
  nutrition label, menu board, or plate; Haiku reads it natively in the user turn.

**Rung 3 — flagged estimate (last resort).** Only after rungs 1–2 fail or the owner has
nothing to offer. Kal must state its assumed portion and macros out loud, get an explicit
yes, and anything saved carries `is_estimated=true`. The existing never-invent-a-serving
rule stays **absolute for plan/library foods** — estimation is allowed only in this
off-plan lane, and never silently.

## Schema changes (migration 0005)

- **`meal_overrides` (new table)** — today-only plan adaptation. Mirrors `meal_items`:
  `id, date, meal_id → meals, food_id → foods (restrict), quantity numeric(8,3),
  write_batch_id uuid, created_at`. An override row set for `(date, meal_id)` replaces
  that meal's template items **for that date only**; no rows = template applies.
  Nothing to clean up at day rollover.
- **`foods.one_off boolean NOT NULL DEFAULT false`** — off-plan foods captured by chat
  (e.g. "Chipotle bowl, estimated") must live in `foods` so macros resolve through
  `resolveItem`, but they are not groceries. `one_off=true` hides them from the Groceries
  screen (`listGroceries`/`getGroceryGroups` filter) so the curated library stays clean.

## New/changed chat tools (`lib/tools.ts`)

- **`search_nutrition(query)`** → rung 1 (above).
- **`fetch_page(url)`** → rung 2 (above).
- **`override_meal(meal_id, items[], date?)`** — items are `{food_id, quantity}` pairs,
  where `quantity` is a multiplier of the food's serving basis (same convention as
  `meal_items.quantity`; for per-100 g foods, 1.7 = 170 g). Foods must already exist;
  off-plan foods are added first via the `log_food` new-food path or `add_grocery`. Replaces the full item list for `(date, meal_id)`: deletes any
  prior override rows for that pair, inserts the new ones under a fresh `write_batch_id`.
  Partial swaps are expressed by including the kept template items in the list. Returns a
  resolved-line summary (via `resolveItem`) + `write_batch_id` for the Undo card.
- **`log_food`** new-food path gains optional `is_estimated` (default false) and `one_off`
  (default false). Prompt rules direct the model to set both `true` for restaurant/
  estimated one-offs; `add_grocery` (real groceries) is unchanged, always `one_off=false`.
- **`revertWriteBatch` (lib/undo.ts)** additionally deletes `meal_overrides` rows carrying
  the batch id, so the chat Undo card reverts an adaptation like any other write.
  (Undoing an *older* batch after a re-override only removes its own rows — acceptable;
  last-write-wins is the rule.)

## Today screen behavior (C1)

- **`getTodayView`/`lib/today.ts`**: for each meal, if override rows exist for
  `(date, meal_id)`, resolve *those* items (same `resolveItem` path) instead of the
  template's; `plannedKcal`, the meal popup items, and the stat strips all flow from the
  same swapped list automatically. The meal gains `adjusted: true`.
- **`setMealStatus('eaten')` fill-the-gaps** logs the override items, not the template's,
  for an adjusted meal. No status-lifecycle change: the "adjusted" marker derives from
  override existence, statuses keep meaning what they mean. (`'substituted'` stays unused.)
- **UI**: an adjusted meal row shows a subtle marker (e.g. small "adjusted" tag); the
  popup shows the override items. Visual treatment gets one focused mockup round for owner
  approval before building (small mod to an existing screen, not a net-new screen).
- Targets are untouched on deviation days: goals stay, food changes.

## Prompt caching (`lib/anthropic.ts`, `lib/system-prompt.ts`, chat route)

Caching pays only for stable prefixes, so the system prompt splits into two blocks:

1. **Static block** (cache breakpoint): persona, all rules, profile + targets, the meal
   plan *template* lines (date-independent), memory facts. Invalidated only by a
   memory-fact write (overrides render in the dynamic block, so adapting a meal does
   NOT bust the cache) — one re-write, then cached again.
2. **Dynamic block** (never cached): today's date, consumed/remaining, per-meal status,
   today's adjusted-meal lines (when overrides exist), recent weight.

Plus a **rolling cache breakpoint on the last conversation message**, so multi-turn tool
loops (which replay the whole history every iteration) reuse it incrementally. Tools are
part of the cached prefix.

Expected effect: repeat turns ~10× cheaper; a full deviation conversation well under a
cent on Haiku. **Verification:** the chat cost meter already surfaces `usage` —
`cache_read_input_tokens > 0` must show from the second turn of a session.

## Photos in chat (own phase, cut-able)

Composer gets an image-attach button; the client downscales to ≤1024px (same as the
Groceries label flow) and sends base64 in the POST body; the route builds the user turn
as `[{image}, {text}]` content blocks (persisted as-is to `chat_messages.content` jsonb).
Haiku reads labels/menus natively (~1–1.6k tokens per image — pennies). UI change gets a
focused mockup round. If schedule pressure appears, this phase ships after the rest.

## Error handling

- `fetch_page` blocked/timeout/non-HTML → tool returns an explicit error string; prompt
  rule: relay the failure honestly and climb to rung 3 — never fabricate page content.
- `search_nutrition` empty → say so, climb to rung 2.
- Estimate without owner confirmation → prompt rule forbids logging/overriding until the
  owner explicitly confirms the stated portion.
- `override_meal` with unknown `food_id` or empty items → tool error, nothing written.

## Testing (TDD, per project convention)

- `lib/overrides.ts` (or extension of `lib/today.ts`/`lib/meal-status.ts`): integration
  tests against live Neon with a **fresh sentinel date** (e.g. 2099-05-05 — vitest files
  run in parallel; never reuse another file's sentinel). Cover: override replaces items in
  `getTodayView`, fill-the-gaps logs override items, re-override replaces, undo reverts.
- `fetch_page`: pure HTML→text extraction unit-tested; network path smoke-tested manually.
- `search_nutrition`: `lib/nutrition-lookup.ts` is already tested; add a tool-wiring test
  (pattern: `tools-groceries.test.ts`).
- Groceries `one_off` filter: extend `lib/groceries.test.ts`.
- Caching: manual verification via the cost meter (cacheRead > 0 turn 2+); no integration
  test (would burn real tokens for little signal).
- `tsc --noEmit` clean; full suite green (currently 56/56).

## Explicitly NOT doing

- Template editing from chat (future Plan screen).
- New memory subsystem or model upgrade.
- Auto-ingesting links without the owner pasting them; scraping bot-walled retailers.
- Grocery spend tracking (parked as its own backlog item).
- Inventory decrement (separate backlog item, unchanged).

## Suggested build order (for the implementation plan)

1. Schema: `meal_overrides` + `foods.one_off` (migration 0005) + Groceries filter.
2. Rung-1/2 tools: `search_nutrition`, `fetch_page` + ladder rules in the system prompt.
3. C1: `override_meal` + `getTodayView` merge + fill-the-gaps + undo extension.
4. Prompt caching restructure.
5. UI: Today adjusted marker (mockup → build), chat photo attach (mockup → build; cut-able).
