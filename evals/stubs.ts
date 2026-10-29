// Stateful stand-ins for lib/tools.ts runTool. Each returns the same forModel JSON shape and
// error strings as its live case, and writes only to its own in-memory state, never to the DB.
// Only pure modules and type-only imports here: the eval must not reach db/index.ts.
// When a live tool changes its matching or its result shape (#57 will), change its stub too.
import type { DaySummary } from "../lib/day-summary";
import type { SetMealStatusResult } from "../lib/meal-status";
import type { OverrideLine } from "../lib/overrides";
import { formatMacros, formatPlanLine, resolveItem, sumResolved, type FoodBasis } from "../lib/resolve-item";
import type { PromptContext } from "../lib/system-prompt";
import type { Macros, ToolRun } from "../lib/tools";
import { toGrams, weightToServings } from "../lib/units";
import type { EvalContext, FoodRow } from "./fixture";

export type StubOverrides = Partial<Record<string, (input: Record<string, unknown>) => unknown>>;

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const round2 = (x: number) => Number(x.toFixed(2));

const basis = (f: FoodRow): FoodBasis & { servingGrams: number | null } => ({
  name: f.name,
  servingDesc: f.servingDesc,
  servingGrams: f.servingGrams === null ? null : Number(f.servingGrams),
  kcal: f.kcal,
  proteinG: Number(f.proteinG),
  carbsG: Number(f.carbsG),
  fatG: Number(f.fatG),
  rawToCookedYield: f.rawToCookedYield === null ? null : Number(f.rawToCookedYield),
});

