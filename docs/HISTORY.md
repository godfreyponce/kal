# Kal — Build History & Reference

*Archived from STATE.md on 2026-07-10. STATE.md is now a thin quick-resume snapshot; this file holds the full build archive, environment reference, and per-feature detail. The work queue lives in GitHub Issues.*

**Prod env status for v2 (verified 2026-06-29 via `vercel env ls production`):**
- `ANTHROPIC_API_KEY` present → **label-photo vision works in prod** (`/api/nutrition/vision`
  returns 401 unauth = route live + gated; in-app call carries the session cookie).
- `BLOB_STORE_ID` present (Prod+Preview) → product-photo upload should work via OIDC (not yet
  exercised live in prod).
- **`FDC_API_KEY` is MISSING from prod** → typing a food *name* to search nutrition DB returns
  only OpenFoodFacts (USDA half silently no-ops). Add it to Prod env to enable USDA name-search.
  Does NOT affect the label-photo flow.

**Grocery photos + store/link (2026-07-07, owner-directed):** all 9 foods have real product
images re-hosted on Vercel Blob (`groceries/<slug>.jpg`, `allowOverwrite`) + `store` + product
`link` — owner pasted the product pages; images grabbed via og:image (Walmart pages bot-wall
server fetches → opened in owner's Chrome via the extension; the image CDNs i5.walmartimages.com
and cdn.bfldr.com fetch fine server-side). The 2026-06-26 demo categories were kept. Peanuts'
old hotlinked Walmart URL was re-hosted too (its `link` is still null — page unknown). (The seed
macros are still the original ESTIMATES, not real labels — see the data-provenance note in the
Groceries section.)

**Local env (`.env.local`, git-ignored):** `APP_PASSWORD=<local-only value, see .env.local>` (prod value is encrypted/
write-only; a `vercel env pull` blanks it — NEVER pull into `.env.local`, pull to a temp file
and copy individual keys). Also set this session: `FDC_API_KEY` (real USDA key, owner-provided),
`BLOB_READ_WRITE_TOKEN` (local-only — prod uploads use OIDC, see Groceries §photos).

**How to run / verify (do this first):**
```bash
PORT=3100 npm run dev    # :3000 is taken by another local project ("Glass"); use 3100
npm test                 # vitest 56/56 across 12 files (needs DATABASE_URL; hits live Neon)
npx tsc --noEmit         # must stay clean
```
Run the dev server backgrounded and DON'T start a duplicate (EADDRINUSE on 3100). Integration
tests hit live Neon — a transient network red can still happen (re-run before trusting it), but
the RECURRING "flake" was a real cleanup bug, fixed 2026-07-02 (see the unit-fix section). To
verify a change in the real app, exercise routes with `curl` against `localhost:3100`.
**After editing `globals.css`, Turbopack dev serves STALE CSS** — `rm -rf .next` and restart,
then hard-refresh the browser (the CSS chunk URL is unchanged so a soft refresh keeps the old
file). This cost a lot of debugging this session; route/TSX edits hot-reload fine, only CSS is cached.

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

## Adherence day-detail modal — #22 (2026-07-15) — COMMITTED & pushed to main; deployed-prod phone-verify pending

Tapping a day in the #6 adherence strip now opens a centered day-detail modal on `/plan`: the
day's date, an on/off-plan verdict, a kcal bar (consumed vs target) + note, a protein bar + note,
and the day's logged foods — each food row expanding on tap to reveal its own kcal + protein.
Reuses the Today meal-popup shell verbatim (rise/sink, scrim, Escape, `aria-modal`, the
`.mpop-item`→`.mpop-serv` expand mechanic). Owner-approved paradigm: **modal card, not a bottom
sheet** (3-variant mockup `design/plan-day-detail-variants.html`); the expandable per-food rows
were an owner add. Plan: `docs/superpowers/plans/2026-07-14-issue-22.md`.

