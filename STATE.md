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
  Chart-polish follow-ups: #20. **Phase 3 CODE COMPLETE on branch `plan-screen-phase3`,
  awaiting OWNER phone pass; NOT merged, NOT deployed.** Owner model (Rodin-generated,
  mid-thigh, clay, 630KB meshopt GLB) lives on the PRIVATE kal-private Blob store, streamed
  via GET /api/model; figure swaps it in with mannequin fallback on any failure (verified
  incl. forced-404 + delayed-load simulation). Suite 118/118. After acceptance: merge,
  HISTORY, close #5, remind owner to delete Rodin uploads + cancel the $6 plan. Texture
  hardening: #21.
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
  never by message text. `var(--surface)` is consumed app-wide but UNDEFINED (issue filed).
- This repo is PUBLIC (recruiter-visible) — no env values, credentials, or owner personal data
  in committed files or issues.
