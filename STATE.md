---
glass: kal
status: in-progress
last_worked_on: 2026-07-15
next_action: "none in ready-for-agent pool — owner to green-light next (open follow-ons: #24 mobile modal animation, #23 swipe-up calendar history; both unlabeled)"
blocked_on: "queue has no ready-for-agent items; #23 + #24 filed but unlabeled — owner to fill template + green-light before an agent starts"
phase: "v1 shipped; weekly-adherence (#6) + tap-a-day detail modal (#22) built & on main; deployed-prod phone-verify pending"
---

# Kal — Project State

Personal, single-user fitness chat PWA. A Claude-powered assistant that knows the owner's
profile, meal plan, and daily log, and reads/writes that log via server-side tools. Frontend
talks only to `POST /api/chat` + REST routes (swappable brain).

*Thin snapshot. `next_action` above names the ticket that is up now — start there.
Archive: `docs/HISTORY.md`. Queue: GitHub Issues (`gh issue list`). Protocol: `AGENTS.md`.*

## Now

*Unaccepted work only. Anything the owner has accepted belongs in `docs/HISTORY.md`, not here.*

- Owner phone-verify of **deployed** prod `/plan` — the weekly-adherence strip (#6) + the new
  tap-a-day detail modal (#22). Both got an owner phone pass on a local prod build over Tailscale
  (2026-07-15); the deployed-prod pass is still outstanding.
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
