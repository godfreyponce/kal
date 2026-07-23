---
glass: kal
status: in-progress
last_worked_on: 2026-07-23
next_action: "#35 — Plan restyle in the silent-menu language (spec design/plan-silent-menu-combined.html; /plan-ticket 35; needs ready-for-agent green-light before build)"
blocked_on: ""
phase: "v1 shipped; #34 Chat silent-menu restyle on main 2026-07-23; #33 Login silent-menu restyle on main 2026-07-23; #32 Today silent-menu restyle on main 2026-07-22 (rollout continues: #35 Plan); #28 silent-menu rollout closed 2026-07-21 (design-only umbrella: cream canvas stays, tickets #32-#36 spawned); #27 copy sweep on main 2026-07-21; #26 adherence press feel + history pill on main 2026-07-20; groceries browse face rework (#1) on main + owner phone-passed 2026-07-20; ⇄ edit chooser (#18) on main 2026-07-17; #2 prod config live-verified 2026-07-18; deployed-prod phone-verify pending"
---

# Kal — Project State

Personal, single-user fitness chat PWA. A Claude-powered assistant that knows the owner's
profile, meal plan, and daily log, and reads/writes that log via server-side tools. Frontend
talks only to `POST /api/chat` + REST routes (swappable brain).

*Thin snapshot. `next_action` above names the ticket that is up now — start there.
Archive: `docs/HISTORY.md`. Queue: GitHub Issues (`gh issue list`). Protocol: `AGENTS.md`.*

## Now

*Unaccepted work only. Anything the owner has accepted belongs in `docs/HISTORY.md`, not here.*

- Owner visual pass of the restyled Today (#32, accepted at gate 2 from the diff, no browser
  check yet): compare `/` against `design/today-silent-menu-combined.html` (`rm -rf .next`
  first, stale-CSS gotcha); glance at reduced-motion (stagger fully off) and the current
  meal's red checkbox ring. Plan's header must still be serif (ac92726 restored it).
- Owner phone-verify of **deployed** prod `/plan` — everything to date has passed on local prod
  builds over Tailscale (#6/#22 on 2026-07-15; #23/#24 incl. the #25 scrim fix on 2026-07-17)
  but the deployed-prod pass is still outstanding. Login now takes the same password as local
  (#2 synced it).
- Owner in-app pass of the #18 ⇄ edit chooser (plan Step 6 deferred at gate 2) — glance at the
  cancel link's left alignment while there.
- Owner phone pass of #26 (accepted at gate 2 without it): bubble press feel on the day cells,
  and the history grabber's ~12px hit target (under reduced-motion the pill is the ONLY way into
  history — the pull gesture is off). Levers if either disappoints, in order: 26px pill padding
  (margin-top 3px / padding 14px 0 8px, pill optically unmoved), `touch-action: manipulation` on
  `.cell`, then the plan's JS `.pressing` contingency (docs/superpowers/plans/2026-07-20-issue-26.md).
- Owner hygiene: delete the Rodin uploads, cancel the $6 Creator plan; optionally dashboard-delete
  the #2 test blob `groceries/200dd72a-1e47-4ba8-a1f5-22cdd2f19fb7.png` from kal-photos.

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
