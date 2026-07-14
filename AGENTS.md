# STATE.md's head names the ticket. Start there.

`STATE.md` opens with a YAML head. **`next_action` names the issue that is up now** — go straight
to it. Do not read the issue list and decide for yourself what's important; the owner has already
decided, and that is what the field is for. Below the head, STATE.md is a thin snapshot: what's
mid-flight, how to run/verify, and the gotchas that have already bitten. The full build archive
and per-feature detail live in `docs/HISTORY.md`.

**The work queue is GitHub Issues** (`gh issue list`). The `ready-for-agent` label means the issue
has its four template sections filled in **and** the owner has green-lit it — that's the eligible
pool. `next_action` picks one out of it. Anything unlabeled still needs owner confirmation before
starting. Reference issues in commits (`refs #N`).
⚠️ This repo is PUBLIC (recruiter-visible): write issues about features and architecture —
never env values, credentials, or the owner's personal data.

# One ticket = two sessions

Planning and building do not share a window. A context that has read the issue, explored the code,
and written a plan is a **poor context to then write the code in** — so the plan goes to a file and
a fresh session builds from it.

- **`/plan-ticket [#N]`** — read the ticket, write `docs/superpowers/plans/YYYY-MM-DD-issue-N.md`,
  stop. No code. The owner reads the plan (**gate 1** — cheap; nothing is built yet).
- `/clear`
- **`/build-ticket [#N]`** — build from the plan file, run the suite, **paste the real output**,
  stop before committing. The owner reads the diff (**gate 2**).
- On the owner's accept: commit, push, close the issue, `/clear`.

# STATE.md is written exactly once per ticket

**In the accept-commit, after the owner accepts. Never mid-session.**

Continuous updates are what makes this file drift and bloat, because a session writes it from a
context already full of its own work, and it ends up recording things the owner never accepted.
One write, at the seam:

- **Mid-session discoveries never touch STATE.md** → `gh issue create` immediately. The issue queue
  is the capture buffer (write anytime, cheap); STATE.md is the accepted-state snapshot (write once).
  Nothing is lost if a session dies — the plan file, the branch, and the issue all outlive it.
- **The accept-commit carries three things together:** the code, `STATE.md` (Now cleared of the
  finished item, `next_action` advanced to the next ticket, `last_worked_on` bumped), and the
  feature's section in `docs/HISTORY.md`. Then close the issue.
- **"Now" holds unaccepted work only.** The moment the owner accepts something it moves to
  `docs/HISTORY.md`. Keep "Now" under ~6 lines. Gotchas stay in STATE.md — they're the memory that
  earns its place — but a gotcha lives there only while it would still bite an agent working today.

# Session hygiene — keep the window lean (owner rule, 2026-07-12)

Target **≤140k tokens of working context per session.** This works because state lives
OUTSIDE the conversation: `STATE.md` (snapshot), GitHub Issues (queue), `docs/HISTORY.md`
(archive), `.superpowers/sdd/progress.md` (mid-build ledger). Suggest a fresh window at
natural seams — phase acceptance, plan approval, deploy — rather than letting a session
balloon; a decision that lives only in conversation memory doesn't exist, so write it to
the right file the moment it's made.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
