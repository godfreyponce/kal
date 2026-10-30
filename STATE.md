---
glass: kal
status: in-progress
last_worked_on: 2026-10-30
next_action: "none: no ticket is ready-for-agent outside the red-team track"
blocked_on: ""
phase: "v1 shipped; #41 chat tool-call evals (`npm run eval` scores the tool calls of both chat models on five seeded cases; runChatTurn and renderSystemPrompt split out of the live path) on main 2026-10-30, owner-accepted (first live eval run still owed, see Now); #80 Anthropic key read only behind server-only (getAnthropic moved to lib/anthropic-client.ts; a client import fails next build) on main 2026-10-27, owner-accepted (Console/Vercel key steps still owed, see Now); #10 real label macros for the eight estimated staples (label or USDA numbers on the existing basis, live rows written by db/apply-label-data.ts behind a name/serving guard, seed matches, targets left at 3712/175/400/146 until the next plan edit) on main 2026-10-27, owner-accepted; #64 chat on Opus 5.5 with adaptive thinking (low effort), Sonnet 5.5 fallback once cycle spend reaches SPEND_FALLBACK_USD, model shown in the chat header, label reading pinned to Haiku 4.5, on main 2026-10-26, owner-accepted (live Opus tool turn and SPEND_FALLBACK_USD still owed, see Now); #63 spend ledger (api_calls row per Anthropic call, cycle-to-date spend, scripts/spend.ts, Opus/Sonnet 5.5 prices) on main 2026-10-26, owner-accepted (real tool-turn check still owed, see Now); #81 today test allows an empty plan meal (owner chose the test over deleting Snack) on main 2026-10-26; #44 add_grocery records estimated macros (tool flag + off-plan ladder line; duplicates left to #57) on main 2026-10-09, owner-accepted; #47 design variants committed + linked from their issue (AGENTS.md Visual rule; #29 and #9 variants backfilled) on main 2026-10-09, owner-accepted; #50 phone-width screenshot pass (Playwright script + AGENTS.md gate-2 line) on main 2026-08-08, owner-accepted; #9 groceries estimated-macro provenance (tilde + editor source flip) on main 2026-07-28, owner-accepted from the desktop pass (phone pass still owed — the tilde is a small glyph on an 8.5px browse pill and was never read on a phone); #29 groceries read-first label card + per-value pad on main 2026-07-27, owner-accepted from the desktop pass (phone pass still owed — macro pills are 10px type in a 9px pill and were never thumb-tested); #30 calendar streak visual + pressable days with per-day popup on main 2026-07-27, owner-accepted from the desktop pass (phone pass still owed — press weight and popup placement at phone width were never checked, and the local DB had no on-plan day so the lit flame and an on-plan popup are unseen); #31 day-detail grabber handle + X removal on main 2026-07-26, owner phone-passed; owner phone/browser pass CLEARED the whole #32-#36 + #18 + #26 backlog 2026-07-25, incl. the deployed-prod pass — all passed, no levers needed; #37 orphan cleanup on main 2026-07-25; #36 Plan collapse Meal/Memory bands on main 2026-07-24 (silent-menu rollout complete); #35 Plan silent-menu restyle on main 2026-07-23; #34 Chat silent-menu restyle on main 2026-07-23; #33 Login silent-menu restyle on main 2026-07-23; #32 Today silent-menu restyle on main 2026-07-22; #28 silent-menu rollout closed 2026-07-21 (design-only umbrella: cream canvas stays, tickets #32-#36 spawned); #27 copy sweep on main 2026-07-21; #26 adherence press feel + history pill on main 2026-07-20; groceries browse face rework (#1) on main + owner phone-passed 2026-07-20; ⇄ edit chooser (#18) on main 2026-07-17; #2 prod config live-verified 2026-07-18"
---

# Kal — Project State

