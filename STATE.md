# Kal — Project State

Personal, single-user fitness chat PWA (formerly "MacroChat"). A Claude-powered assistant
that knows the owner's profile, meal plan, and daily log, and reads/writes that log via
server-side tools. Frontend talks only to `POST /api/chat` + REST routes (swappable brain).

**Full build plan/spec:** `~/.claude/plans/okay-so-i-have-zesty-nova.md` (the source of truth;
this file is the quick-resume summary).

---

## Stack

- Next.js **16** (App Router) — note: newer than the spec's "15"; read
  `node_modules/next/dist/docs/` before writing routes/UI (its `AGENTS.md` flags breaking changes).
- Neon Postgres + Drizzle ORM (driver: `@neondatabase/serverless`)
- Tailwind CSS v4, TypeScript, Vitest
- Anthropic API (model TBD; cheapest-capable principle, env `ANTHROPIC_MODEL`, default Haiku) — not wired yet
- Deploys to Vercel project `kal` (Phase 5)

## Key v1 design decisions (locked)

1. **Mark-meal-"eaten" fills the gaps** — `set_meal_status('eaten')` auto-logs only planned
   items not already logged for `(date, meal_id)`. Never double-counts.
2. **Chat is ephemeral** — fresh `session_id` per chat open; no browsable threads. DB is the memory.
3. **Lean memory** = small editable `memory_facts` list the assistant writes to; injected per chat.
4. **`todayInAppTz()`** (America/Chicago) is the ONLY source of "today" — never raw `new Date()`.
5. **Batch-aware Undo** — write tools share a `write_batch_id`; Undo reverts the whole batch.
6. **Deferred to Phase 2:** `is_estimated` provenance flag on foods; grocery-logging section.

---

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

Env lives in `.env.local` (git-ignored, pulled from Vercel). Standalone scripts load it via
`db/env.ts`. To re-pull: `vercel env pull .env.local --yes`.

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
```

---

## Roadmap (each phase ≈ its own session)

- **Phase 2 — REST + Today screen. DONE ✅** (see Current status above.)
- **Phase 3 — Chat route. DONE ✅** (see Current status above.)
- **Phase 4 — Chat UI. DONE ✅** (see Current status above.)
- **Phase 5 — Auth + PWA + deploy. DONE ✅ (v1 shipped).** Live at https://kal-delta.vercel.app.
- **Phase 6 / v1.5+ — Phase 2 deferrals:** `is_estimated` flag, grocery-logging section, trends
  screen, history summarization.

## Open notes

- Vercel CLI is a bit behind (53.x → 54.x); upgrade optional: `npm i -g vercel@latest`.
- The `[est]/[label]` macro source is preserved in `db/seed.ts` for when `is_estimated` lands.
