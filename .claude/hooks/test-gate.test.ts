// DB-free: runs the hook in a temp git repo with `npx`/`npm` stubbed, so the real suite never starts.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hookPath = path.join(__dirname, "test-gate.sh");
let tmp: string;
let stub: string;
let repo: string;
let suiteLog: string;

function sh(script: string) {
  const r = spawnSync("sh", ["-c", script], { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`setup failed: ${script}\n${r.stderr}`);
}

beforeAll(() => {
  tmp = fs.mkdtempSync(os.tmpdir() + "/test-gate-");
  stub = path.join(tmp, "stub");
  repo = path.join(tmp, "repo");
  suiteLog = path.join(tmp, "suite.log");
  fs.mkdirSync(stub);
  fs.mkdirSync(repo);
  for (const name of ["npx", "npm"]) {
    const p = path.join(stub, name);
    fs.writeFileSync(p, `#!/bin/sh\necho "$0 $*" >> "${suiteLog}"\nexit 1\n`);
    fs.chmodSync(p, 0o755);
  }
  sh(
    "git init -q && echo a > STATE.md && echo a > x.ts && git add . && " +
      "git -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -qm init",
  );
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function runHook(setup: string, command: string) {
  sh(`git reset -q --hard && git clean -qfd${setup ? ` && ${setup}` : ""}`);
  fs.rmSync(suiteLog, { force: true });
  const r = spawnSync("bash", [hookPath], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
    env: { ...process.env, PATH: `${stub}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: repo },
  });
  const suiteRan = fs.existsSync(suiteLog);
  let denied = false;
  if (r.stdout.trim()) {
    denied = JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === "deny";
  }
  return { suiteRan, denied };
}

const heredocCommit = `git commit -m "$(cat <<'EOF'
fix: don't

Co-Authored-By: x
EOF
)"`;

describe("test-gate hook", () => {
  it.each([
    ["code staged in the same call", "echo y >> x.ts", 'git add x.ts && git commit -m "fix"', true],
    ["doc staged in the same call", "echo y >> STATE.md", 'git add STATE.md && git commit -m "docs"', false],
    ["git add -A in the same call", "echo y >> x.ts", 'git add -A && git commit -m "fix"', true],
    ["git rm in the same call", "", 'git rm x.ts && git commit -m "rm"', true],
    ["quoted path in git add", "echo y >> x.ts", 'git add "x.ts" && git commit -m "fix"', true],
    ["code staged earlier", "echo y >> x.ts && git add x.ts", 'git commit -m "fix"', true],
    ["heredoc commit message", "echo y >> x.ts && git add x.ts", heredocCommit, true],
    ["printf that quotes git commit", "echo y >> x.ts && git add x.ts", `printf '%s\\n' "ran git commit" >> ledger.md`, false],
    ["&& inside a quoted string", "echo y >> x.ts && git add x.ts", 'echo "x && git commit -m y"', false],
    ['" inside single quotes before a commit', "echo y >> x.ts && git add x.ts", `echo 'say "hi' && git commit -m "c"`, true],
    ["quoted VAR= prefix", "echo y >> x.ts && git add x.ts", 'GIT_AUTHOR_DATE="2026-01-01 10:00" git commit -m x', true],
    ["commit after then", "echo y >> x.ts && git add x.ts", "if true; then git commit -m x; fi", true],
    ["add and commit in braces", "echo y >> x.ts", "{ git add x.ts; git commit -m x; }", true],
    ["commit after env", "echo y >> x.ts && git add x.ts", "env FOO=1 git commit -m x", true],
  ])("%s", (_name, setup, command, expected) => {
    const { suiteRan, denied } = runHook(setup, command);
    expect(suiteRan).toBe(expected);
    expect(denied).toBe(suiteRan);
  });
});
