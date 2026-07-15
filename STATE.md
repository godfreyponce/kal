---
glass: kal
status: in-progress
last_worked_on: 2026-07-14
next_action: "#6 — weekly adherence module on /plan"
blocked_on: "nothing — design + spec approved 2026-07-14; next is /plan-ticket #6 (gate 1)"
phase: "v1 shipped; /plan deployed to prod"
---

# Kal — Project State

Personal, single-user fitness chat PWA. A Claude-powered assistant that knows the owner's
profile, meal plan, and daily log, and reads/writes that log via server-side tools. Frontend
talks only to `POST /api/chat` + REST routes (swappable brain).

*Thin snapshot. `next_action` above names the ticket that is up now — start there.
Archive: `docs/HISTORY.md`. Queue: GitHub Issues (`gh issue list`). Protocol: `AGENTS.md`.*

## Now

*Unaccepted work only. Anything the owner has accepted belongs in `docs/HISTORY.md`, not here.*

- **#6 — weekly adherence on /plan. Design + spec APPROVED 2026-07-14; not built.** Next step:
  `/plan-ticket #6` (fresh session → gate 1). Spec:
  `docs/superpowers/specs/2026-07-14-weekly-adherence-design.md`. Visual ref:
  `design/plan-adherence-final.html`. Final scope (evolved past the issue's original re-scope
  note): "X/7 days on plan" over a **fixed Monday→Sunday calendar week** (NOT a rolling 7 days);
  day rule = kcal ±10% AND protein ≥90%; unlogged past day = off-plan; today shown live/unjudged,
  days ahead blank; denominator always 7, resets Monday. Shape: pure `lib/adherence.ts`
  (`judgeDay`/`weekDays`/`classifyWeek` + thin `getWeekAdherence`) + a **server** component on
  /plan (CSS-only hover) between Profile and Meal plan. Follow-ons filed: #22 (mobile tap sheet),
  #23 (swipe-up calendar).
- Owner phone-verify of prod `/plan` — still outstanding.
- Owner phone-verify of the 2026-07-07 Groceries "my serving" cards — still outstanding.
- Owner hygiene: delete the Rodin uploads, cancel the $6 Creator plan.

## Run / verify (do this first)

```bash
PORT=3100 npm run dev    # :3000 is taken by another local project ("Glass")
npm test                 # vitest; needs DATABASE_URL (hits live Neon)
npx tsc --noEmit         # must stay clean
```

## Gotchas (things that would still bite you today)

- `npm run db:seed` is a FULL WIPE — for live data use `npx tsx db/apply-seed-v2.ts` (idempotent).
- NEVER `vercel env pull` into `.env.local` — encrypted vars come back as `""` and break local
  login. Pull to a temp file and copy individual keys. ⚠️ `vercel blob create-store` (and other
  store-connect flows) run this pull IMPLICITLY and rewrote `.env.local` (bit 2026-07-12: wiped
  4 local secrets + rebound BLOB_READ_WRITE_TOKEN to the new store). Never run store-connect
  commands from the linked dir without backing up `.env.local` first.
- Blob stores: `kal-photos` (public; grocery images; prod uses OIDC + BLOB_STORE_ID) and
  `kal-private` (owner model; token env `MODEL_BLOB_READ_WRITE_TOKEN`, prod+dev — preview
  binding skipped, unused). `BLOB_READ_WRITE_TOKEN` no longer exists anywhere; the old local
  kal-photos token was lost (regenerate via dashboard if local grocery uploads are ever needed).
- Any page reading live DB or the current day MUST `export const dynamic = "force-dynamic"`
  (Next 16 prerenders static by default; invisible in dev; build route table: `/` must be `ƒ`).
- After editing `globals.css`, Turbopack dev serves STALE CSS — `rm -rf .next`, restart, hard-refresh.
- `db/seed.ts`'s PROFILE block is the reset-path profile only (owner hand-edited); the live
  profile row differs — reconcile with the owner before touching either.
- Next 16: `middleware`→`proxy`, `params` is a Promise; neon-http has no interactive txns;
  Haiku rejects `thinking`/`effort` params; integration tests need per-file sentinel dates AND
  run sequentially (vitest.config.ts) — live-DB singleton state races under file parallelism.
- Routes map errors by type (`ValidationError`→400, `NotFoundError`→404 from lib/errors.ts) —
  never by message text.
- This repo is PUBLIC (recruiter-visible) — no env values, credentials, or owner personal data
  in committed files or issues.
