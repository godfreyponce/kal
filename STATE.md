# Kal — Project State

Personal, single-user fitness chat PWA (formerly "MacroChat"). A Claude-powered assistant
that knows the owner's profile, meal plan, and daily log, and reads/writes that log via
server-side tools. Frontend talks only to `POST /api/chat` + REST routes (swappable brain).

**Full build plan/spec:** `~/.claude/plans/okay-so-i-have-zesty-nova.md` (the source of truth;
this file is the quick-resume summary).

---

## ⏩ NEW AGENT — START HERE

*Last updated: 2026-07-06 (later session) · Popup per-food stats RESTYLED to the E3 open-column
strip + popup polish (hint/", cooked") + Today's "tap meal for details" hint removed (0d043fb) —
all owner-accepted, committed, and **DEPLOYED to prod** (`kal-l92p7c8jf` READY, aliased to
kal-delta.vercel.app; unauth 307→login, no runtime errors). Prod, `main`, and live Neon are all
in sync. No deploy pending.*

**✅ Prod is current (verified 2026-07-06):** deployment `kal-4aabw2v1t` READY, aliased to
kal-delta.vercel.app; unauth `/` → 307 /login, login 200; no runtime errors in fresh logs.
NB: only smoke-checked unauthenticated routes (prod password is encrypted/write-only) — owner
verifies the popup + chat on the phone.
- ⚠️ `npm run db:seed` is a FULL WIPE (logs, statuses, ALL foods incl. owner-added + photos). To
  update live data in place use `npx tsx db/apply-seed-v2.ts` (idempotent, preserves everything).
- `db/seed.ts`'s PROFILE block was hand-edited by the owner (175 cm / 170 lb / 30yo / goal 160 by
  2027-01-01) — that's the reset-path profile only; the **live profile row was NOT changed** (still
  the old body stats; only targets were updated). Reconcile with the owner before touching it.

**✅ Today meal-detail popup — DONE 2026-07-06, owner-accepted** (was the 2026-07-02 next task).
Full section below. Owner's standing note stands for future work: don't compromise simplicity
for structure/maintainability.

**What's done:** Phases 1–5 all complete. v1 is **live and deployed**:
**https://kal-delta.vercel.app** (Vercel project `kal`, team godfreyps-projects).
Today screen (rings + macro bars + meal checklist + Sunday weigh-in), Chat (streaming
tool-loop, tool cards w/ Undo, model+cost tracker), password gate (iron-session),
installable PWA. Stack & locked design decisions are below; per-phase detail is the
archive further down.

**✅ Groceries v2 is now COMMITTED (`346f203`), MERGED to `main` (fast-forward), and DEPLOYED
to prod (https://kal-delta.vercel.app, aliased 2026-06-29).** `groceries` branch == `main`.
The owner does NOT like the v2 design yet — it was shipped to let them try the
**snap-the-Nutrition-Facts-label → auto-fill macros** flow on their phone. Design rework is a
later pass (owner: get the whole thing working first). Full v2 detail in the **Groceries**
section below; original spec/plan in `docs/superpowers/{specs,plans}/2026-06-23-groceries-*`.

**Prod env status for v2 (verified 2026-06-29 via `vercel env ls production`):**
- `ANTHROPIC_API_KEY` present → **label-photo vision works in prod** (`/api/nutrition/vision`
  returns 401 unauth = route live + gated; in-app call carries the session cookie).
- `BLOB_STORE_ID` present (Prod+Preview) → product-photo upload should work via OIDC (not yet
  exercised live in prod).
- **`FDC_API_KEY` is MISSING from prod** → typing a food *name* to search nutrition DB returns
  only OpenFoodFacts (USDA half silently no-ops). Add it to Prod env to enable USDA name-search.
  Does NOT affect the label-photo flow.

**⚠️ Demo data NOT reverted:** to test/demo v2 this session I edited live Neon data — assigned
`category` to all 9 seeded foods (chicken→protein, canola/peanut butter→fat, rice/bread→carb,
banana→fruit, mixed veg→veg) and set `Dry-roasted peanuts`' `image_url` to a Walmart photo.
Owner hasn't decided keep-vs-revert. (The seed macros are still the original ESTIMATES, not
real labels — see the data-provenance note in the Groceries section.)

**Local env (`.env.local`, git-ignored):** `APP_PASSWORD=devpass` (prod value is encrypted/
write-only; a `vercel env pull` blanks it — NEVER pull into `.env.local`, pull to a temp file
and copy individual keys). Also set this session: `FDC_API_KEY` (real USDA key, owner-provided),
`BLOB_READ_WRITE_TOKEN` (local-only — prod uploads use OIDC, see Groceries §photos).

**How to run / verify (do this first):**
```bash
PORT=3100 npm run dev    # :3000 is taken by another local project ("Glass"); use 3100
npm test                 # vitest 48/48 across 11 files (needs DATABASE_URL; hits live Neon)
npx tsc --noEmit         # must stay clean
```
Run the dev server backgrounded and DON'T start a duplicate (EADDRINUSE on 3100). Integration
tests hit live Neon — a transient network red can still happen (re-run before trusting it), but
the RECURRING "flake" was a real cleanup bug, fixed 2026-07-02 (see the unit-fix section). To
verify a change in the real app, exercise routes with `curl` against `localhost:3100`.
**After editing `globals.css`, Turbopack dev serves STALE CSS** — `rm -rf .next` and restart,
then hard-refresh the browser (the CSS chunk URL is unchanged so a soft refresh keeps the old
file). This cost a lot of debugging this session; route/TSX edits hot-reload fine, only CSS is cached.

