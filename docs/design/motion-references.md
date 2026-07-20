# Motion & Feel — external references (research synthesis, 2026-07-15)

> Owner asked whether four external "skills" repos overlap our work — especially
> [`motion-and-feel.md`](./motion-and-feel.md) and the #24 bottom-sheet / drag-to-dismiss build.
> This is the captured comparison. Nothing here is adopted yet; the "Adopt" and "Proposed #24
> amendments" sections are recommendations for the owner to accept or reject.

## The four resources

| Resource | License | What it is | Relevance to us |
|---|---|---|---|
| **emilkowalski/skills** | MIT | Emil Kowalski (author of **Vaul** drawer + **Sonner**) — Claude Code skills encoding his UI-motion taste. Its `apple-design` skill translates Apple's "Designing Fluid Interfaces" to the web. | **Direct hit.** Confirms our spec's numbers and fills our gaps (momentum, interruptibility). |
| **taste-skill** (Leonxlnx) | MIT | Web *visual-taste* framework (anti-"AI-slop" React/Tailwind/Motion). | **Low for #24.** No native gesture / bottom-sheet content — explicitly defers native to "Apple HIG / Material directly". Process ideas only. |
| **impeccable** (pbakaus) | Apache-2.0 | Design-QA rule engine (46 deterministic detectors + LLM rulebook) for AI-built frontends. | **Medium.** A review *checklist* source; one collision to know about (below). |
| **mobbin.com** | commercial | Paid, login-gated gallery of real-app screenshots/flows. No API, no motion timing. | **Reference-shopping only.** "Find a native-feeling app there, then feel it live." Not a source of numbers. |

## Our spec vs. the references (the comparison)