Personal, single-user fitness chat PWA. A Claude-powered assistant that knows the owner's
profile, meal plan, and daily log, and reads/writes that log via server-side tools. Frontend
talks only to `POST /api/chat` + REST routes (swappable brain).

*Thin snapshot. `next_action` above names the ticket that is up now — start there.
Archive: `docs/HISTORY.md`. Queue: GitHub Issues (`gh issue list`). Protocol: `AGENTS.md`.*

## Now

*Unaccepted work only. Anything the owner has accepted belongs in `docs/HISTORY.md`, not here.*

- Owner hygiene: delete the Rodin uploads, cancel the $6 Creator plan; optionally dashboard-delete
  the #2 test blob `groceries/200dd72a-1e47-4ba8-a1f5-22cdd2f19fb7.png` from kal-photos.
- #63 owner checks: confirm `api_calls` exists on prod's DB (migrated 2026-10-25 via `.env.local`'s
  `DATABASE_URL`); set `SPEND_CYCLE_START_DAY` in Vercel + `.env.local`; after the first prod tool
  turn, `npx tsx scripts/spend.ts` must show one call per stream. Local `ANTHROPIC_API_KEY` is `""`.
- #64 owner checks: set `SPEND_FALLBACK_USD` in Vercel (Production) and `.env.local`, below the
  spend limit of the workspace that holds `claude-kal` if it has one (unset means Sonnet); then on
  prod send one message that logs two foods and a follow-up: both answer and the header says Opus.
- #80 owner steps: Kal workspace with a spend limit in the credit-linked Console org; auto-reload
  off; new key into Vercel Production with `vercel env add` (never `env pull`); one prod chat
  message answers; then revoke the old key if it lives in another org.
- #41 owner check: set a real `ANTHROPIC_API_KEY` in `.env.local`, run `npm run eval` once, and
  keep the output as the first baseline (it bills real calls on both models).

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
- `vercel redeploy <url>` errors "Deployment belongs to a different team" unless run with
  `--scope godfreyps-projects` (`vercel env` commands don't need it).
- Any page reading live DB or the current day MUST `export const dynamic = "force-dynamic"`
  (Next 16 prerenders static by default; invisible in dev; build route table: `/` must be `ƒ`).
- After editing `globals.css`, Turbopack dev serves STALE CSS — `rm -rf .next`, restart, hard-refresh.
- Phone-testing an authed page (e.g. `/plan`) over Tailscale needs **HTTPS**, not the bare
  `http://<tailscale-IP>:3100`: Next **dev** silently fails to hydrate on an insecure (non-localhost)
  origin — client JS dead, inputs/buttons frozen, no console error — and Next **prod** sets the
  session cookie `Secure` (`lib/session.ts`), so it's dropped over plain HTTP → login loops back.
  Fix: `npm run build && PORT=3100 npx next start -p 3100`, then `tailscale serve --bg http://127.0.0.1:3100`
  and open the `https://<host>.ts.net` URL. Tear down: `tailscale serve --https=443 off`.
- `db/seed.ts`'s PROFILE block is the reset-path profile only (owner hand-edited); the live
  profile row differs — reconcile with the owner before touching either.
- Next 16: `middleware`→`proxy`, `params` is a Promise; neon-http has no interactive txns;
  Haiku rejects `thinking`/`effort` params; integration tests need per-file sentinel dates AND
  run sequentially (vitest.config.ts) — live-DB singleton state races under file parallelism.
- Routes map errors by type (`ValidationError`→400, `NotFoundError`→404 from lib/errors.ts) —
  never by message text.
- Any test file that (transitively) imports the DB must have `import "../db/env";` as its FIRST
  line — the commit gate runs `npm test` with no `DATABASE_URL`, so `db/index.ts` throws otherwise
  (bit #6: a "pure" unit test importing `lib/adherence.ts` pulled in `../db`). 12 test files do this.
- This repo is PUBLIC (recruiter-visible) — no env values, credentials, or owner personal data
  in committed files or issues.
