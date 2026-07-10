import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gte, ilike } from "drizzle-orm";
import { db } from "../db";
import { foods, logEntries, meals, memoryFacts, weighIns } from "../db/schema";
import { getDaySummary } from "./day-summary";
import { setMealStatus, type MealStatusValue } from "./meal-status";
import { todayInAppTz } from "./time";
import { createGrocery } from "./groceries";
import { toGrams, weightToServings } from "./units";
import { resolveItem } from "./resolve-item";
import { fetchPage } from "./fetch-page";
import { searchNutrition } from "./nutrition-lookup";
import { setMealOverride, type OverrideItemInput } from "./overrides";

// The assistant's server-side tool surface. Inputs use snake_case (LLM-friendly);
// every tool defaults its `date` to today-in-app-tz. Write tools return a
// write_batch_id where one exists, so a chat Undo card can revert the batch.
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_day_summary",
    description:
      "Get target, consumed, and remaining macros (kcal/protein/carbs/fat) for a day. Use this before advising on what's left to eat. Never invent these numbers.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
      },
    },
  },
  {
    name: "search_foods",
    description:
      "Search the food library by name. Returns matching foods with their per-serving macros and ids. Use to find a food_id before logging.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of a food name." },
      },
      required: ["query"],
    },
  },
  {
    name: "log_food",
    description:
      "Log a food to the day's intake. Prefer absolute amounts: pass food_id with grams or oz for weighed foods (the food must have a serving weight set), or quantity for counted/volume foods (eggs, slices, tbsp — quantity means how many of the food's serving unit, e.g. 2 slices). Never guess a serving size: the amount must come from the user or the plan context. Alternatively pass name plus per-serving kcal/protein_g/carbs_g/fat_g to log (and add to the library) a new food. Optionally attach to a meal_id.",
    input_schema: {
      type: "object",
      properties: {
        food_id: { type: "integer", description: "Id of an existing library food." },
        name: { type: "string", description: "Name for a new free-form food (with macros below)." },
        quantity: { type: "number", description: "Servings eaten. Defaults to 1." },
        oz: { type: "number", description: "Amount eaten in ounces (weight-based logging; needs an existing food_id with a serving weight)." },
        grams: { type: "number", description: "Amount eaten in grams (weight-based logging; needs an existing food_id with a serving weight)." },
        meal_id: { type: "integer", description: "Optional meal to attach this entry to." },
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        kcal: { type: "number", description: "Per-serving calories (new food only)." },
        protein_g: { type: "number", description: "Per-serving protein grams (new food only)." },
        carbs_g: { type: "number", description: "Per-serving carb grams (new food only)." },
        fat_g: { type: "number", description: "Per-serving fat grams (new food only)." },
        serving_desc: { type: "string", description: "Serving description for a new food, e.g. '1 cup'." },
        is_estimated: {
          type: "boolean",
          description:
            "New food only: true when the macros are your estimate rather than a label or database hit.",
        },
        one_off: {
          type: "boolean",
          description:
            "New food only: true for off-plan one-offs (restaurant/travel food) so they don't appear in the Groceries screen.",
        },
      },
    },
  },
  {
    name: "add_grocery",
    description:
      "Add a real grocery item to the owner's library (the source of truth) from its label. Use when the owner ate something not yet in the library: ask for the brand and the label's nutrition facts (serving size in grams + per-serving macros), then call this, then log_food by weight. Never invent macros.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Food name." },
        brand: { type: "string", description: "Brand, if known." },
        store: { type: "string", description: "Where it was bought, e.g. Walmart." },
        link: { type: "string", description: "Optional product/label URL." },
        category: { type: "string", description: "Optional tag: protein, oil, seasoning, supplement, etc." },
        serving_grams: { type: "number", description: "Grams in one label serving." },
        kcal: { type: "number", description: "Calories per serving." },
        protein_g: { type: "number", description: "Protein grams per serving." },
        carbs_g: { type: "number", description: "Carb grams per serving." },
        fat_g: { type: "number", description: "Fat grams per serving." },
        purchase_weight_g: { type: "number", description: "Optional total package weight in grams." },
        price: { type: "number", description: "Optional price paid (USD)." },
      },
      required: ["name", "serving_grams", "kcal"],
    },
  },
  {
    name: "set_meal_status",
    description:
      "Set a planned meal's status for a day. status='eaten' fills the gaps: it auto-logs only the planned items not already logged (never double-counts). status='pending' undoes that. Also supports 'missed' and 'substituted'.",
    input_schema: {
      type: "object",
      properties: {
        meal_id: { type: "integer", description: "The meal's id." },
        status: {
          type: "string",
          enum: ["eaten", "missed", "substituted", "pending"],
          description: "New status.",
        },
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
      },
      required: ["meal_id", "status"],
    },
  },
  {
    name: "log_weigh_in",
    description: "Record a body-weight measurement (pounds) for a day. One per day; re-logging overwrites.",
    input_schema: {
      type: "object",
      properties: {
        weight_lb: { type: "number", description: "Weight in pounds." },
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        note: { type: "string", description: "Optional note." },
      },
      required: ["weight_lb"],
    },
  },
  {
    name: "get_weight_trend",
    description: "Get recent weigh-ins with the latest weight, 7-day average, and change per week.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Look-back window in days. Defaults to 14." },
      },
    },
  },
  {
    name: "add_memory_fact",
    description:
      "Save a short durable fact about the owner (preferences, constraints, context) to inject into future chats. Use sparingly for things worth remembering across sessions.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact to remember." },
      },
      required: ["content"],
    },
  },
  {
    name: "search_nutrition",
    description:
      "Search public nutrition databases (USDA + OpenFoodFacts) for a food's label macros by name. Use for OFF-PLAN foods not in the owner's library (restaurants, travel, packaged foods) BEFORE asking the owner for a source or estimating. Hits are per label serving with a source tag.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Food name, e.g. 'Chipotle chicken bowl' or 'Clif Bar chocolate chip'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_page",
    description:
      "Fetch a web page the owner pasted (menu or nutrition page) and return its readable text so you can extract macros. Best-effort: many retail sites block server fetches — if this errors, tell the owner plainly and fall back to a photo or a confirmed estimate. Never fabricate page content.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The http(s) URL the owner provided." },
      },
      required: ["url"],
    },
  },
  {
    name: "override_meal",
    description:
      "Adapt TODAY'S plan only: replace one meal's planned items for one date (a deviation — traveling, eating out). The template plan is NEVER changed. Pass the FULL replacement item list (include any kept items). Foods must already exist in the library — for off-plan foods use log_food's new-food path or add_grocery FIRST and take the food id from its result. Every food_id must come from a tool result in this conversation (search_foods hit, or the id returned by log_food/add_grocery) — NEVER guess a food_id. quantity is a multiplier of the food's serving basis (per-100 g foods: 1.7 means 170 g).",
    input_schema: {
      type: "object",
      properties: {
        meal_id: { type: "integer", description: "The meal to adapt." },
        items: {
          type: "array",
          description: "Full replacement item list for the meal.",
          items: {
            type: "object",
            properties: {
              food_id: { type: "integer", description: "Existing library food id." },
              quantity: { type: "number", description: "Multiplier of the food's serving basis." },
            },
            required: ["food_id", "quantity"],
          },
        },
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
      },
      required: ["meal_id", "items"],
    },
  },
];

