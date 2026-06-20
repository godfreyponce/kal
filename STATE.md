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

## Current status: Phase 3 COMPLETE ✅ (Chat route)

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
```

---

## Roadmap (each phase ≈ its own session)

- **Phase 2 — REST + Today screen. DONE ✅** (see Current status above.)
- **Phase 3 — Chat route. DONE ✅** (see Current status above.)
- **Phase 4 — Chat UI (NEXT).** First 3 HTML variants for the Chat section. Then fresh-session chat,
  streaming render (consume the SSE `text`/`tool_use`/`tool_result`/`done` events), tool cards +
  batch Undo (needs an undo endpoint that reverts a `write_batch_id`).
- **Phase 5 — Auth + PWA.** Password gate (iron-session), manifest, icons, deploy to Vercel.
- **Phase 6 / v1.5+ — Phase 2 deferrals:** `is_estimated` flag, grocery-logging section, trends
  screen, history summarization.

## Open notes

- Vercel CLI is a bit behind (53.x → 54.x); upgrade optional: `npm i -g vercel@latest`.
- The `[est]/[label]` macro source is preserved in `db/seed.ts` for when `is_estimated` lands.
