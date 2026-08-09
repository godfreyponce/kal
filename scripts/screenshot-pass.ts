import "../db/env";
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "playwright";

// Phone-width screenshot pass — visual evidence for UI tickets at gate 2.
//
// One-time setup:  npx playwright install chromium
// Run:             npx tsx scripts/screenshot-pass.ts
// Needs:           a server already running (default http://localhost:3100,
//                  override with BASE_URL) and APP_PASSWORD in .env.local.
// Output:          screenshots/<name>.png (gitignored — may show live data)
//
// Read-only by design: logs in through the normal /login form, then only
// VISITS pages. No chat sends, no log writes, no DB rows, no Anthropic calls.
// This is gate-2 evidence, not acceptance — the owner phone pass stays human.
//
// ⚠️ If a capture looks wrong after a globals.css edit, suspect Turbopack's
// stale-CSS gotcha: rm -rf .next, restart the dev server, re-run.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3100";
const OUT_DIR = "screenshots";

// "Calendar" lives on /plan — fullPage capture includes it.
const ROUTES = [
  { name: "today", path: "/" },
  { name: "groceries", path: "/groceries" },
  { name: "plan", path: "/plan" },
  { name: "chat", path: "/chat" },
];

async function main() {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    console.error("APP_PASSWORD is not set (check .env.local).");
    process.exit(1);
  }

  // Fail fast if nothing is listening — this script never starts a server.
  try {
    await fetch(BASE_URL, { redirect: "manual" });
  } catch {
    console.error(`No server at ${BASE_URL}. Start one first: PORT=3100 npm run dev`);
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();

    // Log in through the real form so the cookie is set by the normal flow.
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/`);

    for (const { name, path } of ROUTES) {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
      // Settle entrance animations (guess; bump if captures look mid-animation).
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true });
      console.log(`captured ${name}  ${BASE_URL}${path}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