**🟢 Upcoming / backlog (confirm with owner before starting anything):**
1. **Groceries v2 design rework** — owner dislikes the current v2 design (shipped to prod for the
   photo→label trial, not because the look is approved). Redo it WITH the 3-variant HTML mockup
   step first (see [[design-variants-for-new-screens]]). Leftover prod-env todos: add `FDC_API_KEY`
   to Vercel Prod (USDA name-search no-ops without it — label-photo flow unaffected); exercise the
   product-photo Blob upload live in prod to confirm OIDC. (Commit/merge/deploy: DONE 2026-06-29.)
2. **Prompt caching** on the chat system-prompt/tools prefix — ~10× cheaper repeat turns. Highest-value next.
3. **Inventory decrement** — `foods.purchase_weight` is recorded but logging does NOT subtract from it.
4. **Plan screen** — profile/meals editor + the memory-facts editor (grocery/foods CRUD exists via `/groceries`).
5. **Trends screen** — weight chart + weekly adherence (v1.5).
6. **Chat history summarization** — currently a hard 30-message cap; summarize-and-truncate later.
7. **Optimistic remaining-update after chat Undo** — card greys to "Undone"; numbers refresh next ask.
8. **Surface `is_estimated` in the Groceries UI** — column + `add_grocery` set it, screen doesn't show provenance.
9. **Correct remaining [est] food macros from real labels** — Seed v2 set honest `is_estimated`
    flags and fixed peanuts from its real label; eggs/banana/chicken/beef/rice/oil/veg are still
    estimates. Owner corrects via lookup/vision as labels come in; **re-derive profile targets after**
    (`computeTargets()` in `db/seed-data.ts` — owner rule: targets come from the food data, never
    hand-picked). (Link-scraping is impossible — bot-walls; see Groceries §provenance.)

*(Done 2026-07-02: the unit-resolution fix + Seed v2 — see section below. Done 2026-06-26:
barcode/QR auto-fill replaced by nutrition lookup + label vision + product photos — Groceries v2.)*