Our tokens are from `motion-and-feel.md` + the #24 plan. Verdicts are Emil's repo unless noted
(it's the only one with real gesture/sheet physics).

| Our token | Verdict | Their value / note |
|---|---|---|
| Enter curve `cubic-bezier(.32,.72,.33,1)` | ✅ **near-exact** | Emil's iOS drawer curve `cubic-bezier(0.32, 0.72, 0, 1)` — same first two control points; third is 0 vs our .33. |
| Enter spring stiffness 380 / damping 30 | ◻︎ different units | Emil parametrizes sheets as Apple **damping 0.8 / response 0.3** (`apple-design`). Not directly convertible without the library's formula; it's a cross-check, not a contradiction. |
| Exit `cubic-bezier(.4,0,1,1)` ~.18–.22s | ⚠️ **rule differs** | Emil says exits should also be *ease-out*, never ease-in-shaped. Ours is an ease-in (accelerate) exit. Duration is fine (his drawer floor is 200ms). Worth a deliberate choice, not an accident. |
| Press `scale(.97)` | ✅ **exact** | `scale(0.97)` in Emil; `0.95→1` in impeccable. (Duration: ours 90ms is below Emil's 100–160ms / Apple's 100ms — slightly snappier than both.) |
| Dismiss = flick **or** >35% drag | ✅ logic / ◻︎ numbers | Same OR-gate: `swipeAmount >= THRESHOLD \|\| velocity > 0.11` (px/ms). No repo gives a **percentage** threshold, so our 35% is unvalidated but reasonable. |
| Rubber-band factor **0.55** | ✅ **exact + we get the code** | Emil ships the real iOS formula with `constant = 0.55`. Drop-in (see Adopt #1). |
| Scrim opacity coupled to position | ◻︎ silent on numbers | Only qualitative ("dim + push back parent layers"). Our spec is *more* specific here. |
| Reduced-motion fade ~.15s | ✅ pattern / ⚠️ duration | Emil's **sheet-specific** rule: `transition: opacity 200ms ease; transform: none !important;` — 200ms vs our 150ms. Reconcile. |
| Enter translate 12–28px | ⚠️ **wrong unit for a sheet** | Emil prefers `translateY(100%)` (percentage) for drawers — "adapts to content, less error-prone." Our 12–28px token was written for popovers; a bottom sheet slides from **100% off-screen**, not a 12–28px nudge. See amendment. |

## Adopt (ranked) — concrete, cited, low-risk

1. **Emil's rubber-band formula, verbatim** (`apple-design/SKILL.md:150-153`):
   ```js
   const rubberband = (overshoot, dim, c = 0.55) => (overshoot * dim * c) / (dim + c * Math.abs(overshoot));
   ```
   Our spec already names 0.55; this is the actual function. Use it in #24's bounds resistance instead of hand-tuning.
2. **Interruptibility rules** (`apple-design` / `emil-design-eng`): on drag, `setPointerCapture`; animate from the *live presentation value* on interrupt, not the target; ignore extra touch points once a drag starts. Our spec has none of these — a drag-to-dismiss sheet feels broken without them regardless of correct curves. **These are must-haves for #24, not nice-to-haves.**
3. **Sheet-specific reduced-motion rule**: `transition: opacity 200ms ease; transform: none !important;` — more precise than our generic fade; decide 150 vs 200ms.
4. **Momentum-projection formula** (optional fidelity) `project(v, d=0.998) = (v/1000)*d/(1-d)` — decides *where* a flicked sheet lands before animating there; upgrades our binary flick-gate. Adopt only if the flick feels off without it.
5. **Gesture discoverability** (impeccable `interaction-design.md:177-185`): a swipe-dismiss surface needs a **visible affordance** (grabber handle) **and** a non-gesture fallback (a close button). Gap in our current #24 plan.
6. **Process, not #24-blocking** (taste-skill): a "motion must be motivated" gate + reduced-motion as a *mechanically-checked* acceptance criterion. Worth folding into our motion review checklist later.

## One collision to know about (impeccable)

If we ever run impeccable's detector on Kal:
- Its `bounce-easing` rule flags **any** `cubic-bezier` with y outside `[-0.1, 1.1]`. Our enter curve (y2 = 1) is **safe**. But a true overshoot spring expressed in **raw CSS** would trip it — express spring overshoot in JS, not a CSS keyframe.
- It flags CSS classes/keyframes literally **named** `spring|bounce|elastic|wobble|jiggle`. Our #24 `.sheet-*` namespace is fine — just don't name a keyframe `spring-in`.

## Proposed #24 plan amendments (for owner to green-light before `/build-ticket`)

**Resolved 2026-07-15:** owner chose **hand-rolled + Emil's iOS values**. Four changes folded into
`docs/superpowers/plans/2026-07-15-issue-24.md`: enter `cubic-bezier(0.32, 0.72, 0, 1)` (no overshoot),
exit ease-out `cubic-bezier(0.23, 1, 0.32, 1)`, reduced-motion fade 200ms, and `EXIT_MS`/exit-duration
matched at 240ms. Amendments B (translateY(100%)) and C (grabber + close button) were **already in the
plan**. The interruptibility + rubber-band-formula adoptions (Adopt 1-2 above) remain for the build session.

- **A. Keep hand-rolled, graft Emil's formulas** (see Decision A below). Add the rubber-band function + interruptibility rules to Task 3.
- **B. Fix the translate token**: sheet enters/exits via `translateY(100%)` (off-screen), not a 12–28px nudge. The 12–28px range stays valid for the *popover* origin, not the sheet.
- **C. Add a grabber handle + retain a tap-close affordance** (gesture discoverability).
- **D. Pick reduced-motion duration**: 150ms (our spec) or 200ms (Emil's sheet rule).
- **E. Decide the exit curve deliberately**: keep our ease-in accelerate exit, or switch to Emil's ease-out.

## Decision A — recommendation: **stay hand-rolled**

The research *strengthens* the plan's hand-rolled assumption. For a **single-detent** sheet (the V2 the
owner picked), you do not need a spring library:
- Open/close = a CSS transition with the Emil-confirmed drawer curve. No library.
- Drag = 1:1 transform tracking (trivial) + Emil's copy-paste rubber-band(0.55) at the top bound + the flick-or-threshold OR-gate.
- "Hand-rolled" here does **not** mean inventing physics — Emil documents every hard part as a drop-in formula.

A library (Vaul / Motion) buys real *interruptible mid-drag spring physics* — overkill for single-detent,
and Vaul is a React drawer *component* that would mean restructuring the modal, plus a new dependency in an
app that currently has none. Recommendation: **hand-rolled + graft Emil's formulas.** Owner's call.

Decision B (CSS isolation vs. reuse) is research-neutral — the plan's full-isolation choice stands.
