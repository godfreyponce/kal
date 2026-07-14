#!/usr/bin/env bash
# Blocks `git commit` when the suite is red.
#
# Skills ask the model to run tests; the model can decline. This does not.
# Wired as a PreToolUse hook on Bash in .claude/settings.json.
#
# Doc-only commits (STATE.md / HISTORY.md / plans) skip the suite — they carry no runtime risk
# and the accept-commit shouldn't pay 60s of live-Neon latency to say so.

set -uo pipefail

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')

# The `if` field in settings.json should already have narrowed this to git commit.
# Re-check anyway: the matcher fires on every Bash call, and a hook that guesses wrong here
# either blocks unrelated commands or lets a red commit through.
case "$COMMAND" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

# Which files will this commit actually touch? Staged, plus — if -a/--all was passed —
# every modified tracked file, since those get swept in at commit time and would otherwise
# sail past a staged-only check.
FILES=$(git diff --cached --name-only)
if printf '%s' "$COMMAND" | grep -Eq 'git commit[^;&|]*(-[a-zA-Z]*a|--all)'; then
  FILES=$(printf '%s\n%s' "$FILES" "$(git diff --name-only)")
fi

CODE_FILES=$(printf '%s\n' "$FILES" | grep -v '^[[:space:]]*$' | grep -v '\.md$' || true)
if [ -z "$CODE_FILES" ]; then
  exit 0
fi

OUTPUT=$( { npx tsc --noEmit && npm test; } 2>&1 )
STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  exit 0
fi

# Deny the commit and hand the failure back to the model, which then has to fix it.
# Tail the output — a full vitest dump would swamp the context this is trying to protect.
REASON=$(printf '%s' "$OUTPUT" | tail -n 80)

jq -n --arg out "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: ("Commit blocked: `npx tsc --noEmit && npm test` is red. Fix it, then commit again.\n\n" + $out)
  }
}'
exit 0