- **Client/server split (the crux):** `lib/adherence.ts` imports the DB, so a client component
  can't pull runtime helpers from it without bundling Neon into the browser. Extracted all DB-free
  display + rule logic into new **`lib/adherence-view.ts`** — `Macros`/`DayCell`/`DayFood` types,
  the rule constants (`KCAL_TOLERANCE`/`PROTEIN_FLOOR`), `judgeDay`/`kcalWithinBand`/`proteinMet`,
  the shared `dayVerdict` (verdict copy for both strip and modal), and `bucketDayFoods`.
  `lib/adherence.ts` now imports + **re-exports** these (existing importers unchanged) and adds
  the one new query.
- **Data:** `getWeekDayFoods(today?)` — one `log_entries ⋈ foods` read over the calendar week,
  ordered by `(date, id)`, numeric columns `.mapWith(Number)`, bucketed by date via the pure
  `bucketDayFoods` (amount label from `resolveItem`; displayed kcal/protein are the STORED
  per-entry values so they agree with the strip's summed totals). Preloaded in `/plan`'s existing
  `Promise.all` (instant open, no fetch-on-tap route).
- **UI:** `app/plan/weekly-adherence.tsx` became a **client component** — each cell is now a
  `<button>` (ahead days `disabled`) that opens the modal; verdict copy routed through the shared
  `dayVerdict`. New `app/plan/day-detail-modal.tsx` reuses `.mpop*` + adds `.dd-*` stat bars /
  verdict pill. `.cell` got a button reset in `app/globals.css`.
- **Mobile tooltip fix (folded in):** tapping a cell on a phone was firing the desktop `:hover`
  tooltip (a black box). Gated `.cell:hover .tip` behind `@media (hover: hover) and (pointer: fine)`
  so it shows only on true-hover devices; the day modal is the mobile path.
- **Verification:** `npx tsc --noEmit` clean; `npm test` **146/146 across 23 files** (12 new
  DB-free cases in `lib/adherence-view.test.ts` — `dayVerdict`/`judgeDay`/`bucketDayFoods`, no
  `db/env` import since they never touch the DB). The client/server boundary was proven by a
  production `next build` (client graph compiled with no DB-in-browser error). Owner phone-verified
  the modal + tooltip fix on a local prod build served over Tailscale HTTPS.
- **Phone-testing gotcha discovered** (now in STATE.md): Next dev won't hydrate on a bare-IP
  origin and prod's `Secure` cookie needs HTTPS → phone-test via `tailscale serve` over
  `https://<host>.ts.net`, not `http://<tailscale-IP>:3100`.
- **Follow-ons:** #24 (redesign the modal's mobile open/close animation, ref
  spottedinprod.com/clips) filed 2026-07-15; #23 (swipe-up calendar history) still open. Both unlabeled.

## Weekly adherence on /plan — #6 (2026-07-14) — COMMITTED & pushed to main; owner phone-verify on prod pending

A weekly-adherence module on `/plan`, between Profile and Meal plan: a headline "X/7 days on
plan" over a **fixed Monday→Sunday calendar week** (denominator always 7, resets Monday — NOT a
rolling 7 days) plus a seven-bar Mon→Sun strip. Mirrors the weight-trend pure-logic/server-render
split. Design + spec were owner-approved 2026-07-14 (`docs/superpowers/specs/2026-07-14-weekly-adherence-design.md`,
visual ref `design/plan-adherence-final.html`); this ticket was pure wiring off that spec.

- **Pure core** `lib/adherence.ts` (`judgeDay` / `weekDays` / `classifyWeek`), unit-tested in
  `lib/adherence.test.ts` (12 cases). **Day rule:** a past day is *on plan* when logged kcal is
  within ±10% of target **AND** protein ≥90% of target (thresholds `KCAL_TOLERANCE=0.10`,
  `PROTEIN_FLOOR=0.90`, one place). **States:** on-plan / off-plan / unlogged (past day with no
  rows → off-plan, rendered struck-through) / today (live, **never judged, never counted**) /
  ahead (blank). All date math is UTC civil-string arithmetic (`new Date(d+"T00:00:00Z")`,
  `getUTCDay`/`setUTCDate`) — Vercel runs UTC.
