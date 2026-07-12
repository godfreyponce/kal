# Kal — Project State

Personal, single-user fitness chat PWA. A Claude-powered assistant that knows the owner's
profile, meal plan, and daily log, and reads/writes that log via server-side tools. Frontend
talks only to `POST /api/chat` + REST routes (swappable brain).

*Thin snapshot — update continuously as work progresses. Full build archive, file map, and
per-feature detail: `docs/HISTORY.md`. Work queue: GitHub Issues (`gh issue list`). Protocol:
`AGENTS.md`. Original spec: `~/.claude/plans/okay-so-i-have-zesty-nova.md`.*

**Last updated: 2026-07-12**

## Now

- **Plan screen (#5) Phase 2 — ACCEPTED, MERGED to main 2026-07-12; NOT deployed** (deploy
  on owner go; Phase 1 also still undeployed — one deploy covers both). 3D mannequin island
  + region editor cards + weight-trend chart + macros-dim. Detail: docs/HISTORY.md.
  Chart-polish follow-ups: #20. **Phase 3 IN PROGRESS (owner green-lit 2026-07-12):**
  photo → 3D model via external image-to-3D service — service being researched/proposed;
  exact photos must be confirmed with the owner BEFORE any upload; GLB goes to PRIVATE
  Vercel Blob, never the repo.
- **Chat deviation copilot — DONE, deployed to prod, owner phone pass ✓** (kal-delta.vercel.app).
- **v1 SHIPPED, prod live**; owner phone-verification of the 2026-07-07 Groceries "my serving"
  cards still pending.
- **Next up:** the work queue is GitHub Issues. `ready-for-agent` label = owner green-lit;
  unlabeled = confirm with the owner first.

## Run / verify (do this first)

```bash
PORT=3100 npm run dev    # :3000 is taken by another local project ("Glass")
npm test                 # vitest; needs DATABASE_URL (hits live Neon)
npx tsc --noEmit         # must stay clean
```

## Gotchas (short form — full detail in docs/HISTORY.md)

- `npm run db:seed` is a FULL WIPE — for live data use `npx tsx db/apply-seed-v2.ts` (idempotent).
- NEVER `vercel env pull` into `.env.local` — encrypted vars come back as `""` and break local
  login. Pull to a temp file and copy individual keys.
- Any page reading live DB or the current day MUST `export const dynamic = "force-dynamic"`
  (Next 16 prerenders static by default; invisible in dev; build route table: `/` must be `ƒ`).
- After editing `globals.css`, Turbopack dev serves STALE CSS — `rm -rf .next`, restart, hard-refresh.
- `db/seed.ts`'s PROFILE block is the reset-path profile only (owner hand-edited); the live
  profile row differs — reconcile with the owner before touching either.
- Next 16: `middleware`→`proxy`, `params` is a Promise; neon-http has no interactive txns;
  Haiku rejects `thinking`/`effort` params; integration tests need per-file sentinel dates AND
  run sequentially (vitest.config.ts) — live-DB singleton state races under file parallelism.
- Routes map errors by type (`ValidationError`→400, `NotFoundError`→404 from lib/errors.ts) —
  never by message text. `var(--surface)` is consumed app-wide but UNDEFINED (issue filed).
- This repo is PUBLIC (recruiter-visible) — no env values, credentials, or owner personal data
  in committed files or issues.
