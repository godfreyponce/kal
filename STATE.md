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

## Current status: Phase 1 COMPLETE ✅

Verified with passing tests (`npm test` → 5/5).

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
app/                 Next.js App Router (default scaffold so far)
```

---

## Roadmap (each phase ≈ its own session)

- **Phase 2 — REST + Today screen (NEXT).** Starts by generating an HTML file with **3 design
  variants for the Today screen** for the owner to pick (design preference: 3 variants/section
  before any React; lean on `minimalist-ui` skill). Then: log/status CRUD incl. fill-the-gaps
  `eaten`; Today UI (macro rings/bars, meal status chips, weigh-in quick-add). App must be fully
  useful with zero LLM. Verify: mark-eaten after a manual log does NOT double-count.
- **Phase 3 — Chat route.** System-prompt assembly (incl. memory facts), tool loop (max 8 iters),
  SSE streaming, persistence, batch-Undo ids. Tools: get_day_summary, log_food, set_meal_status,
  search_foods, log_weigh_in, get_weight_trend, add_memory_fact. Verify via curl.
- **Phase 4 — Chat UI.** First 3 HTML variants for the Chat section. Then fresh-session chat,
  streaming render, tool cards + batch Undo.
- **Phase 5 — Auth + PWA.** Password gate (iron-session), manifest, icons, deploy to Vercel.
- **Phase 6 / v1.5+ — Phase 2 deferrals:** `is_estimated` flag, grocery-logging section, trends
  screen, history summarization.

## Open notes

- Vercel CLI is a bit behind (53.x → 54.x); upgrade optional: `npm i -g vercel@latest`.
- The `[est]/[label]` macro source is preserved in `db/seed.ts` for when `is_estimated` lands.
