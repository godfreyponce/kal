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

# The `if` filter in settings.json still runs this hook on any command with `$VAR`, `$()`, or
# backticks, and quoted text can name `git commit` without running it. So strip quoted strings
# (in one pass, so whichever quote opens first wins, as in the shell), split into subcommands,
# and act only when one of them starts with `git commit`.
SEGMENTS_JQ='.tool_input.command // ""
  | gsub("\"(\\\\.|[^\"\\\\])*\"|\\x27[^\\x27]*\\x27"; "QUOTED")
  | gsub("&&|\\|\\||[;|&()`\n]"; "\n")
  | split("\n")[]
  | sub("^\\s+"; "")'
SEGMENTS=$(printf '%s' "$INPUT" | jq -r "$SEGMENTS_JQ")
ENV_PREFIX='^((then|else|do|[{!]|env|command|time)[[:space:]]+|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
if ! printf '%s\n' "$SEGMENTS" | grep -Eq "${ENV_PREFIX}git[[:space:]]+commit([[:space:]]|$)"; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

# Which files will this commit actually touch? Staged, plus — if -a/--all was passed —
# every modified tracked file, since those get swept in at commit time and would otherwise
# sail past a staged-only check.
FILES=$(git diff --cached --name-only)
if printf '%s' "$COMMAND" | grep -Eq 'git commit[^;&|]*(-[a-zA-Z]*a|--all)'; then
  FILES=$(printf '%s\n%s' "$FILES" "$(git diff --name-only)")
fi

# This hook runs before the command, so a `git add` in this same call is not in the index yet.
# Count its words as staged paths. A word that is not a `.md` path (a flag, `.`, a directory,
# QUOTED) runs the suite on purpose: a wrong guess should cost a suite run, not a red commit.
SAME_CALL=$(printf '%s\n' "$SEGMENTS" \
  | sed -nE "s/${ENV_PREFIX}git[[:space:]]+(add|rm|mv)([[:space:]]+|$)//p" \
  | tr -s ' \t' '\n\n' \
  | grep -vx -- '--' || true)
FILES=$(printf '%s\n%s' "$FILES" "$SAME_CALL")

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