**⚠️ Gotchas that have bitten before:** Next 16 renamed `middleware`→`proxy` & made `params`
a Promise; `RouteContext` only exists after typegen (use explicit `params: Promise<…>`);
neon-http has no interactive txns & one HTTP round-trip per query (batch independent reads
with `Promise.all`); Haiku rejects `thinking`/`effort` params; vitest files run in parallel
so each integration test needs its OWN sentinel date. **Any page that reads live DB or the
current day MUST `export const dynamic = "force-dynamic"`** — Next 16 prerenders pages static
by default (neon queries aren't detected as dynamic), so without it the page freezes at the
build-time snapshot and `router.refresh()` just re-serves that frozen RSC (this is what made
Today show the wrong day + 0 consumed after deploy; check the build route table — `/` must be
`ƒ`, not `○`). This bug is invisible in `npm run dev` (dev never statically caches).

**📋 Maintenance protocol (REQUIRED):** After each feature is built **and the owner confirms
it's good**, update this file in the same change: bump the *Last updated* date, move the item
out of backlog, add/refresh its phase section, and adjust the roadmap. Commit STATE.md with
the feature. (This rule is also in `AGENTS.md` so it survives across sessions.)

---

## Stack

- Next.js **16** (App Router) — note: newer than the spec's "15"; read
  `node_modules/next/dist/docs/` before writing routes/UI (its `AGENTS.md` flags breaking changes).
- Neon Postgres + Drizzle ORM (driver: `@neondatabase/serverless`)
- Tailwind CSS v4, TypeScript, Vitest
- Anthropic API via `@anthropic-ai/sdk` (cheapest-capable; env `ANTHROPIC_MODEL`, default `claude-haiku-4-5`)
- iron-session password gate; deployed to Vercel project `kal` (live at kal-delta.vercel.app)

## Key v1 design decisions (locked)

1. **Mark-meal-"eaten" fills the gaps** — `set_meal_status('eaten')` auto-logs only planned
   items not already logged for `(date, meal_id)`. Never double-counts.
2. **Chat is ephemeral** — fresh `session_id` per chat open; no browsable threads. DB is the memory.
3. **Lean memory** = small editable `memory_facts` list the assistant writes to; injected per chat.
4. **`todayInAppTz()`** (America/Chicago) is the ONLY source of "today" — never raw `new Date()`.
5. **Batch-aware Undo** — write tools share a `write_batch_id`; Undo reverts the whole batch.
6. **Deferred to Phase 2:** `is_estimated` provenance flag on foods; grocery-logging section.

---

## Today meal-detail popup (2026-07-06) — COMMITTED, owner-accepted

Tap a meal row on Today → centered card (owner picked variant B) showing what the meal IS;
tap any food line inside it → a two-row per-serving table (owner picked expansion B3 from
`design/today-meal-popup-b-item-expand.html`). All amounts come from `resolveItem` — never a
bare multiplier. TDD on the data layer; suite 48/48 (11 files), `tsc` clean.

- **Data** (`lib/today.ts` +3 tests in `lib/today.test.ts`, sentinel date 2099-04-04):
  `TodayMeal` gained `items: TodayMealItem[]` — each plan item resolved (`amountLabel`,
  `rawLabel`, line-rounded kcal/P/C/F) plus a 1-serving basis (`servingLabel` + `serving`
  macros from `resolveItem(1, food)`). `plannedKcal` now sums the same line-rounded kcal, so
  meal rows and popup lines always agree.
- **UI** (`app/meal-popup.tsx` new; `app/meal-list.tsx`; `.rowbtn`/`.mpop-*` in `globals.css`):
  meal row body (name/kcal/› chevron) opens the popup; the checkbox still one-tap toggles eaten.
  Card: header row = serif title + kcal + ✕ (in-flex, can't overlap), no bottom Close (✕/scrim/
  Esc), full-width Mark-eaten/undo button sharing MealList's optimistic toggle. Item tap →
  mini-table "1 serving (100 g (3.5 oz))" vs "your 170 g (6 oz) cooked" across kcal/P/C/F.
  Last item row draws no grey border (`.last`) so the totals' dark rule sits clean.
- **Cooked-vs-raw clarity** (owner question 2026-07-06): any item with a `rawLabel` (meats,
  rice) renders its amount with a " cooked" suffix — macros are computed from the cooked
  weight; the raw ≈ line is what to weigh pre-cooking. Rice's raw ≈ 133 g line was always in
  the app (only the mockups' sample data lacked it).
- **Animation**: owner picked "Rise & sink" from `design/today-meal-popup-open-close-animations.html`
  (round 3): card drifts up 26px + fades in (0.26s), sinks + fades out (0.17s). Enter = double-rAF
  adds `.open`; close drops it and unmounts after 180ms. Pure transitions in `globals.css`.
- **⚠️ Name-collision lesson**: first cut named the row button `.mrow`, which CLOBBERED the
  Today macro-bars' existing `.mrow` (page.tsx) and broke that section — renamed to `.rowbtn`.
  Before adding a class to `globals.css`, grep it first.
- **Stats restyle (2026-07-06 later session, owner-accepted):** owner found the B3 mini-table's
  numbers hard to read. 4 mockup rounds (`design/today-meal-popup-stats-{variants,chips,oneline,
  strip}.html`: chips → stacked chips → one-line strips → strip riffs) → owner picked **E3 "no
  box"**: four open columns, tiny uppercase kicker label on top, your colored value, 1-serving
  basis beneath (`70 / egg`), hairline dividers, no background. `StatStrip` replaced
  `ServingTable` in `app/meal-popup.tsx`; `.mpop-mini` CSS swapped for `.mpop-stats`/`.ms-*`.
  Weighed foods shorten the basis unit for the quarter-width column (`100 g (3.5 oz)` → `100 g`).
  Data layer untouched; `tsc` clean, 48/48. Same-day polish (owner-accepted): hint line now shows
  only the timeHint (the "tap a food for one serving" text is gone), and a trailing ", cooked" is
  stripped from popup food names (display-only — the amount already says cooked; DB/chat unchanged).

## Unit-resolution fix + Seed v2 (2026-07-02) — COMMITTED (53b2271), live-data APPLIED

The assistant had miscalculated macros 3× from one root cause: `meal_items.quantity` reached the
model as a bare multiplier (`6× Chicken breast`) with no unit/macros, so it guessed serving sizes
(21 oz chicken dinners, 372 g protein days). Owner's brief fixed cause + data. All TDD; suite
**45/45** (10 files), `tsc` clean; all 3 of the brief's validation questions verified against the
live model (dinner chicken → 170 g exact; full-day protein → 215 g; beef swap → ~204 g cooked).

- **Fix 1 — resolve before inject** (the real fix): **`lib/resolve-item.ts`** (+12 tests) —
  `parseServing("100 g")`, `resolveItem(qty, food)` → `{amountLabel, rawLabel, kcal, P/C/F}`,
  `formatPlanLine`, `sumResolved` (totals sum line-rounded values so lines+totals agree),
  `buildPlanBlock`. The system prompt now renders every meal as resolved lines:
  `- Chicken breast, cooked: 170 g (6 oz) -> 281 kcal, 53g P, 0g C, 6g F [raw ≈ 227 g (8 oz)]`
  + per-meal TOTAL. **The model never sees a multiplier**; chat tool cards too (`lib/tools.ts`
  log_food card/summary now "name, 2 tbsp" not "2 ×"; tool description prefers absolute amounts).
- **Fix 2 — data**: weighed foods re-based to **per-100 g** (`serving_desc="100 g"`,
  `serving_grams=100`); count foods keep natural units (egg/slice/tbsp/banana). `meal_items.quantity`
  stays a serving multiplier in the DB but now encodes absolute grams (1.7 = 170 g) — owner-approved
  (Option A, no migration churn); the invariant is *no multiplier ever rendered*. New col
  **`foods.raw_to_cooked_yield`** (migration `0003`, APPLIED): cooked/raw for meats (chicken 0.75,
  beef 0.72), dry→cooked for rice (3.0) — injected as the `raw ≈` hint + used by chat for raw↔cooked.
- **Fix 3 — guardrails**: verbatim never-invent-a-serving-size rule + cooked-weight-is-canonical
  rule (meats: always give BOTH cooked and raw; use stored yield, never a guessed % — owner hit
  Haiku guessing "25% cooking loss" and demanded this).
- **Seed v2**: data in **`db/seed-data.ts`** (+5 tests), shared by `db/seed.ts` (FULL-WIPE reset)
  and **`db/apply-seed-v2.ts`** (surgical in-place apply — what was RUN against live Neon: 9 foods
  updated by name, ground beef inserted, 16 meal_items replaced, targets updated; logs/weigh-ins/
  photos/brands untouched). Targets are **COMPUTED from the plan data** via `computeTargets()`
  (owner rule): now **3603 kcal / 216P / 421C / 125F**. Honest `is_estimated` flags. **Peanuts
  deviation from the brief**: live row had the real GV label (180 kcal per 28 g) mis-stored against
  100 g — seeded as the label scaled to 100 g (643 kcal / 28.6P / 14.3C / 53.6F, est=false), not
  the brief's 590 estimate. NB the brief's own "~370C/~100F" day totals never added up (~421C/~123F
  from its own food data); computed targets win.
- **Historical note**: pre-fix `log_entries` keep correct snapshotted macros, but their `quantity`
  was a multiplier of the OLD basis (chicken "6" = 6×1oz) — display-only concern, nothing rereads it.
- **Test-suite fix**: the "occasional Neon flake" in `tools-groceries.test.ts` was actually a
  cleanup ordering bug (log entries deleted by date, foods by name → FK-blocked forever once any
  ZZTOOL_ log landed off-date). Cleanup now deletes by the test foods' ids first. 4 consecutive
  full runs green.

## Groceries v1 (2026-06-24, COMMITTED on branch) — the original feature

*(Groceries v2 below — 2026-06-26, UNCOMMITTED — adds the redesign, auto-fill, and photos.)*

A curated, weight-aware **Groceries** list = the `foods` library surfaced as a management screen
and made the **source of truth** for macros. Owner logs by **weight** ("8 oz chicken"); Kal pulls
macros only from the library and never invents them. Built via subagent-driven TDD; full suite 16/16,
`tsc` clean, `npm run build` shows `ƒ /groceries`. Spec/plan in `docs/superpowers/{specs,plans}/`.

- **Schema** (`db/schema.ts`, migration `0001_*.sql`) — `foods` gained `store`, `link`, `category`,
  `serving_grams numeric(8,2)` (the weight basis), `is_estimated boolean NOT NULL default false`,
  `purchase_weight numeric(8,2)` (grams, recorded only — NO auto-decrement), `price numeric(8,2)`.
  Macros stay **per serving**; meal plan / Today / mark-eaten untouched. Seeded foods have
  `serving_grams = null` (still log by serving; weight logging needs a gram basis).
- **`lib/units.ts`** — `toGrams(v, "g"|"oz"|"lb")`, `weightToServings(grams, servingGrams)`;
  `1 oz = 28.3495 g`, `1 lb = 453.592 g`. The ONE canonical conversion source (client imports it too).
- **`lib/groceries.ts`** — `listGroceries / createGrocery / updateGrocery / deleteGrocery` + `GroceryView`
  mapper (numeric→Number). `deleteGrocery` lets the FK-restrict error propagate.
- **Chat tools** (`lib/tools.ts`) — new `add_grocery` (saves a label item, `is_estimated=false`);
  `log_food` gained `oz`/`grams` → converts via the food's `serving_grams` (errors if null), snapshots
  macros from the unrounded servings float, card shows the weight. `lib/system-prompt.ts` rules:
  search→log by weight, never invent macros, off-list → ask brand+label facts → `add_grocery` → log.
- **REST** — `GET/POST /api/groceries`, `PATCH/DELETE /api/groceries/[id]`. DELETE returns **409**
  only for a Postgres FK violation (`err.cause.code === "23503"` — Drizzle wraps it on `.cause`);
  other errors rethrow → 500 (don't mask). Client mutates only via these (swappable-brain rule).
- **Screen** — `app/groceries/page.tsx` (server, **`force-dynamic`**) + `groceries-list.tsx` (client
  add/edit/delete form: serving g/oz, package weight lb/oz/g → stored as grams; shows derived
  ~$/serving; "no weight set" for seeded foods). "Groceries" link added to the Today header.
- **Verified live (Neon + real model):** weight log 200 g of a 113.4 g/130 kcal serving → 229 kcal /
  42.33 P exact; off-list food → model asked for the label, logged 0 invented macros; 409 in-use guard.
- **Process note:** the v1 screen did **not** get the 3-variant HTML design exploration first —
  owner flagged this as a miss. v2 (below) corrected this with design mockups in `design/`.

## Groceries v2 (2026-06-26) — UNCOMMITTED working-tree changes on branch `groceries`

Owner-driven redesign + nutrition auto-fill + product photos. **NOT committed** — `git status`
lists all the files. All TDD. Suite **27/27** (8 files), `tsc` clean, `npm run build` shows
`ƒ /groceries` + `ƒ /api/nutrition`, `ƒ /api/nutrition/vision`, `ƒ /api/upload`. Design mockups
(open in browser): `design/groceries-{variants,combined,photo-options,bar-options}.html`.

- **Schema** (migration `0002_previous_iron_monger.sql`, APPLIED to Neon) — `foods` gained
  `image_url text`. New dep: **`@vercel/blob`**.
- **Card redesign** (`app/groceries/groceries-list.tsx` + `.gr-*`/`.gcard-*` in `globals.css`):
  - Default groups by **today's meals** (Breakfast/Lunch/… shelves via `getGroceryGroups`, which
    joins `meal_items`); a toggle flips to **by-category** shelves; foods in no meal → **Pantry**.
  - **Horizontal cards**: square photo left (full image, `object-fit:contain` on white — products
    shoot on white so contain is seamless), details right, one per row.
  - **Macro bar** is a single stacked bar sized by **grams**; the P/C/F numbers sit BELOW each
    segment, each flexed by the same gram value so the number tracks its segment (0-gram macros omitted).
  - **Categories** are a FIXED dropdown (protein/carb/fat/dairy/fruit/veg/other), colored; `normCat()`
    maps free-text/chat values (e.g. "oil"→fat) to a bucket.
- **No middots:** every `·` separator removed app-wide (Today/Chat/Groceries/`lib/tools.ts` tool cards),
  replaced by flex-gap spans or spaces/commas. Owner called the `·` a "midpoint."
- **Nutrition auto-fill** — the form has a lookup box + a label-photo button:
  - **`lib/nutrition-lookup.ts`** (+tests): `searchNutrition(q)` queries **USDA FoodData Central**
    (needs `FDC_API_KEY`; strong on US store brands) AND **OpenFoodFacts** (no key) in parallel,
    merges (USDA first), dedupes, caps 8. Both store per-100g; we **scale to the label serving** when
    its gram weight is known (so a card reads `180 kcal / 28 g`). `GET /api/nutrition?q=`.
    Hits carry a `source` tag shown in the UI.
  - **`lib/label-vision.ts`** (+tests) + **`POST /api/nutrition/vision`**: Claude (CHAT_MODEL, Haiku)
    reads a Nutrition Facts photo → one serving's macros. `parseLabelNutrition()` is pure/tested;
    client downscales the image ≤1024px before sending. Verified: real label photo → 180/28g exact.
- **Product photos** — **`POST /api/upload`** stores a downscaled front-of-package photo to **Vercel
  Blob** (`@vercel/blob` `put`, `access:"public"`, store `kal-photos` / `store_I1fImjhmMybeesam`),
  returns the public URL saved as `image_url`. Form has "📷 Add product photo" (preview) + paste-URL.
  - **AUTH:** prod uploads use **OIDC automatically** (OIDC on for Prod, `BLOB_STORE_ID` in Prod env —
    no token needed). LOCAL dev needs `BLOB_READ_WRITE_TOKEN` in `.env.local` (OIDC is OFF for the
    `development` env; the token is from the store's dashboard quickstart, NOT in `vercel env`).
- **Provenance / why no link-scraping:** auto-filling macros OR photos from the product *link* is
  impossible — Walmart/Amazon/Target bot-wall server-side fetches (proven: our server gets a captcha
  page; a render-proxy got the page but not the macros). The seeded foods' macros are original
  ESTIMATES, not labels — correct them via lookup/vision. DB coverage is patchy (OFF lacked the GV
  peanuts; USDA had them exact) — vision is the universal fallback.
- **Verified live:** USDA+OFF lookup returns the exact GV peanuts (180/28g); vision read the real
  label → 180/28g/8P/4C/15F; Blob upload → public URL fetches 200 image/jpeg.

## Post-ship fix (2026-06-23): stale Today screen

Symptom: logging a meal on the deployed PWA showed a green check but the rings/macros/count
never moved, and the screen could show yesterday's date. **Root cause: `/` was prerendered
static** (build-time snapshot), so `router.refresh()` re-served a frozen RSC instead of
reading the DB — writes landed correctly but the page never reflected them. Two-part fix:

- **`app/page.tsx`** — `export const dynamic = "force-dynamic"` so Today reads live DB +
  current day on every request (build route table now shows `ƒ /`, was `○ /`). This is the
  real fix; see the gotcha above.
- **`app/refresh-on-focus.tsx`** (new) — on `visibilitychange`→visible / bfcache `pageshow`,
  calls `router.refresh()`. iOS standalone PWAs restore the previous session from memory on
  reopen (no reload/navigation), so nothing otherwise re-fetches; this triggers the refetch
  (and the day rollover). `key={date}` on `<MealList>` drops stale optimistic checks at the
  boundary. Today-only by design (Chat is ephemeral, no stale-totals problem).

NB during this debug: prod `APP_PASSWORD`/`SESSION_SECRET` are **Sensitive/encrypted** Vercel
vars → `vercel env pull` writes them back as `""` (write-only). A prior pull blanked local
`APP_PASSWORD` to `""`, so **local browser login is currently broken**; set a local-only value
in `.env.local` if you need `localhost` login (prod is unaffected).

## Current status: Phase 5 COMPLETE ✅ (Auth + PWA + deployed) — v1 SHIPPED 🚀

Live: **https://kal-delta.vercel.app** (Vercel project `kal`, team godfreyps-projects).
Verified live: unauth page → 307 /login, unauth API → 401, wrong password → 401,
manifest/icon/apple-icon serve. Log in with `APP_PASSWORD` to use it.

- **Auth (iron-session)**: `proxy.ts` gates all routes except `/login` + `/api/auth/*`
  (pages redirect, API → 401; logged-in users bounced off /login). `lib/session.ts`
  (config, no next/headers — safe for proxy), `lib/auth.ts` (`getSession` via cookies()).
  `POST /api/auth/login` checks `APP_PASSWORD`; `/api/auth/logout` destroys; Sign-out on
  Today header (`app/sign-out.tsx`).
- **PWA**: `app/manifest.ts` (standalone, theme/bg bone), `public/icon.svg` (bone-on-ink K),
  `app/apple-icon.tsx` (iOS PNG via `next/og` ImageResponse), `appleWebApp` + `themeColor`
  in `app/layout.tsx`. Installable.
- **Vercel env (Production)**: added `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `APP_PASSWORD`
  (DB vars were already there). Deployed via `vercel --prod`.
- **Local env**: `.env.local` `APP_PASSWORD` swapped to the production value (pulled from
  Vercel) so local login matches prod. `SESSION_SECRET` differs (local-only, fine).
- **Dev-server gotcha**: Next dev hot-reloads `.env.local` changes (no restart needed); but
  background `npm run dev` keeps dying between turns — run on `PORT=3100` and don't start
  duplicates (EADDRINUSE).

### Deferred to v1.5 / Phase 6
- Prompt caching on the chat system-prompt/tools prefix (~10× cheaper repeat turns).
- `is_estimated` provenance flag, grocery-logging section, trends/weight-chart screen,
  chat history summarization (currently hard 30-cap).
- Plan screen: REST CRUD for foods/profile/meals + memory-facts editor.

---

## Phase 4 (prior): Chat UI — COMPLETE ✅

Verified: `tsc --noEmit` clean; `/chat` + `/` render 200; chat SSE emits enriched
`tool_result` events (card `{label,title,detail}` + `remaining` macros); Undo endpoint
reverted a batch (`{revertedEntries:4}`, also clears meal_status). Today left clean.

- **Design**: `design/phase4-chat-variants.html` (3) + `design/phase4-chat-combined.html`
  (approved). Owner picked **Variant B (bubbles + cards)** + Variant C's remaining-today
  **4-up stat strip** under Kal's replies; "Meal eaten" tool card kept, with Undo.
- **`lib/undo.ts`** `revertWriteBatch(batchId)` + **`POST /api/undo`** {writeBatchId} —
  deletes the batch's log_entries + clears its meal_status row. Powers card Undo.
- **Enriched SSE**: `runTool` now returns optional `card` (write tools) and `remaining`
  (get_day_summary); chat route emits both in the `tool_result` event so the UI renders
  from authoritative data, not parsed text. Stat strip shows whenever get_day_summary ran.
- **`app/chat/`** — `page.tsx` → `chat.tsx` (client). Fresh `crypto.randomUUID()` session
  per open (`+ New` resets), composer (Enter to send), parses the SSE via fetch reader,
  renders bubbles + tool cards (Undo) + remaining stat strip + typing indicator.
- **Nav**: "Chat →" link on Today header; "‹ Today" on chat header. Chat styles in
  `globals.css` (scoped under `.chat`).
- **Model + cost tracker**: chat meta bar shows `CHAT_MODEL` (passed from server page) and a
  running `$cost · N tok` readout. Route accumulates per-turn Anthropic `usage` and emits a
  `usage` SSE event; `usageCostUsd()` prices it from a per-model table in `lib/anthropic.ts`
  (Haiku 1/5 per MTok). Resets on "+ New". No prompt caching yet (cacheRead 0).
- **Dev-server note**: another local project ("Glass") squats :3000; run Kal dev on a
  dedicated port (`PORT=3100 npm run dev`) and keep it backgrounded so it persists.

### Not built (intentionally deferred)
- Optimistic remaining-update after Undo (card greys to "Undone"; numbers refresh on next ask).
- REST CRUD for `/api/foods`, `/api/profile`, `/api/memory-facts` (Plan screen, later).

---

## Phase 3 (prior): Chat route — COMPLETE ✅

Verified: `tsc --noEmit` clean; tools + system-prompt smoke-tested against live DB;
chat route driven via curl — "I ate my whole breakfast, what's left?" → model called
`set_meal_status('eaten')` (4 items, write_batch_id) then `get_day_summary`, streamed
correct totals (consumed 815/48/80/40, remaining 2745/164/341/83.6), persisted 4 turns to
`chat_messages`. Test state reverted.

- **`@anthropic-ai/sdk`** added. **`lib/anthropic.ts`** — lazy client, `ANTHROPIC_MODEL`
  (default `claude-haiku-4-5`, cheapest-capable), `MAX_TOOL_ITERATIONS=8`. Haiku → no
  thinking/effort params (those 400 on Haiku).
- **`lib/tools.ts`** — 7 tools (`get_day_summary`, `search_foods`, `log_food`,
  `set_meal_status`, `log_weigh_in`, `get_weight_trend`, `add_memory_fact`). Snake_case
  inputs, `date` defaults to `todayInAppTz()`. Reuses `getDaySummary`/`setMealStatus`.
  Write tools return `write_batch_id` for Undo (where a batch exists). `log_food` accepts
  an existing `food_id`×qty OR a new free-form food (name+per-serving macros → adds to
  library then logs). `runTool` returns `{forModel, summary, writeBatchId}`.
- **`lib/system-prompt.ts`** — `assembleSystemPrompt(date)`: profile, targets, today
  consumed/remaining, meal plan **with meal-ids** + per-meal status, recent weight, memory
  facts, rules. Assembled fresh per request.
- **`app/api/chat/route.ts`** — `POST {sessionId, message}`. Loads session history (cap 30,
  head-trimmed so it never starts on a dangling tool_result), manual tool loop (max 8),
  streams SSE events `{type: text|tool_use|tool_result|done|error}` (tool_result carries
  `summary` + `writeBatchId` for Phase-4 cards), persists every turn to `chat_messages`.
- **Env**: `ANTHROPIC_API_KEY` now required in `.env.local` (git-ignored; added manually,
  not yet in Vercel). `ANTHROPIC_MODEL` optional.

### Not built (intentionally deferred)
- Chat UI (Phase 4). History summarization beyond the hard 30-cap (v1.5).
- REST CRUD for `/api/foods`, `/api/profile`, `/api/memory-facts` (Plan screen / later).

---

## Phase 2 (prior): REST + Today screen — COMPLETE ✅

Verified: `npm test` → 8/8, `tsc --noEmit` clean, Today screen renders against live DB,
REST endpoints exercised via curl (mark-eaten → undo → weigh-in upsert), DB left pristine.

- **Design**: `design/phase2-today-variants.html` (3 variants) + `design/phase2-today-combined.html`
  (the approved one). Owner picked: calorie **ring** + segmented **macro bars** (big number =
  *remaining*, filled segments = *consumed*) + per-meal **checklist** (tap = log instantly, re-tap
  = undo) + weigh-in **only on Sundays**. Warm-monochrome minimalist (NOT the plan's "dark/dense"
  note — superseded by owner's pick).
- **`lib/meal-status.ts`** — `setMealStatus(date, mealId, status)`. `'eaten'` fills the gaps
  (auto-logs only planned items not already logged for `(date,meal_id)`, shared `write_batch_id`);
  `'pending'` undoes (reverts that batch + status row). Tested: no-double-count + undo
  (`lib/meal-status.test.ts`, sentinel date **2099-02-02** to avoid day-summary's 2099-01-01).
  NB: neon-http has no interactive txns → sequential statements (fine for single-user).
- **`lib/today.ts`** — `getTodayView(date)`: summary + meals (planned kcal, status, which is "now")
  + latest weigh-in + `weighInDue` (Sunday & none logged). One read, no LLM.
- **REST**: `POST /api/meals/[id]/status` ({status, date?}) and `POST /api/weigh-ins`
  ({weightLb, date?, note?}, upsert by unique date). Share the same lib the Phase 3 chat tools will.
- **UI**: `app/page.tsx` (server component, reads lib directly — initial paint; mutations go via
  REST per the swappable-brain rule), `app/meal-list.tsx` + `app/weigh-in.tsx` (client, optimistic
  + `router.refresh()`). Fonts: Newsreader + JetBrains Mono via `next/font`; tokens in `globals.css`.

### Not built (intentionally deferred)
- Arbitrary/freeform food-logging UI (the approved Today design has no such control; chat covers it).
- `is_estimated` flag + grocery section → Phase 6 per plan roadmap.

---

## Phase 1 (prior): schema, seed, time, day-summary — COMPLETE ✅

Verified with passing tests.

- **Schema** (`db/schema.ts`) — 9 tables: profile, foods, meals, meal_items, log_entries
  (snapshot macros + `source` + `write_batch_id`), meal_status (unique `date,meal_id` + `write_batch_id`),
  weigh_ins, memory_facts, chat_messages (`session_id`, no threads). Migrated to Neon (`db/migrations/0000_init.sql`).
- **`lib/time.ts`** — `todayInAppTz()`, TDD, 3 tests (`lib/time.test.ts`).
- **`lib/day-summary.ts`** — `getDaySummary(date)` → targets/consumed/remaining. TDD integration test
  (`lib/day-summary.test.ts`) against live DB using sentinel date `2099-01-01`.
- **`db/seed.ts`** — seeds meal plan v1 (9 foods, 5 meals, 16 items) + profile.
  Targets: **3560 kcal / 212 P / 421 C / 124 F** (= full-day plan totals, verified).
- **DB**: isolated Neon project `neon-bronze-cave`, connected to Vercel project `kal` (team
  godfreyp's-projects). Creds in git-ignored `.env.local` (pulled via `vercel env pull`).

## Commands

```bash
npm run dev          # next dev
npm test             # vitest run (needs DATABASE_URL for day-summary integration test)
npm run db:generate  # drizzle-kit generate (after schema changes)
npm run db:migrate   # apply migrations to Neon (uses DATABASE_URL_UNPOOLED)
npm run db:seed      # reseed (wipes + reinserts Kal's own tables only)
```

Env lives in `.env.local` (git-ignored). Standalone scripts load it via `db/env.ts`.
⚠️ Do NOT `vercel env pull .env.local` — it writes encrypted/sensitive vars (`APP_PASSWORD`,
`SESSION_SECRET`) back as `""` and breaks local login. To grab one key, pull to a TEMP file
(`vercel env pull /tmp/x.env`) and copy just the line you need. Local-only keys not in Vercel:
`APP_PASSWORD=devpass`, `BLOB_READ_WRITE_TOKEN` (from the Blob store dashboard, not env).

## File map

```
db/schema.ts          Drizzle tables          db/index.ts    Neon client (db)
db/seed.ts            Seed (meal plan v1)      db/env.ts      dotenv loader for scripts
db/migrations/        Generated SQL            drizzle.config.ts
lib/time.ts (+test)   todayInAppTz()
lib/day-summary.ts (+test)  remaining-macros query
lib/meal-status.ts (+test)  fill-the-gaps 'eaten' + undo (write_batch_id)
lib/today.ts          getTodayView() — everything the Today screen renders
app/page.tsx          Today screen (server component)
app/meal-list.tsx     per-meal checklist (client, optimistic log/undo)
app/weigh-in.tsx      Sunday weigh-in quick-add (client)
app/api/meals/[id]/status/route.ts   POST set/undo meal status
app/api/weigh-ins/route.ts           POST weigh-in upsert
design/phase2-today-*.html           Today design variants (combined = approved)
lib/anthropic.ts      Anthropic client + model/iteration config
lib/tools.ts          7 chat tools + runTool() executor
lib/system-prompt.ts  assembleSystemPrompt(date)
app/api/chat/route.ts POST chat: tool loop + SSE stream + persistence
lib/undo.ts           revertWriteBatch(batchId)
app/api/undo/route.ts POST undo a write batch
app/chat/page.tsx + chat.tsx   Chat screen (client, streaming)
design/phase4-chat-*.html      Chat design variants (combined = approved)
proxy.ts              auth gate (was "middleware" pre-Next16)
lib/session.ts        iron-session config (proxy-safe)
lib/auth.ts           getSession() for routes/components
app/api/auth/login|logout/route.ts
app/login/page.tsx    password login screen
app/sign-out.tsx      sign-out button (Today header)
app/manifest.ts + public/icon.svg + app/apple-icon.tsx   PWA
app/refresh-on-focus.tsx   re-fetch Today on PWA reopen (visibilitychange/pageshow)
lib/units.ts (+test)       oz/lb/g → grams; grams → servings (Groceries)
lib/groceries.ts (+test)   grocery CRUD + GroceryView mapper + getGroceryGroups() (meal/category grouping)
app/groceries/page.tsx + groceries-list.tsx   Groceries screen (force-dynamic; v2 redesign, lookup, vision, photo upload)
app/api/groceries/route.ts + [id]/route.ts    Groceries REST (list/create, patch/delete + 409 guard)
docs/superpowers/{specs,plans}/2026-06-23-groceries-*   Groceries v1 spec + implementation plan
— Groceries v2 (2026-06-26, uncommitted) —
— Unit-resolution fix + Seed v2 (2026-07-02) —
lib/resolve-item.ts (+test)       parseServing/resolveItem/formatPlanLine/buildPlanBlock — model/UI never see a multiplier
db/seed-data.ts (+test)           Seed v2 foods/meals/items + computeTargets() (targets derive from food data)
db/apply-seed-v2.ts               surgical in-place apply to live DB (preserves logs/photos; idempotent)
db/migrations/0003_*.sql          foods.raw_to_cooked_yield (APPLIED to Neon)
— Today meal-detail popup (2026-07-06) —
lib/today.test.ts                 getTodayView items: resolved amounts + 1-serving basis (sentinel 2099-04-04)
app/meal-popup.tsx                the popup card (B + E3 stat strip + Rise & sink open/close)
design/today-meal-popup-variants.html                 round 1: popup style, 3 variants (owner picked B)
design/today-meal-popup-b-item-expand.html            round 2: per-serving expand, 3 variants (owner picked B3)
design/today-meal-popup-open-close-animations.html    round 3: open/close motion, 3 variants (owner picked Rise & sink)
design/today-meal-popup-stats-{variants,chips,oneline,strip}.html   per-food stats restyle rounds 1-4 (owner picked E3 strip)
lib/nutrition-lookup.ts (+test)   USDA FDC + OpenFoodFacts search, merged, scaled to label serving
lib/label-vision.ts (+test)       Claude reads a Nutrition Facts photo → macros (parseLabelNutrition pure)
app/api/nutrition/route.ts        GET ?q= → merged nutrition hits
app/api/nutrition/vision/route.ts POST {imageBase64,mediaType} → label macros
app/api/upload/route.ts           POST → Vercel Blob product photo → public URL (image_url)
design/groceries-{variants,combined,photo-options,bar-options}.html   v2 design mockups
```

---

## Roadmap (each phase ≈ its own session)

- **Phase 2 — REST + Today screen. DONE ✅** (see Current status above.)
- **Phase 3 — Chat route. DONE ✅** (see Current status above.)
- **Phase 4 — Chat UI. DONE ✅** (see Current status above.)
- **Phase 5 — Auth + PWA + deploy. DONE ✅ (v1 shipped).** Live at https://kal-delta.vercel.app.
- **Groceries v1 — built 2026-06-24 (branch `groceries`, COMMITTED).** Weight-based source-of-truth
  food library + screen + chat tools.
- **Groceries v2 — built 2026-06-26, MERGED + DEPLOYED 2026-06-29.** Card redesign, USDA+OFF
  nutrition auto-fill, label-photo vision, Vercel Blob product photos, middots removed. Live in
  prod for trial; **design not owner-approved** → rework is backlog item #1.
- **Unit-resolution fix + Seed v2 — built + live-data-applied 2026-07-02, COMMITTED.** Resolver
  lib, per-100g basis, raw/cooked yields, computed targets. Deploy pending owner go-ahead.
- **Today meal-detail popup — DONE 2026-07-06, owner-accepted.** Variant B card + B3 per-serving
  expand + Rise & sink animation. Per-food stats restyled to the **E3 open-column strip** + polish
  later that day (owner-accepted). All deployed to prod 2026-07-06.
- **Phase 6 / v1.5+ — remaining deferrals:** prompt caching, inventory decrement,
  trends/weight-chart screen, chat history summarization.

## Open notes

- Vercel CLI is a bit behind (53.x → 54.x); upgrade optional: `npm i -g vercel@latest`.
- The `[est]/[label]` macro source is preserved in `db/seed.ts` for when `is_estimated` lands.