- **Query wrapper** `getWeekAdherence(today?)`, co-located in `lib/adherence.ts`: two-query
  `Promise.all` (profile targets + one grouped `coalesce(sum).mapWith(Number)` over the week's
  `log_entries`), then `classifyWeek`. Defaults to `todayInAppTz()`. No new API route.
- **UI** server component `app/plan/weekly-adherence.tsx` (no `"use client"` — the only
  interactivity is a pure-CSS `:hover` tooltip; mobile tap-detail deferred to #22) + a verbatim
  CSS port from the approved mockup into `app/globals.css` (only the mockup's `:root` dropped —
  the app already defines every token). Wired into `app/plan/page.tsx`'s existing `Promise.all`.
- **Verification:** `npx tsc --noEmit` clean; `npm test` 134/134 across 22 files (12 new). Live
  `getWeekAdherence()` smoke against Neon returned correct targets ({kcal 3603, protein 216}) and
  week classification. Browser render not driven — `/plan` is auth-gated (`/login` redirect) and
  passwords are off-limits to the agent; CSS is verbatim from the approved mockup, so owner
  phone-verify is the visual sign-off.
- **Deviation from plan:** co-locating `getWeekAdherence` in `lib/adherence.ts` means the unit-test
  file transitively imports `db/index.ts`, which throws `DATABASE_URL is not set` at import. The
  plan omitted the repo's convention for DB-touching tests — **`import "../db/env";` as the first
  line** (a dotenv side-effect that loads `.env.local`; 12 other test files do this). Adding that
  line fixed it. The commit gate runs `tsc && npm test` with no `DATABASE_URL` in the env, so this
  is mandatory, not optional — the plan's "isolated test passes unchanged" prediction was wrong.
- **Follow-ons filed (not yet green-lit):** #22 mobile tap-for-day-detail sheet, #23 swipe-up
  calendar history view.

## Code-health batch #15+#16+#17 (2026-07-13) — DEPLOYED to prod, owner-accepted

- **#15 null-body → 400** (commit 1a2ba16, 15 files under `app/api`): every
  `req.json().catch(() => ({}))` is now `(await req.json().catch(() => ({}))) ?? {}` — a
  literal-`null` JSON body previously parsed successfully and then threw reading properties
  of null (unhandled 500). Sweep covered all 15 body-reading routes, not just the four
  families named in the issue. Regression test in `lib/memory.test.ts` imports the
  memory-facts `POST` handler directly and asserts 400 (verified 500-before/400-after).
  **Infra:** `vitest.config.ts` now resolves the `@/` tsconfig alias — this is what makes
  route-handler imports in tests possible (first route-level test in the repo).
- **#16 memory-facts ordering** (b3d1317): `lib/system-prompt.ts` adds an
  `asc(memoryFacts.id)` tiebreak, matching `lib/memory.ts` — same-millisecond inserts now
  render identically in chat and /plan.
- **#17 functional updaters** (e53ee3c): meal-plan-editor `bump`/`setQty`/`addFood` use
  `setItems(prev => …)`; `addFood`'s duplicate-foodId guard moved inside the updater (the
  one spot where a mechanical swap alone would have left a stale read).
- 122/122 tests, tsc clean, `vercel --prod`, smoke green. Note: prod null-body probe returns
  401 (auth gates before body parsing) — the 400 path is proven by the integration test.

## Polish batch #19+#20+#21 (2026-07-13) — DEPLOYED to prod, owner-accepted

