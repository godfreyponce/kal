import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gte, ilike } from "drizzle-orm";
import { db } from "../db";
import { foods, logEntries, memoryFacts, weighIns } from "../db/schema";
import { getDaySummary } from "./day-summary";
import { setMealStatus, type MealStatusValue } from "./meal-status";
import { todayInAppTz } from "./time";

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
      "Log a food to the day's intake. Either pass food_id (an existing library food) with a quantity (multiple of its serving), OR pass name plus per-serving kcal/protein_g/carbs_g/fat_g to log (and add to the library) a new food. Optionally attach to a meal_id.",
    input_schema: {
      type: "object",
      properties: {
        food_id: { type: "integer", description: "Id of an existing library food." },
        name: { type: "string", description: "Name for a new free-form food (with macros below)." },
        quantity: { type: "number", description: "Servings eaten. Defaults to 1." },
        meal_id: { type: "integer", description: "Optional meal to attach this entry to." },
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        kcal: { type: "number", description: "Per-serving calories (new food only)." },
        protein_g: { type: "number", description: "Per-serving protein grams (new food only)." },
        carbs_g: { type: "number", description: "Per-serving carb grams (new food only)." },
        fat_g: { type: "number", description: "Per-serving fat grams (new food only)." },
        serving_desc: { type: "string", description: "Serving description for a new food, e.g. '1 cup'." },
      },
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
];

export type ToolRun = {
  /** JSON string handed back to the model as the tool_result content. */
  forModel: string;
  /** One-line human summary for the chat tool card. */
  summary: string;
  /** Batch id for Undo, when this write created a revertable batch. */
  writeBatchId: string | null;
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
  const ok = (result: unknown, summary: string, writeBatchId: string | null = null): ToolRun => ({
    forModel: JSON.stringify(result),
    summary,
    writeBatchId,
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
      return ok(summary, `Read day summary for ${date}`);
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
      const qty = num(input.quantity) ?? 1;
      const date = str(input.date) ?? today;
      const mealId = num(input.meal_id) ?? null;
      const writeBatchId = randomUUID();

      let foodId: number;
      let per: { name: string; kcal: number; proteinG: number; carbsG: number; fatG: number };

      const foodIdInput = num(input.food_id);
      if (foodIdInput !== undefined) {
        const [f] = await db.select().from(foods).where(eq(foods.id, foodIdInput));
        if (!f) return err(`No food with id ${foodIdInput}`);
        per = {
          name: f.name,
          kcal: f.kcal,
          proteinG: Number(f.proteinG),
          carbsG: Number(f.carbsG),
          fatG: Number(f.fatG),
        };
        foodId = f.id;
      } else {
        const name2 = str(input.name);
        const kcal = num(input.kcal);
        if (!name2 || kcal === undefined) {
          return err("Provide food_id, or name plus per-serving kcal (and macros).");
        }
        per = {
          name: name2,
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
            servingDesc: str(input.serving_desc) ?? "1 serving",
            kcal: Math.round(kcal),
            proteinG: per.proteinG.toFixed(2),
            carbsG: per.carbsG.toFixed(2),
            fatG: per.fatG.toFixed(2),
          })
          .returning({ id: foods.id });
        foodId = created.id;
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
      return ok(
        { logged: { name: per.name, quantity: qty, kcal: entry.kcal }, writeBatchId },
        `Logged ${qty} × ${per.name} (${entry.kcal} kcal)`,
        writeBatchId,
      );
    }

    case "set_meal_status": {
      const mealId = num(input.meal_id);
      const status = str(input.status) as MealStatusValue | undefined;
      if (mealId === undefined || !status) return err("meal_id and status are required.");
      const date = str(input.date) ?? today;
      const result = await setMealStatus(date, mealId, status);
      return ok(
        result,
        `Set meal ${mealId} → ${status} (${result.loggedFoodIds.length} items logged)`,
        result.writeBatchId,
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
      return ok({ date, weightLb: weight }, `Logged weigh-in ${weight} lb on ${date}`);
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
      return ok({ id: row.id, content }, `Remembered: "${content}"`);
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
}
