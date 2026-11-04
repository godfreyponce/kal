/**
 * Red-team demo (issue #38): brute-forces the Kal login with a wordlist.
 *
 * This is a self-owned tool aimed at a LOCAL dev server, and it never sees the
 * real password — its whole point is to show the "before" (unbounded 401s) and
 * the "after" (429s once the limiter lands). Run it, add the limiter, run it
 * again. That before/after pair is the demo.
 *
 *   npx tsx scripts/redteam/login-guesser.ts
 *   TARGET=http://127.0.0.1:3100/api/auth/login ATTEMPTS=40 npx tsx scripts/redteam/login-guesser.ts
 */

const TARGET = process.env.TARGET ?? "http://127.0.0.1:3100/api/auth/login";
const ATTEMPTS = Number(process.env.ATTEMPTS ?? 40);

// A tiny "wordlist". None of these is the real password — that's the point.
const WORDS = [
  "password", "123456", "letmein", "admin", "kal", "fitness", "hunter2",
  "qwerty", "changeme", "welcome", "secret", "root", "test", "iloveyou",
];

function guessFor(i: number): string {
  return i < WORDS.length ? WORDS[i] : `guess-${i}`;
}

async function main() {
  console.log(`[guesser] target=${TARGET} attempts=${ATTEMPTS}`);
  const start = Date.now();
  const counts: Record<number, number> = {};
  let firstBlockedAt = -1;

  for (let i = 0; i < ATTEMPTS; i++) {
    let status = 0;
    try {
      const res = await fetch(TARGET, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: guessFor(i) }),
      });
      status = res.status;
    } catch (err) {
      console.log(`[guesser] attempt ${i + 1}: request failed (${(err as Error).message})`);
      continue;
    }
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === 429 && firstBlockedAt === -1) firstBlockedAt = i + 1;
    const tag = status === 429 ? "  <-- BLOCKED" : "";
    console.log(`[guesser] attempt ${String(i + 1).padStart(3)}: HTTP ${status}${tag}`);
  }

  const elapsed = (Date.now() - start) / 1000;
  const rate = (ATTEMPTS / elapsed).toFixed(1);
  console.log("\n[guesser] --- summary ---");
  console.log(`[guesser] status counts: ${JSON.stringify(counts)}`);
  console.log(`[guesser] ${ATTEMPTS} attempts in ${elapsed.toFixed(2)}s (${rate}/s)`);
  if (firstBlockedAt === -1) {
    console.log("[guesser] NEVER blocked — the endpoint took every guess. (this is the 'before')");
  } else {
    console.log(`[guesser] first 429 at attempt ${firstBlockedAt} — the limiter is working. (this is the 'after')`);
  }
}

main();