export function createStubTools(ctx: EvalContext, date: string, overrides: StubOverrides = {}) {
  const foods = [...ctx.foods];
  const targets = ctx.prompt.summary.targets;
  const consumed: Macros = { ...ctx.prompt.summary.consumed };
  const statuses = new Map(ctx.prompt.statuses.map((s) => [s.mealId, s.status]));
  const memoryFacts = [...ctx.prompt.memoryFacts];
  const mealOverrides = new Map(ctx.prompt.overrides);
  let nextFoodId = 1000;
  let nextFactId = 1000;
  let nextBatch = 1;

  const summary = (): DaySummary => ({
    date,
    targets,
    consumed: { ...consumed },
    remaining: {
      kcal: targets.kcal - consumed.kcal,
      proteinG: round2(targets.proteinG - consumed.proteinG),
      carbsG: round2(targets.carbsG - consumed.carbsG),
      fatG: round2(targets.fatG - consumed.fatG),
    },
  });

  const addConsumed = (per: FoodBasis, qty: number) => {
    const kcal = Math.round(per.kcal * qty);
    consumed.kcal += kcal;
    consumed.proteinG = round2(consumed.proteinG + per.proteinG * qty);
    consumed.carbsG = round2(consumed.carbsG + per.carbsG * qty);
    consumed.fatG = round2(consumed.fatG + per.fatG * qty);
    return kcal;
  };

  const ok = (result: unknown, extra: Partial<ToolRun> = {}): ToolRun => ({
    forModel: JSON.stringify(result),
    summary: "",
    writeBatchId: null,
    ...extra,
  });
  const err = (message: string): ToolRun => ok({ error: message });
  const batch = () => `eval-batch-${nextBatch++}`;
  const foodById = (id: number) => foods.find((f) => f.id === id);

  function run(name: string, input: Record<string, unknown>): ToolRun {
    switch (name) {
      case "get_day_summary": {
        const s = { ...summary(), date: str(input.date) ?? date };
        return ok(s, { remaining: s.remaining });
      }

      case "search_foods": {
        const query = (str(input.query) ?? "").toLowerCase();
        return ok(foods.filter((f) => f.name.toLowerCase().includes(query)).slice(0, 10));
      }

      case "log_food": {
        let foodId: number;
        let per: FoodBasis;
        let servingGrams: number | null = null;
        const foodIdInput = num(input.food_id);
        if (foodIdInput !== undefined) {
          const f = foodById(foodIdInput);
          if (!f) return err(`No food with id ${foodIdInput}`);
          ({ servingGrams, ...per } = basis(f));
          foodId = f.id;
        } else {
          const name2 = str(input.name);
          const kcal = num(input.kcal);
          if (!name2 || kcal === undefined) {
            return err("Provide food_id, or name plus per-serving kcal (and macros).");
          }
          per = {
            name: name2,
            servingDesc: str(input.serving_desc) ?? "1 serving",
            kcal,
            proteinG: num(input.protein_g) ?? 0,
            carbsG: num(input.carbs_g) ?? 0,
            fatG: num(input.fat_g) ?? 0,
          };
          foodId = nextFoodId++;
          foods.push({
            ...ctx.foods[0],
            id: foodId,
            name: name2,
            servingDesc: per.servingDesc,
            kcal: Math.round(kcal),
            proteinG: per.proteinG.toFixed(2),
            carbsG: per.carbsG.toFixed(2),
            fatG: per.fatG.toFixed(2),
            servingGrams: null,
            rawToCookedYield: null,
            isEstimated: input.is_estimated === true,
            oneOff: input.one_off === true,
          });
        }

        const ozInput = num(input.oz);
        const gramsInput = num(input.grams);
        let qty: number;
        let weightLabel: string | null = null;
        if (ozInput !== undefined || gramsInput !== undefined) {
          if (servingGrams === null) {
            return err(`${per.name} has no serving weight set — add its grams in Groceries first.`);
          }
          const grams = ozInput !== undefined ? toGrams(ozInput, "oz") : gramsInput!;
          qty = weightToServings(grams, servingGrams);
          weightLabel = ozInput !== undefined ? `${ozInput} oz` : `${gramsInput} g`;
        } else {
          qty = num(input.quantity) ?? 1;
        }

        const kcal = addConsumed(per, qty);
        const writeBatchId = batch();
        const amount = weightLabel ?? resolveItem(qty, per).amountLabel;
        return ok({ logged: { foodId, name: per.name, amount, kcal }, writeBatchId }, { writeBatchId });
      }

      case "set_meal_status": {
        const mealId = num(input.meal_id);
        const status = str(input.status) as SetMealStatusResult["status"] | undefined;
        if (mealId === undefined || !status) return err("meal_id and status are required.");
        if (status === "pending") {
          statuses.delete(mealId);
          return ok({ status, writeBatchId: null, loggedFoodIds: [] } satisfies SetMealStatusResult);
        }
        const writeBatchId = batch();
        statuses.set(mealId, status);
        const loggedFoodIds: number[] = [];
        if (status === "eaten") {
          const planned =
            mealOverrides.get(mealId)?.map((l) => ({ foodId: l.foodId, quantity: l.quantity })) ??
            ctx.prompt.items
              .filter((it) => it.mealId === mealId)
              .map((it) => ({
                foodId: foods.find((f) => f.name === it.foodName)!.id,
                quantity: Number(it.quantity),
              }));
          for (const p of planned) {
            addConsumed(basis(foodById(p.foodId)!), p.quantity);
            loggedFoodIds.push(p.foodId);
          }
        }
        return ok({ status, writeBatchId, loggedFoodIds } satisfies SetMealStatusResult, { writeBatchId });
      }

      case "override_meal": {
        const mealId = num(input.meal_id);
        const rawItems = Array.isArray(input.items) ? input.items : null;
        if (mealId === undefined || !rawItems || rawItems.length === 0) {
          return err("meal_id and a non-empty items array are required.");
        }
        const items: { foodId: number; quantity: number }[] = [];
        for (const raw of rawItems) {
          if (typeof raw !== "object" || raw === null) {
            return err("Each item needs a food_id and a positive quantity.");
          }
          const o = raw as Record<string, unknown>;
          const foodId = num(o.food_id);
          const quantity = num(o.quantity);
          if (foodId === undefined || quantity === undefined || quantity <= 0) {
            return err("Each item needs a food_id and a positive quantity.");
          }
          items.push({ foodId, quantity });
        }
        const meal = ctx.prompt.meals.find((m) => m.id === mealId);
        if (!meal) return err(`No meal with id ${mealId}`);
        const missing = items.find((it) => !foodById(it.foodId));
        if (missing) return err(`No food with id ${missing.foodId}`);

        const lines: OverrideLine[] = items.map((it) => {
          const { name, ...rest } = basis(foodById(it.foodId)!);
          return {
            foodId: it.foodId,
            quantity: it.quantity,
            food: { name, ...rest, rawToCookedYield: rest.rawToCookedYield ?? null },
          };
        });
        mealOverrides.set(mealId, lines);
        const resolved = lines.map((l) => resolveItem(l.quantity, l.food));
        return ok(
          {
            adjusted: meal.name,
            date: str(input.date) ?? date,
            lines: resolved.map((r, i) => formatPlanLine(r, lines[i].food.name)),
            total: formatMacros(sumResolved(resolved)),
          },
          { writeBatchId: batch() },
        );
      }

      case "add_grocery": {
        const name2 = str(input.name);
        const servingGrams = num(input.serving_grams);
        const kcal = num(input.kcal);
        if (!name2 || servingGrams === undefined || kcal === undefined) {
          return err("name, serving_grams, and kcal are required.");
        }
        const id = nextFoodId++;
        foods.push({
          ...ctx.foods[0],
          id,
          name: name2,
          brand: str(input.brand) ?? null,
          servingDesc: `${servingGrams} g`,
          servingGrams: servingGrams.toFixed(2),
          kcal: Math.round(kcal),
          proteinG: (num(input.protein_g) ?? 0).toFixed(2),
          carbsG: (num(input.carbs_g) ?? 0).toFixed(2),
          fatG: (num(input.fat_g) ?? 0).toFixed(2),
          rawToCookedYield: null,
          isEstimated: input.is_estimated === true,
          oneOff: false,
        });
        return ok({ id, name: name2 });
      }

      case "add_memory_fact": {
        const content = str(input.content);
        if (!content) return err("content is required.");
        memoryFacts.push({ content });
        return ok({ id: nextFactId++, content });
      }

      case "log_weigh_in": {
        const weight = num(input.weight_lb);
        if (weight === undefined) return err("weight_lb is required.");
        return ok({ date: str(input.date) ?? date, weightLb: weight });
      }

      case "get_weight_trend": {
        const entries = ctx.prompt.weights
          .map((w) => ({ date: w.date, weightLb: Number(w.weightLb) }))
          .reverse();
        if (entries.length === 0) return ok({ entries: [], message: "No weigh-ins in window." });
        return ok({ latest: entries[entries.length - 1], count: entries.length, entries });
      }

      case "search_nutrition":
        return ok({ hits: [] });

      case "fetch_page":
        return err("fetch_page is not available in the eval.");

      default:
        return err(`Unknown tool: ${name}`);
    }
  }

  return {
    async runTool(name: string, input: Record<string, unknown>): Promise<ToolRun> {
      const override = overrides[name];
      return override ? ok(override(input)) : run(name, input);
    },
    promptContext(): PromptContext {
      return {
        ...ctx.prompt,
        summary: summary(),
        statuses: [...statuses].map(([mealId, status]) => ({ mealId, status })),
        memoryFacts: [...memoryFacts],
        overrides: new Map(mealOverrides),
      };
    },
  };
}