- **#19 `--surface` token** (`app/globals.css`): `:root` now defines `--surface: #fff`. Eight
  rules (chat tool cards + their Undo, composer box, plus/new-chat buttons, rstrip stat chips,
  login input, chat links) previously resolved to transparent — undefined var makes `background`
  invalid at computed-value time — and blended into the warm canvas. Owner chose white surfaces
  after a live login before/after toggle. The Plan screen's two literal-`#fff` workarounds
  (`.plan-card`, `.plan-recalc`) now use the token (no visual change there).
- **#20 weight chart polish** (`lib/trend-geometry.ts`, `app/plan/weight-trend.tsx`):
  `formatDateLabel` exported from the lib, component's duplicate MONTHS/formatter deleted;
  GOAL label renders `goalWeightLb.toFixed(1)` (matches point/readout formatting; added a
  `goalWeightLb !== null` TS-narrowing guard, no behavior change); `shouldShowDots(count)`
  in the lib (MAX_DOTS = 40) gates per-point dots for dense series; `deltaLabel(0)` → `""`
  (was `+0.0`; the function lives in the component and stayed there — the repo has no
  component-test convention). +3 lib unit tests, written TDD.
- **#21 texture-dispose hardening** (`app/plan/figure-canvas.tsx`): `disposeMaterial()` helper
  walks the material's properties, disposes any `THREE.Texture`, then `material.dispose()`
  (which does NOT cascade to maps); both dispose paths use it.
