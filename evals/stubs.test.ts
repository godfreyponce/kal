// DB-free: the stubs import only pure modules, so no `import "../db/env"` here.
import { describe, expect, it } from "vitest";
import { FIXTURE, FIXTURE_DATE } from "./fixture";
import { createStubTools } from "./stubs";

const parse = async (p: Promise<{ forModel: string }>) => JSON.parse((await p).forModel);
const food = (id: number) => FIXTURE.foods.find((f) => f.id === id)!;

describe("createStubTools", () => {
  it("search_foods is a phrase match like the live ilike", async () => {
    const { runTool } = createStubTools(FIXTURE, FIXTURE_DATE);
    const ids = async (query: string) =>
      ((await parse(runTool("search_foods", { query }))) as { id: number }[]).map((r) => r.id);

    expect(await ids("rice")).toEqual([2]);
    expect(await ids("WHITE RICE")).toEqual([2]);
    expect(await ids("cooked white rice")).toEqual([]);
  });

  it("log_food by grams moves the day summary", async () => {
    const stubs = createStubTools(FIXTURE, FIXTURE_DATE);
    await stubs.runTool("log_food", { food_id: 4, grams: 200 });
    const summary = await parse(stubs.runTool("get_day_summary", {}));

    const kcal = 2 * food(4).kcal;
    expect(summary.consumed.kcal).toBe(kcal);
    expect(summary.remaining.kcal).toBe(FIXTURE.prompt.summary.targets.kcal - kcal);
    expect(stubs.promptContext().summary.consumed.kcal).toBe(kcal);
    expect(stubs.promptContext().summary.remaining.kcal).toBe(summary.remaining.kcal);
  });

  it("log_food's new-food path makes a searchable food", async () => {
    const { runTool } = createStubTools(FIXTURE, FIXTURE_DATE);
    await runTool("log_food", { name: "Burrito bowl", kcal: 450 });
    const rows = (await parse(runTool("search_foods", { query: "burrito" }))) as { id: number }[];

    expect(rows).toHaveLength(1);
    expect(FIXTURE.foods.map((f) => f.id)).not.toContain(rows[0].id);
  });

  it("set_meal_status eaten logs the meal's plan items", async () => {
    const stubs = createStubTools(FIXTURE, FIXTURE_DATE);
    await stubs.runTool("set_meal_status", { meal_id: 3, status: "eaten" });

    expect(stubs.promptContext().summary.consumed.kcal).toBe(food(3).kcal + food(6).kcal);
    expect(stubs.promptContext().statuses).toContainEqual({ mealId: 3, status: "eaten" });
  });

  it("unknown tools return an error result", async () => {
    const { runTool } = createStubTools(FIXTURE, FIXTURE_DATE);
    expect(await parse(runTool("nope", {}))).toEqual({ error: "Unknown tool: nope" });
  });
});
