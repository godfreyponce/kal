# Plan Screen Phase 3 Implementation Plan — owner model swap-in

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development,
> Sonnet workers per owner cost policy (Fable orchestrates/reviews; escalate after 2
> failures on one task).

**Goal:** The "use my photos →" promise lands: the /plan figure loads the owner's generated
3D model from PRIVATE Vercel Blob and falls back to the procedural mannequin whenever the
model is absent or fails to load. Spec: Phase 3 of
`docs/superpowers/specs/2026-07-11-plan-screen-design.md`.

**The asset (already produced and owner-accepted, 2026-07-12):** a single-mesh GLB —
head to MID-THIGH (owner accepted the truncation; source photos were cropped), no
textures (rendered in the app's clay material by owner decision), 65k triangles,
position+normal only, KHR_mesh_quantization + EXT_meshopt_compression, **630 KB**.
It lives OUTSIDE the repo (owner-staged local file; path supplied at execution time —
never committed, never named in committed files; repo is public).

---

## Decisions most likely to change (review these first)

### D1. How the torso presents in the island
- **Chosen:** the model renders in the SAME clay material as the mannequin, scaled and
  positioned so its head-top matches the mannequin's head height and the mid-thigh cut
  sits around the mannequin's mid-thigh line; the blob shadow stays on the ground below —
  a deliberate "sculpture hovering over its shadow" read. Camera, controls target, polar
  clamps, idle rotation: all unchanged.
- **Alternatives:** a pedestal mesh under the cut (more furniture to design); torso-only
  close-up framing (breaks the height-rule and chip-rail geometry).
- **Cost to change later:** trivial — transform constants.

### D2. Region taps on a single mesh — y-band mapping, no mesh tint
- **Chosen:** raycast hit point's world y maps to regions by bbox bands (top ~15% = head,
  then chest, waist at the waistband, everything below = legs; thighs ARE the legs
  region). **No per-region emissive tint on the owner model** — it's one mesh/material,
  region tint would light the whole body; selection feedback = active chip + accent pin
  (already present). The mannequin keeps its existing per-part tint.
- **Alternatives:** whole-body tint on any selection (loses which-region feedback);
  vertex-color region painting (over-engineering for a tap affordance).
- **Cost to change later:** medium if true region tint is ever wanted (vertex work).

### D3. Chip/leader anchors on the model
- **Chosen:** four front-surface anchor Vector3s derived from the model's bbox bands
  (same regions as D2), replacing the mannequin's hand-placed anchors when the model is
  active. Projection/away-fade code unchanged — it consumes anchors, not geometry.
- **Cost to change later:** trivial — four constants.

### D4. Storage + serving — private Blob behind a streaming route
- **Chosen:** one-off committed script `scripts/upload-model.ts` (takes the GLB path as
  argv, uploads `put("model/figure.glb", { access: "private", allowOverwrite: true })`);
  new route `GET /api/model` streams the private blob via `get(..., { access: "private" })`
  (content-type `model/gltf-binary`, `Cache-Control: private, max-age=3600`), 404 when no
  blob exists. Auth comes free from the proxy gate like every route.
  **Auto-swap contract:** figure-canvas simply attempts `/api/model`; any failure
  (404, network, parse) → mannequin. No env flag, no DB column, no config.
