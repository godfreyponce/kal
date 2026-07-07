import "./env";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { foods } from "./schema";

// ---------------------------------------------------------------------------
// One-time live-data apply for the "my serving" display feature (2026-07-07).
// Renames the eggs and sets display_qty on the five foods whose card serving
// differs from 1 × basis. Idempotent; touches nothing else.
// Run: npx tsx db/apply-display-qty.ts
// ---------------------------------------------------------------------------

const DISPLAY_QTY: Record<string, number> = {
  "Chicken breast, cooked": 1.7,
  "White rice, cooked": 4,
  "Frozen mixed vegetables, cooked": 2.5,
  "Dry-roasted peanuts, salted": 0.4,
  "Peanut butter": 2,
};

async function apply() {
  const renamed = await db
    .update(foods)
    .set({ name: "Large Eggs" })
    .where(eq(foods.name, "Egg, large"))
    .returning({ id: foods.id });
  for (const [name, qty] of Object.entries(DISPLAY_QTY)) {
    const rows = await db
      .update(foods)
      .set({ displayQty: String(qty) })
      .where(eq(foods.name, name))
      .returning({ id: foods.id });
    if (rows.length !== 1) throw new Error(`Expected exactly 1 live row named "${name}", got ${rows.length}`);
  }
  console.log(`Applied: eggs renamed (${renamed.length} row), display_qty set on 5 foods.`);
}

apply()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
