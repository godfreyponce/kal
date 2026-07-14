---
description: Read a ticket and write its implementation plan to a file. Plans only — writes no code.
argument-hint: "[#N] (optional — defaults to STATE.md's next_action)"
---

Plan one ticket. **You will not write any implementation code in this session.**

## Which ticket

`$ARGUMENTS` names the issue if it's set. Otherwise read `next_action` from STATE.md's YAML head —
it leads with the issue number. Do **not** list the issues and pick for yourself; the owner has
already chosen, and re-deciding here burns context to arrive at an answer that was already given.

If `next_action` is empty and no argument was passed, stop and ask the owner which ticket.

## Plan it

1. `gh issue view N` — read the whole ticket, including comments (on this repo the real scoping
   often lives in the comment thread, not the body).
2. If the issue lacks a **Done when** section, say so and ask the owner before planning — an
   acceptance criterion you invent yourself is a guess, and you'll be graded against theirs.
3. Read **only** the files the ticket points at, plus what they force you to read. Resist a broad
   codebase tour; a plan written from a bloated context is a worse plan.
4. Use the `superpowers:writing-plans` skill. Save to `docs/superpowers/plans/YYYY-MM-DD-issue-N.md`.
5. If the ticket touches anything visual, the owner's standing rule applies: **3 HTML variants
   first**, owner picks, then the plan describes wiring the winner in.

## Then stop

Do not implement. Do not touch a source file. End by telling the owner:

- the path to the plan file,
- the one or two decisions in it most likely to be wrong,
- and that the next step is to review it, then `/clear` and run `/build-ticket N` in a fresh window.

That fresh window is the point: this session now holds the ticket, the code you explored, and the
plan. It is the *worst* context in which to write the code. The plan file is what survives; this
conversation is not.
