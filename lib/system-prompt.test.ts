import "../db/env";
import { describe, it, expect, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { foods, mealOverrides, meals } from "../db/schema";
import { setMealOverride } from "./overrides";
import { assembleSystemPrompt } from "./system-prompt";

const DATE = "2099-07-07"; // own sentinel — parallel test files

afterAll(async () => {
  await db.delete(mealOverrides).where(eq(mealOverrides.date, DATE));
});

it("splits static (cacheable) and dynamic (per-day) content", async () => {
  const { staticText, dynamicText } = await assembleSystemPrompt(DATE);
  expect(staticText).toContain("MEAL PLAN TEMPLATE");
  expect(staticText).toContain("Rules:");
  expect(staticText).not.toContain(DATE); // nothing date-bound in the cacheable block
  expect(dynamicText).toContain(`TODAY (${DATE})`);
  expect(dynamicText).toContain("MEAL STATUS TODAY:");
  expect(dynamicText).toContain("remaining");
});

it("keeps staticText byte-identical across calls; overrides render only dynamically", async () => {
  const before = await assembleSystemPrompt(DATE);
  const [f] = await db.select().from(foods).orderBy(asc(foods.id)).limit(1);
  const [m] = await db.select().from(meals).orderBy(asc(meals.sortOrder)).limit(1);
  await setMealOverride(DATE, m.id, [{ foodId: f.id, quantity: 1 }]);
  const after = await assembleSystemPrompt(DATE);
  expect(after.staticText).toBe(before.staticText); // cache never busted by an override
  expect(after.dynamicText).toContain("ADJUSTED MEALS");
  expect(after.dynamicText).toContain(f.name);
});
