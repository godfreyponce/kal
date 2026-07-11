# Kal — Project State

Personal, single-user fitness chat PWA. A Claude-powered assistant that knows the owner's
profile, meal plan, and daily log, and reads/writes that log via server-side tools. Frontend
talks only to `POST /api/chat` + REST routes (swappable brain).

*Thin snapshot — update continuously as work progresses. Full build archive, file map, and
per-feature detail: `docs/HISTORY.md`. Work queue: GitHub Issues (`gh issue list`). Protocol:
`AGENTS.md`. Original spec: `~/.claude/plans/okay-so-i-have-zesty-nova.md`.*

**Last updated: 2026-07-10**

## Now

- **Chat deviation copilot — DONE, owner-accepted 2026-07-10, MERGED to main; NOT yet
  deployed** (deploy on owner's go — prod still runs the 2026-07-07 build). Off-plan knowledge
  ladder (search_nutrition → fetch_page/photo → confirmed estimate), day-scoped `meal_overrides`
  (⇄ marker on Today, template untouched, undoable), chat photo attach, prompt caching
  (~$0.03 per 3-turn conversation). Suite 89/89 (16 files), `tsc` clean, migration 0005 applied.
  Detail: docs/HISTORY.md. Closed #3 + #11; follow-ups #12 #13; parked idea #14.
- **v1 SHIPPED, prod live** at https://kal-delta.vercel.app (Vercel project `kal`); owner
  phone-verification of the 2026-07-07 Groceries "my serving" cards still pending.
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
  Haiku rejects `thinking`/`effort` params; integration tests need per-file sentinel dates.
- This repo is PUBLIC (recruiter-visible) — no env values, credentials, or owner personal data
  in committed files or issues.
