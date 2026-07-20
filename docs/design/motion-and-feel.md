# Kal — Motion & Feel

> The taste is the owner's; this doc is the executable version of it. Reusable template — for
> another project, keep the **qualities** and **structure**, re-tune the **tokens**.

## North star

Kal feels fluid and physically grounded — surfaces have weight and momentum. Nothing blinks in or
out. Elements **glide, scale, fade, and settle** into place, and animate **from where they came
from**. Soft spring-based motion, gentle easing, immediate feedback. Native to macOS / iOS.

## The qualities (what "right" feels like)

1. **Springy but controlled** — a touch of settle/overshoot; never bouncy or cartoonish.
2. **Fast response** — motion starts the instant you act (<~50ms); no dead delay.
3. **Soft finish** — decelerates into rest (ease-out / spring settle); never a hard stop.
4. **Shows origin** — enters from its source (tapped cell, thumbnail); exits back toward it.
5. **Subtle scale + opacity** — small transforms (a few %), paired with fade. Restraint over spectacle.
6. **Natural momentum** — draggable surfaces track the finger 1:1, respect velocity, rubber-band at bounds.
7. **Native feel** — matches iOS/macOS physics; interruptible, not a canned transition.

## Tokens (the implementable version)

| Motion | Spec |
|---|---|
| **Enter** | Spring settle w/ slight overshoot. `translateY(12–24px) scale(.97) → 0/1`, opacity `0→1`. Spring ≈ stiffness 380 / damping 30, or `~.34s cubic-bezier(.32,.72,.33,1)`. |
| **Exit** | Quicker, no overshoot, ease-in. `~.18–.22s cubic-bezier(.4,0,1,1)`, reverse of enter, opacity→0. |
| **Press feedback** | `scale(.97)` in ~90ms, spring back on release. Immediate. |
| **Scrim** | Opacity coupled to the surface's position/progress, not an independent timer. |
| **Gesture** (sheets/draggable) | Finger-tracks 1:1; **velocity flick** or **>~35% drag** dismisses, else **rubber-bands back**; past-bounds drag resists non-linearly (~0.55). |
| **Ranges** | Scale stays **0.94–1.0** (enter) / **0.97** (press); never below ~0.9 (reads as zoom). Translate **12–28px** — enough to read direction, not a slide-show. |
| **Reduced motion** | `prefers-reduced-motion` → drop all transform/spring; plain **opacity fade** (~.15s) only. Non-negotiable. |

## Do / Don't

- ✅ Animate from the source anchor. ❌ Fade in dead-center with no origin.
- ✅ Spring settle on enter. ❌ Fixed linear/ease that "reads like web."
- ✅ Small scale + fade together. ❌ Big scale, spin, or slide across the screen.
- ✅ Interruptible, finger-tracked drags. ❌ Canned transitions you can't grab mid-flight.
- ✅ Instant response to input. ❌ Delay before motion begins.

## Where it applies

- **Sheets / modals** — /plan day-detail modal (#24, first implementation); Today meal-popup only if
  we deliberately generalize the shared shell.
- **List items & food cards** — Groceries + anywhere food displays (#1); enter/settle on load, press feedback.
- **Feedback** — buttons, toggles, log/undo confirmations.
- **Transitions** — tab/section changes on /plan.
