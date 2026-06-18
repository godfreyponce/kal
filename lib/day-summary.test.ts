import "../db/env";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { foods, logEntries } from "../db/schema";
import { getDaySummary } from "./day-summary";

// Integration test against the seeded Neon DB. Uses a sentinel date so it never
// collides with real "today" data. Verifies remaining = targets - consumed.
const TEST_DATE = "2099-01-01";

async function clearTestDate() {
  await db.delete(logEntries).where(eq(logEntries.date, TEST_DATE));
}

describe("getDaySummary (remaining macros)", () => {
  beforeEach(clearTestDate);
  afterAll(clearTestDate);

  it("returns remaining = targets when nothing is logged", async () => {
    const summary = await getDaySummary(TEST_DATE);
    expect(summary.consumed).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    expect(summary.remaining).toEqual(summary.targets);
  });

  it("subtracts logged macros from targets", async () => {
    const [food] = await db.select({ id: foods.id }).from(foods).limit(1);
    await db.insert(logEntries).values({
      date: TEST_DATE,
      foodId: food.id,
      quantity: "1",
      kcal: 500,
      proteinG: "40",
      carbsG: "60",
      fatG: "10",
      source: "user_ui",
    });

    const summary = await getDaySummary(TEST_DATE);
    expect(summary.consumed).toEqual({ kcal: 500, proteinG: 40, carbsG: 60, fatG: 10 });
    expect(summary.remaining.kcal).toBe(summary.targets.kcal - 500);
    expect(summary.remaining.proteinG).toBe(summary.targets.proteinG - 40);
    expect(summary.remaining.carbsG).toBe(summary.targets.carbsG - 60);
    expect(summary.remaining.fatG).toBe(summary.targets.fatG - 10);
  });
});
