# Read STATE.md first

`STATE.md` is the project's living memory. **Read its "⏩ NEW AGENT — START HERE" section
before doing anything** — it has the current status, how to run/verify, the backlog, and the
gotchas that have already bitten.

**Keep it current.** After you build a feature **and the owner confirms it's good**, update
`STATE.md` in the same change (bump *Last updated*, move the item out of the backlog, add/refresh
its section, adjust the roadmap) and commit it alongside the feature. Don't update it for work
the owner hasn't accepted yet.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