export type ToolCard = { label: string; title: string; detail: string };
export type Macros = { kcal: number; proteinG: number; carbsG: number; fatG: number };

export type ToolRun = {
  /** JSON string handed back to the model as the tool_result content. */
  forModel: string;
  /** One-line human summary (fallback / logging). */
  summary: string;
  /** Batch id for Undo, when this write created a revertable batch. */
  writeBatchId: string | null;
  /** Structured card for write tools — drives the chat tool card. */
  card?: ToolCard | null;
  /** Remaining macros — set by get_day_summary so the UI can show the stat strip. */
  remaining?: Macros | null;
};

type Input = Record<string, unknown>;

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const scale = (perServing: number, qty: number) => (perServing * qty).toFixed(2);

function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Execute one tool call. Errors are returned as a result string, not thrown. */
export async function runTool(name: string, input: Input): Promise<ToolRun> {
  const today = todayInAppTz();
  const ok = (
    result: unknown,
    summary: string,
    extra: { writeBatchId?: string | null; card?: ToolCard | null; remaining?: Macros | null } = {},
  ): ToolRun => ({
    forModel: JSON.stringify(result),
    summary,
    writeBatchId: extra.writeBatchId ?? null,
    card: extra.card ?? null,
    remaining: extra.remaining ?? null,
  });
  const err = (message: string): ToolRun => ({
    forModel: JSON.stringify({ error: message }),
    summary: `Error: ${message}`,
    writeBatchId: null,
  });

  switch (name) {
    case "get_day_summary": {
      const date = str(input.date) ?? today;
      const summary = await getDaySummary(date);
      return ok(summary, `Read day summary for ${date}`, { remaining: summary.remaining });
    }

    case "search_foods": {
      const query = str(input.query) ?? "";
      const rows = await db
        .select()
        .from(foods)
        .where(ilike(foods.name, `%${query}%`))
        .limit(10);
      return ok(rows, `Searched foods for "${query}" (${rows.length})`);
    }

    case "log_food": {
      const date = str(input.date) ?? today;
      const mealId = num(input.meal_id) ?? null;
      const writeBatchId = randomUUID();

      let foodId: number;
      let per: {
        name: string;
        servingDesc: string;
        kcal: number;
        proteinG: number;
        carbsG: number;
        fatG: number;
      };
      let servingGrams: number | null = null;

      const foodIdInput = num(input.food_id);
      if (foodIdInput !== undefined) {
        const [f] = await db.select().from(foods).where(eq(foods.id, foodIdInput));
        if (!f) return err(`No food with id ${foodIdInput}`);
        per = {
          name: f.name,
          servingDesc: f.servingDesc,
          kcal: f.kcal,
          proteinG: Number(f.proteinG),
          carbsG: Number(f.carbsG),
          fatG: Number(f.fatG),
        };
        foodId = f.id;
        servingGrams = f.servingGrams === null ? null : Number(f.servingGrams);
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
        const [created] = await db
          .insert(foods)
          .values({
            name: name2,
            brand: null,
            servingDesc: per.servingDesc,
            kcal: Math.round(kcal),
            proteinG: per.proteinG.toFixed(2),
            carbsG: per.carbsG.toFixed(2),
            fatG: per.fatG.toFixed(2),
            isEstimated: input.is_estimated === true,
            oneOff: input.one_off === true,
          })
          .returning({ id: foods.id });
        foodId = created.id;
      }

      // Quantity: from weight (oz/grams) when given, else servings.
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

      const entry = {
        date,
        mealId,
        foodId,
        quantity: String(qty),
        kcal: Math.round(per.kcal * qty),
        proteinG: scale(per.proteinG, qty),
        carbsG: scale(per.carbsG, qty),
        fatG: scale(per.fatG, qty),
        source: "assistant_tool" as const,
        writeBatchId,
      };
      await db.insert(logEntries).values(entry);
      // Never surface the servings multiplier — always an absolute amount.
      const amountLabel = weightLabel ?? resolveItem(qty, per).amountLabel;
      return ok(
        { logged: { foodId, name: per.name, amount: amountLabel, kcal: entry.kcal }, writeBatchId },
        `Logged ${per.name}, ${amountLabel} (${entry.kcal} kcal)`,
        {
          writeBatchId,
          card: {
            label: "Food logged",
            title: `${per.name}, ${amountLabel}`,
            detail: `${entry.kcal} kcal, ${entry.proteinG}P ${entry.carbsG}C ${entry.fatG}F`,
          },
        },
      );
    }

    case "set_meal_status": {
      const mealId = num(input.meal_id);
      const status = str(input.status) as MealStatusValue | undefined;
      if (mealId === undefined || !status) return err("meal_id and status are required.");
      const date = str(input.date) ?? today;
      const result = await setMealStatus(date, mealId, status);

      const [meal] = await db.select({ name: meals.name }).from(meals).where(eq(meals.id, mealId));
      const mealName = meal?.name ?? `Meal ${mealId}`;
      let card: ToolCard;
      if (status === "eaten") {
        let kcal = 0;
        if (result.writeBatchId) {
          const rows = await db
            .select({ kcal: logEntries.kcal })
            .from(logEntries)
            .where(eq(logEntries.writeBatchId, result.writeBatchId));
          kcal = rows.reduce((a, r) => a + r.kcal, 0);
        }
        card = {
          label: "Meal eaten",
          title: mealName,
          detail: `${result.loggedFoodIds.length} items, ${kcal} kcal`,
        };
      } else {
        card = { label: `Meal ${status}`, title: mealName, detail: "" };
      }

      return ok(
        result,
        `Set meal ${mealId} → ${status} (${result.loggedFoodIds.length} items logged)`,
        { writeBatchId: result.writeBatchId, card },
      );
    }

    case "log_weigh_in": {
      const weight = num(input.weight_lb);
      if (weight === undefined) return err("weight_lb is required.");
      const date = str(input.date) ?? today;
      const note = str(input.note) ?? null;
      await db
        .insert(weighIns)
        .values({ date, weightLb: weight.toFixed(2), note })
        .onConflictDoUpdate({ target: weighIns.date, set: { weightLb: weight.toFixed(2), note } });
      return ok({ date, weightLb: weight }, `Logged weigh-in ${weight} lb on ${date}`, {
        card: { label: "Weigh-in", title: `${weight} lb`, detail: date },
      });
    }

    case "get_weight_trend": {
      const days = num(input.days) ?? 14;
      const since = shiftDate(today, -days);
      const rows = await db
        .select({ date: weighIns.date, weightLb: weighIns.weightLb })
        .from(weighIns)
        .where(gte(weighIns.date, since))
        .orderBy(asc(weighIns.date));

      if (rows.length === 0) {
        return ok({ entries: [], message: "No weigh-ins in window." }, `No weigh-ins in last ${days}d`);
      }
      const weights = rows.map((r) => ({ date: r.date, weightLb: Number(r.weightLb) }));
      const latest = weights[weights.length - 1];
      const first = weights[0];
      const sevenAgo = shiftDate(today, -7);
      const last7 = weights.filter((w) => w.date >= sevenAgo);
      const sevenDayAvg = last7.length
        ? Number((last7.reduce((a, w) => a + w.weightLb, 0) / last7.length).toFixed(1))
        : null;
      const spanDays =
        (new Date(`${latest.date}T00:00:00Z`).getTime() - new Date(`${first.date}T00:00:00Z`).getTime()) /
        86_400_000;
      const changePerWeek =
        spanDays > 0 ? Number((((latest.weightLb - first.weightLb) / spanDays) * 7).toFixed(2)) : 0;

      return ok(
        { latest, sevenDayAvg, changePerWeek, count: weights.length, entries: weights },
        `Weight trend: ${latest.weightLb} lb, ${changePerWeek >= 0 ? "+" : ""}${changePerWeek}/wk`,
      );
    }

    case "add_memory_fact": {
      const content = str(input.content);
      if (!content) return err("content is required.");
      const [row] = await db.insert(memoryFacts).values({ content }).returning({ id: memoryFacts.id });
      return ok({ id: row.id, content }, `Remembered: "${content}"`, {
        card: { label: "Remembered", title: content, detail: "" },
      });
    }

    case "add_grocery": {
      const name = str(input.name);
      const servingGrams = num(input.serving_grams);
      const kcal = num(input.kcal);
      if (!name || servingGrams === undefined || kcal === undefined) {
        return err("name, serving_grams, and kcal are required.");
      }
      const g = await createGrocery({
        name,
        brand: str(input.brand) ?? null,
        store: str(input.store) ?? null,
        link: str(input.link) ?? null,
        category: str(input.category) ?? null,
        servingGrams,
        kcal,
        proteinG: num(input.protein_g) ?? 0,
        carbsG: num(input.carbs_g) ?? 0,
        fatG: num(input.fat_g) ?? 0,
        purchaseWeightG: num(input.purchase_weight_g) ?? null,
        price: num(input.price) ?? null,
      });
      return ok({ id: g.id, name: g.name }, `Added grocery ${g.name} (id ${g.id})`, {
        card: {
          label: "Grocery added",
          title: g.name,
          detail: `${g.kcal} kcal / ${servingGrams} g serving`,
        },
      });
    }

    case "search_nutrition": {
      const query = str(input.query) ?? "";
      const hits = await searchNutrition(query);
      return ok({ hits }, `Nutrition search "${query.trim()}" (${hits.length} hits)`);
    }

    case "fetch_page": {
      const url = str(input.url);
      if (!url) return err("url is required.");
      const page = await fetchPage(url);
      if (!page.ok) return err(page.error);
      return ok({ text: page.text }, `Fetched ${url} (${page.text.length} chars)`);
    }

    case "override_meal": {
      const mealId = num(input.meal_id);
      const rawItems = Array.isArray(input.items) ? input.items : null;
      if (mealId === undefined || !rawItems || rawItems.length === 0) {
        return err("meal_id and a non-empty items array are required.");
      }
      const items: OverrideItemInput[] = [];
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
      const date = str(input.date) ?? today;
      try {
        const result = await setMealOverride(date, mealId, items);
        const [meal] = await db.select({ name: meals.name }).from(meals).where(eq(meals.id, mealId));
        const mealName = meal?.name ?? `Meal ${mealId}`;
        return ok(
          { adjusted: mealName, date, lines: result.lines, total: result.total },
          `Adjusted ${mealName} for ${date} (${items.length} items)`,
          {
            writeBatchId: result.writeBatchId,
            card: { label: "Meal adjusted", title: `${mealName} (today only)`, detail: result.total },
          },
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : "override failed");
      }
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
}
