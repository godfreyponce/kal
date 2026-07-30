# usage

Four screens and a password page. Everything is mobile-first and meant to live on a phone
home screen.

## login

One password, set by `APP_PASSWORD`. The page says "You shall not pass" because there is
nothing here for anyone but me.

## today

The day at a glance: a calorie ring with remaining kcal, macro bars, and the meal
checklist from my plan. Tap a meal and it is logged. Tap it again and it is not. Tapping
into a meal shows its items. Weigh-ins are logged from this screen too.

## chat

Where off-plan days get handled. I tell Kal what I am about to eat, it resolves real
macros, rewrites the rest of today to fit, and logs what actually happened. The plan
template is never touched.

Every database write shows up as a tool card with an Undo button that reverts the whole
write. A stat strip keeps what is left of today in view, and the header shows the model
and the running cost of the conversation. You can attach a photo of a nutrition label and
it reads the macros off it. The chat keeps its last 30 messages and forgets the rest.

## plan

The plan template, and how I am doing against it. A 3D figure you can drag to rotate
(streamed from a private blob store), the weekly adherence strip, an adherence history
calendar, and the weight trend chart. Days in the calendar open a detail view.

## groceries

The grocery library the numbers come from: products I actually buy, with label macros,
one photo each, kcal and protein pills, grouped into shelf bands by meal. New items land
here when the chat calls `add_grocery`.