- **Alternatives:** signed-URL redirect (exposes a time-limited direct URL; streaming is
  simpler and stays proxy-gated); public blob with unguessable URL (spec says private —
  body-derived asset); env-flag gating (duplicates state the blob's existence already has).
- **Cost to change later:** low — the route is ~30 lines.

### D5. Loader wiring (mechanical)
- GLTFLoader + MeshoptDecoder (`three/examples/jsm/libs/meshopt_decoder.module.js`)
  imported inside figure-canvas — already a client-only /plan chunk; quantization is
  core glTF, no extra decoder. Model load is lazy and non-blocking: mannequin builds
  first exactly as today, the model swaps in when (if) it arrives; swap disposes nothing
  of the mannequin permanently — keep the group so a later failure could re-show it
  (in practice swap-once is fine; keep the mannequin group detached, not disposed).

---

## Global constraints (house rules)

- Repo is PUBLIC: the GLB, the owner's photos, and their local paths never enter the
  repo, commits, issues, or this plan's committed text beyond what's written here.
- No schema changes. New route follows the typed-error house pattern; no auth checks in
  routes (proxy gates). Next 16: params is a Promise (unused here).
- `npx tsc --noEmit` clean; `npm run lint` zero new; `npm test` stays green (118/118 —
  no new vitest expected: route is curl-verified per house pattern, WebGL is
  browser-verified).
- Commit per green task (`refs #5`); never commit with a red suite.
- Dev on PORT=3100; BLOB_READ_WRITE_TOKEN exists in `.env.local` (local uploads);
  prod uploads use OIDC (see HISTORY Groceries §photos) — the upload script runs LOCALLY
  against the prod store with the local token.

---

### Task 1: upload script + `GET /api/model` streaming route

**Files:** create `scripts/upload-model.ts`, `app/api/model/route.ts`.

- Script: argv path → `put("model/figure.glb", stream, { access: "private", allowOverwrite: true, contentType: "model/gltf-binary" })`,
  prints the blob pathname; refuses to run without `BLOB_READ_WRITE_TOKEN`.
- Route: `get("model/figure.glb", { access: "private" })` → stream body + headers per D4;
  blob-missing → 404 `{ error: "no model uploaded" }` (typed-error pattern n/a — no user
  input to validate).
- Verify (curl): unauthenticated 401 (proxy); before upload → 404; run the script with
  the controller-supplied path; after upload → 200, `content-length` ≈ 630 KB,
  correct content-type; bytes identical to the source file (`curl -o | cmp`).
- Commit: `feat(plan): private-blob model hosting — upload script + streaming route (refs #5)`

### Task 2: figure-canvas swap-in

**Files:** modify `app/plan/figure-canvas.tsx` (+ small CSS only if needed).

- On scene init (after mannequin builds): fire the lazy model load (GLTFLoader +
  MeshoptDecoder). Success → clay-material override, transform per D1, detach mannequin
  group, attach model, switch raycast to D2 y-band mapping, switch anchors per D3.
  Any failure → console-silent fallback, mannequin stays, nothing else changes.
- Disposal: the loaded model's geometry/material join the cleanup inventory; the
  detached mannequin group still disposes as today. StrictMode-safe (load result
  ignored/disposed if the effect cleaned up first — guard with a token/flag).
- Verify: tsc/lint/suite; `npm run build` (/plan still ƒ; loader/decoder stay in the
  /plan client chunk); curl smoke (page 200). Interactive/visual verification is the
  controller's headless pass (Task 3) — worker does NOT drive a browser.
- Commit: `feat(plan): figure loads the owner model from private Blob, mannequin fallback (refs #5)`

### Task 3: integration wave (Fable, not a worker)

- Headless pass: model renders in the island (shape, scale, shadow), chip taps + y-band
  body taps select regions, leaders anchor to the model, 404-fallback path (temporarily
  rename the blob or point at a missing pathname) shows the mannequin, macros/editor
  regressions spot-check.
- Gates: suite, tsc, build. STATE.md update. Owner phone pass = acceptance gate.
- On acceptance: HISTORY.md entry, close ISSUE #5 (all three phases done), remind owner:
  delete the uploaded photo + asset from the Rodin account and cancel the Creator plan.
  Deploy remains a separate owner-go decision (ships Phases 1+2+3 together).

---

## Improvisation zones

- **Private-blob `get()` in the deployed runtime** — local token vs prod OIDC semantics;
  if `get()` misbehaves against the prod store from Vercel functions, fall back to
  `head()` + fetch with the token server-side; log what was chosen.
- **Transform constants (D1)** — expect 1-2 iterations against headless screenshots;
  conservative default: match head heights, center x/z on the controls target.
- **Meshopt decoder bundling** — if the module import bloats or misbehaves under
  Turbopack, use the sync `MeshoptDecoder` variant; note the choice.
- **Model bbox assumptions (D2/D3)** — bands assume a roughly person-shaped bbox; the
  worker must derive fractions from the LOADED bbox, not hardcoded world units.

## Verification (phase gate)

Suite green, tsc clean, `/plan` ƒ, headless pass incl. fallback path, then the owner's
phone pass: rotate their own figure, tap regions on the body, confirm chips/leaders track,
and confirm the mannequin returns if the model route 404s (controller demonstrates).
