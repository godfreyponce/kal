# Read STATE.md first, then check the issue queue

`STATE.md` is a **thin snapshot** of right-now state: what's mid-flight, how to run/verify,
and the gotchas that have already bitten. Read it before doing anything. The full build
archive, file map, and per-feature detail live in `docs/HISTORY.md`.

**The work queue is GitHub Issues** (`gh issue list`). The `ready-for-agent` label means the
owner has green-lit that item; anything unlabeled still needs owner confirmation before
starting. Reference issues in commits (`fixes #N`) so they close automatically.
⚠️ This repo is PUBLIC (recruiter-visible): write issues about features and architecture —
never env values, credentials, or the owner's personal data.

**Keep state current as you work, not as an end-of-session dump:**
- Update STATE.md's "Now" section when what's mid-flight changes; keep the file under ~40 lines.
- New work discovered mid-session → `gh issue create` immediately; don't let it live only in conversation.
- After a feature is built **and the owner confirms it's good**: close its issue, refresh
  STATE.md, add the feature's detail section to `docs/HISTORY.md`, and commit them alongside
  the feature. Don't record work the owner hasn't accepted yet.

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