- Commits 53d41d4 / 4203af7 / ee0880a (+ docs 2a230ae); `vercel --prod`; smoke: login 200,
  `/api/model` unauth 401, gated routes 307. Known leftover: the chart's aria-label still
  interpolates the raw goal number (out of #20's scope; cosmetic-for-screen-readers only).

## Plan screen Phase 3 (2026-07-12) — DEPLOYED to prod, owner-accepted

**Deploy:** the whole /plan feature set (Phases 1–3) shipped in one deploy, 2026-07-12 —
kal-delta.vercel.app, commit f7c4f66; smoke: login 200, `/api/model` unauth 401, gated routes 307.
Owner phone-verify of prod /plan still outstanding.

The "use my photos →" promise landed: /plan's figure loads the owner's personal 3D model,
mannequin as permanent fallback. Plan: `docs/superpowers/plans/2026-07-12-plan-screen-phase3.md`.
Built subagent-driven (Sonnet workers + per-task reviews + Fable final review), 5 code/doc
commits (e42577d..316078e + STATE).

- **Asset pipeline (owner-driven, nothing personal in the repo):** Rodin's API turned out
  business-tier-only → owner bought the $6 Creator month and drove the Rodin web UI
  themselves (agent guided settings; single front A-pose photo, UI-cropped + mirror-flipped
  locally first). Export was geometry-only (no textures) and ends at MID-THIGH (source
  photos were counter-cropped; owner accepted both — clay material by choice, matches the
  design language). 41MB/1M-tri GLB → weld → simplify (error-bound, 65k tris) → prune
  (position+normal only) → quantize → meshopt = **630 KB**, byte-identical render verified
  headlessly before build.
- **Hosting** — second Blob store `kal-private` (access: private; the original kal-photos
  store is public-only). `scripts/upload-model.ts` (argv path, dedicated
  `MODEL_BLOB_READ_WRITE_TOKEN`) + `GET /api/model` streaming route (proxy-gated,
  `cache-control: private, max-age=3600` — re-uploads take ≤1h to appear, hard-refresh to
  force; content-length set only when the SDK reports a real size — the store serves this
  blob chunked with size 0, an unconditional header truncated the body to 0 bytes, caught
  by the Task-1 worker). ⚠️ `vercel blob create-store` implicitly env-pulls into
  `.env.local` — wiped 4 local secrets + rebound the default token env; see STATE gotchas.
- **Swap-in (figure-canvas)** — lazy GLTFLoader + MeshoptDecoder (dynamic imports, /plan
  chunk only) AFTER the mannequin builds; ANY failure (404/network/parse/decoder) →
  mannequin stays, silently. Clay material override; scaled so head-top matches the
  mannequin's (1.6992) and the cut sits at 0.55 — model hovers over the ground shadow,
  deliberate. Single mesh ⇒ regions by y-bands (20/30/20/30, tuned from the plan's ~15%
  head), NO per-region tint on the model (chips/pin accent carry selection); the four
  marker anchors reparent onto the model — computed at rotation 0 THEN spun (final review
  caught the reorder: anchors measured after the carried idle-spin rotation glued pins to
  swap-time world-front on slow loads; verified fixed via 4s-delayed-load simulation).
  StrictMode-safe in-flight disposal; mannequin detached not disposed.
- **Verification** — 118/118, tsc clean, /plan ƒ, loaders /plan-chunk-only; headless:
  model renders, all four region taps correct, leaders track + away-fade, forced-404 →
  mannequin, delayed-load → pins on true front; owner phone pass accepted 2026-07-12.
  Tickets: #21 (texture-dispose hardening if a textured GLB ever uploads). Owner hygiene
  at acceptance: delete Rodin uploads, cancel Creator plan.

## Plan screen Phase 2 (2026-07-12) — DEPLOYED to prod, owner-accepted (see Phase 3 for the deploy)

The 3D figure + weight-trend build over Phase 1's core. Spec: build-order item 2 of
`docs/superpowers/specs/2026-07-11-plan-screen-design.md`; visual source of truth
`design/plan-figure.html` (scene PORTED constant-by-constant, not reinvented). Plan:
`docs/superpowers/plans/2026-07-12-plan-screen-phase2.md`. Built subagent-driven (Sonnet
workers + per-task reviews + Fable-model whole-branch final review), 16 commits
(ae2ed43..d64d32d). Suite 102→118 (21 files).

- **Figure island** — `app/plan/figure-canvas.tsx` ("use client", default export, mounted
  via `next/dynamic ssr:false` so three@0.185.1 stays in a /plan-only client chunk):
  procedural clay mannequin, OrbitControls (drag-rotate only, polar-clamped), raycast
  tap→region, idle rotation (pauses on drag / prefers-reduced-motion, IntersectionObserver
  render pause), region emissive tint via props (no globals), chips INSIDE the component
  with per-frame projected leader lines + away-fade (RAF writes style.opacity only — React
  owns className; the two never fight). Full disposal on unmount, StrictMode-safe.
- **Profile section** — `app/plan/profile-section.tsx` replaces the flat `profile-form.tsx`
  (deleted): four region editor cards (head=age/sex, chest=weight/goal+chart,
  waist=bodyfat/height, legs=activity; default chest), per-card minimal PATCHes, in-flight
  state scoped per card (`savingRegion`), height rule + inert "use my photos →" pill
  (Phase 3 marker). Targets footer kept from Phase 1.
- **Weight trend** — `lib/weigh-ins.ts` (window read) + `lib/trend-geometry.ts` (pure,
  DB/DOM-free: time-scaled x, goal-stretched padded y-domain, 5-lb gridlines, crosshair
  snap, recent-log deltas; goalY null at 0 entries — renderer shows text empty state) +
  `app/plan/weight-trend.tsx` (hover crosshair keyed by DATE so router.refresh re-resolves).
  90-day window computed in the page loader; no new REST route.
- **Macros-dim** (deferred #5 item) — meal editor computes baseline/pending Σq×unitKcal
  client-side (like-with-like, so yield-adjusted foods don't false-dim); strip + editing
  header show live kcal (header anchored `meal.kcal − baseline + pending` to avoid jump),
  macros dim @0.35 while pending ≠ baseline. No pre-save banner (owner-approved cut).
- **Final-review catches (both latent in the design file / plan itself):** OrbitControls'
  constructor resets `touch-action` to `none` — pan-y must be set AFTER construction, else
  the island is a phone scroll-trap (design file annotated); dynamic chunk-load failure
  crashed all of /plan → `import().catch` swaps in `FigureImportFallback` (static chips,
  no three.js) honoring D5's "editing never depends on 3D".
- **Verification** — 118/118, tsc clean, `/plan` ƒ, three absent from server chunks;
  headless-Chrome pass (puppeteer-core + system Chrome; extension was disconnected):
  WebGL render, live chips, leader projection, chip-tap card switch, macros-dim @0.35
  computed, zero console errors. Owner phone pass on local network, then accepted;
  activity-hint copy genericized at acceptance (public repo). Chart-polish follow-ups: #20.
  Phase 3 (owner photo → GLB model) green-lit at acceptance — photos confirmed with owner
  before any external upload.

## Plan screen Phase 1 (2026-07-11..12) — DEPLOYED to prod, owner-accepted (see Phase 3 for the deploy)

The first editing UI for the three data sources everything else reads: profile, meal-plan
template, memory facts. Spec: `docs/superpowers/specs/2026-07-11-plan-screen-design.md`
(owner picked the "Figure" direction; Phase 1 is the non-3D core — the three-variant mockup
round lives in `design/plan-variants.html` → `plan-atlas.html` / `plan-figure.html`).
Plan: `docs/superpowers/plans/2026-07-11-plan-screen-phase1.md`. Built subagent-driven
(Sonnet workers + per-task reviews + whole-branch final review), 20 commits.

- **Page** — `app/plan/page.tsx` (server, **force-dynamic**, `Promise.all` loader) +
  `profile-form.tsx`, `meal-plan-editor.tsx`, `memory-list.tsx` (clients, fetch →
  `startTransition(router.refresh())`, Groceries idiom). Nav pill on Today. CSS `.plan-*`
  block in `globals.css`.
- **Libs** — `lib/profile.ts` (singleton read/update; goal_date deliberately dead — owner
  dropped deadlines; targets NOT writable here), `lib/plan.ts` (plan view; `recomputeTargets`
  = ONLY runtime writer of `profile.target*`, sums raw macros × qty and rounds once, matching
  seed `computeTargets`; template mutations all end in recompute), `lib/memory.ts` (facts
  CRUD, oldest-first), `lib/errors.ts` (**ValidationError→400, NotFoundError→404 — routes
  map by instanceof, never message text**; owner decision superseding the plan's regex).
- **REST** — `PATCH /api/profile`; `POST /api/meals`, `PATCH/DELETE /api/meals/[id]`,
  `PUT /api/meals/[id]/items` with `scope: "today" | "template"` (today = `setMealOverride`,
  the chat ⇄ engine, ≥1 item; template = `replaceMealItems` + target re-derivation returned
  as `{old, next}` for the recalc banner); `GET/POST /api/memory-facts`,
  `PATCH/DELETE /api/memory-facts/[id]`. No auth in routes (proxy gates).
- **UX contracts** — meal edit defaults to "Just today" (auto-reverts tomorrow, ⇄ marker);
  every-day shows old→new targets banner; memory delete = immediate + 5s undo snackbar
  (undo re-POSTs content; clear-all restores the whole batch); profile inputs 16px (iOS
  zoom), NaN pre-checked client-side (JSON turns NaN→null = silent clears otherwise).
- **Test infra** — suite 102/102 (19 files); `vitest.config.ts` sets
  `fileParallelism: false`: profile/meals are live shared singletons and parallel files race
  (profile snapshot/restore vs system-prompt double-read). Sentinels: `zz test plan
  2099-06-06` meal, `zz-test-memory-2099:` prefix.
- **Hardening from review gates** — setMealOverride now 404s unknown meals (was raw FK 500);
  stale-editingId guard after in-flight saves; undo res.ok gate + re-arm; clearAll in-flight
  guard; try/catch(+finally) on every client fetch. Known accepted quirks: editing a
  ⇄-adjusted meal seeds from the TEMPLATE (override-aware seeding ticketed); `var(--surface)`
  undefined app-wide (plan CSS uses literal #fff; global fix ticketed).

## Chat deviation copilot (2026-07-08..10) — DEPLOYED to prod, owner-accepted (phone pass ✓)

The chat's core mission delivered: when the owner is off-plan (traveling, nothing prepped,
eating out), Kal finds real macros, adapts **today's plan only**, and logs reality — cheaply.
Spec: `docs/superpowers/specs/2026-07-08-chat-deviation-copilot-design.md`; plan (12 tasks,
executed via Sonnet worker subagents under a Fable orchestrator, per-task independent reviews):
`docs/superpowers/plans/2026-07-08-chat-deviation-copilot.md`. Suite 56/56 → **89/89** (16 files).

- **Schema (migration 0005, APPLIED):** `meal_overrides` (date, meal_id, food_id,
  quantity, write_batch_id) — rows replace a meal's template items FOR THAT DATE ONLY; no rows
  = template; tomorrow auto-reverts. `foods.one_off boolean` — off-plan foods live in `foods`
  (macros resolve via resolveItem) but are hidden from the Groceries screen.
- **Knowledge ladder (system-prompt rules + 3 new tools):** 1) `search_nutrition` (USDA+OFF,
  wraps lib/nutrition-lookup) → 2) owner-provided source: `fetch_page` (lib/fetch-page.ts —
  html→text, 20k cap, SSRF guard incl. post-redirect re-check; bot-walls return honest errors)
  or a photo → 3) clearly-labeled estimate, explicit yes required BEFORE any write, saved with
  `is_estimated=true` + `one_off=true`. Never-invent-serving-size stays absolute for plan foods.
- **Day-scoped overlay:** `lib/overrides.ts` (setMealOverride last-write-wins, getOverridesForDate)
  + `override_meal` tool; `getTodayView` renders override items + `adjusted` flag (⇄ accent
  marker on the row + popup, aria-hidden with spoken label); mark-eaten fills gaps from the
  override; `revertWriteBatch` also deletes override rows. Targets untouched on deviation days.
- **Prompt caching:** system prompt split into a static block (persona/rules/template/memory,
  cache_control) + dynamic block (today's numbers/statuses/adjusted meals); rolling cache mark
  on the last message; tools prefix cached. Verified live: turn-2 cache_read 4,344 tokens, cost
  $0.0057 → $0.0009; full 3-turn deviation conversation **~$0.03**. Static block byte-stability
  under override writes is test-asserted.
- **Photos in chat:** owner-picked "+" outside the composer → popover (Take photo /
  Photo library via two hidden inputs, `capture="environment"` vs plain); ≤1024px client
  downscale (`app/image-scale.ts`, extracted from Groceries); route accepts image block first
  in the user turn (jpeg/png/webp, 6M-char cap, message-or-image); Haiku vision read a test
  image live. Popover closes/disables during send; corrupt files get an error bubble.
- **Two E2E-only bugs found live and fixed deterministically** (two full conversation rounds,
  zero residue): (1) model guessed a food_id for override_meal because log_food's result
  didn't return the created id — result now carries `foodId` + guessed-id ban in rules/tool
  description; (2) replacement logged without meal_id got re-logged by gap-fill — override-
  scoped dedupe now counts unattached same-day logs of override foods (locked invariant #1
  holds). Final whole-branch review: READY TO MERGE, no Critical/Important.
- **Process artifacts:** per-task briefs/reports/review diffs + progress ledger in
  `.superpowers/sdd/` (git-ignored). Mockups: `design/deviation-adjusted-meal.html`,
  `design/chat-photo-attach.html` (owner-picked C variants, one revision round each).
- **Follow-ups filed:** #12 undo leaves one-off foods; #13 fetch_page hardening bundle;
  #14 parked spend-tracking idea. #3 (prompt caching) + #11 (feature record) closed.

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

## Groceries "my serving" display (2026-07-07) — DEPLOYED to prod

Cards show macros at the owner's own serving instead of the 100 g/1-unit basis. Spec:
`docs/superpowers/specs/2026-07-07-groceries-serving-display-design.md`; plan (all 8 tasks
executed): `docs/superpowers/plans/2026-07-07-groceries-serving-display.md`; owner-approved
mockup: `design/groceries-serving-display.html`.

- **Data**: `foods.display_qty numeric(8,3)` (migration `0004`, APPLIED) — a multiplier of the
  serving basis, same convention as `meal_items.quantity`; null = 1. DISPLAY-ONLY: never feeds
  targets, plan lines, or tools (verified: prompt unchanged). Live pre-fill via
  `db/apply-display-qty.ts` (idempotent): chicken 1.7, rice 4, veg 2.5, peanuts 0.4, PB 2;
  `Egg, large` → **Large Eggs** (real rename; `apply-seed-v2.ts` RENAMES map knows it).
- **Lib**: `lib/serving-display.ts` (+6 tests) — `servingDisplay(food)` → title (", cooked"
  stripped), oz-first label (`6 oz (170 g)` via the exported `ozHint`), macros via `resolveItem`
  (never hand-scaled), and the flip: cooked↔uncooked for gram foods with a yield (macros
  identical), my-serving↔1-unit for count foods with qty>1 (macros scale). `GroceryView` gained
  `servingDesc`/`rawToCookedYield`/`displayQty` (null→1); REST accepts `displayQty` (400 if ≤0).
- **Card**: store LOGOS (`public/stores/{walmart,costco}.svg`, matched case-insensitively from
  `foods.store`, plain-text fallback; gated by the auth proxy like everything — serves fine
  logged-in). Serving is a tappable dotted-underline button (`.gcard-srv`); flip state is
  ephemeral client state keyed by food id (same food on two shelves flips together). `$/srv`
  scales to the displayed serving.
- **Form**: "My serving" row — weighed foods take g/oz (converted to the multiplier on save);
  count foods take a count with the basis unit shown. **Count-food edit fix**: the form no longer
  sends `servingGrams` for count foods (previously saving eggs/PB was impossible AND would have
  clobbered `"1 tbsp"` → `"x g"` via updateGrocery's servingDesc rewrite).
- **Seed**: `SeedFood.displayQty` in seed-data + both seed paths; **ground beef row deleted**
  from `FOODS_V2` (owner removed it 2026-07-07; a re-apply no longer resurrects it).

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
`APP_PASSWORD=<local-only value, see .env.local>`, `BLOB_READ_WRITE_TOKEN` (from the Blob store dashboard, not env).

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
— Groceries "my serving" display (2026-07-07) —
lib/serving-display.ts (+test)    servingDisplay() — card labels/flips/macros (via resolveItem)
db/apply-display-qty.ts           one-time live apply: Large Eggs rename + display_qty pre-fill
db/migrations/0004_*.sql          foods.display_qty (APPLIED to Neon)
public/stores/{walmart,costco}.svg   store logos (card meta row)
design/groceries-serving-display.html   owner-approved mockup (before/after + flips)
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
- **Groceries "my serving" display — DONE 2026-07-07, deployed to prod.** display_qty column,
  servingDisplay lib, store logos, tappable cooked↔raw / 2↔1-tbsp flips, Large Eggs rename,
  My-serving form field. Store-badge backlog requirement absorbed.
- **Phase 6 / v1.5+ — remaining deferrals:** prompt caching, inventory decrement,
  trends/weight-chart screen, chat history summarization.

## Open notes

- Vercel CLI is a bit behind (53.x → 54.x); upgrade optional: `npm i -g vercel@latest`.
- The `[est]/[label]` macro source is preserved in `db/seed.ts` for when `is_estimated` lands.
