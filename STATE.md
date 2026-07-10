# Kal — Project State

Personal, single-user fitness chat PWA. A Claude-powered assistant that knows the owner's
profile, meal plan, and daily log, and reads/writes that log via server-side tools. Frontend
talks only to `POST /api/chat` + REST routes (swappable brain).

*Thin snapshot — update continuously as work progresses. Full build archive, file map, and
per-feature detail: `docs/HISTORY.md`. Work queue: GitHub Issues (`gh issue list`). Protocol:
`AGENTS.md`. Original spec: `~/.claude/plans/okay-so-i-have-zesty-nova.md`.*

**Last updated: 2026-07-10**

## Now

- **v1 SHIPPED + prod current** (verified 2026-07-07): https://kal-delta.vercel.app (Vercel
  project `kal`). Latest deploy: Groceries "my serving" display (`kal-c9rjd7xxt`, zero runtime
  errors over a 5-min log stream). Suite 56/56 (12 files), `tsc` clean. Owner phone-verification
  of the new Groceries cards still pending.
- **Mid-flight:** branch `deviation-copilot` has uncommitted work (`lib/tools.ts` +
  `lib/tools-deviation.test.ts`) from another session — don't clobber it.
- **Next up:** the backlog is GitHub Issues #1–#10 (filed 2026-07-10 from the old in-file
  backlog). `ready-for-agent` label = owner green-lit; unlabeled = confirm with the owner first.

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
