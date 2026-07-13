import type { NextRequest } from "next/server";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { setMealOverride } from "@/lib/overrides";
import { replaceMealItems, type PlanItemInput } from "@/lib/plan";
import { todayInAppTz } from "@/lib/time";

// PUT /api/meals/:id/items — save a meal's items with a scope:
//   "today"    → day-scoped meal_overrides row set (the chat ⇄ engine); template untouched.
//   "template" → rewrite meal_items for every day; profile targets re-derive.
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mealId = Number(id);
  if (!Number.isInteger(mealId)) return Response.json({ error: "invalid id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) ?? {};
  const scope = body.scope;
  if (scope !== "today" && scope !== "template") {
    return Response.json({ error: 'scope must be "today" or "template"' }, { status: 400 });
  }
  if (!Array.isArray(body.items)) {
    return Response.json({ error: "items must be an array" }, { status: 400 });
  }
  const items: PlanItemInput[] = body.items.map((it: { foodId: unknown; quantity: unknown }) => ({
    foodId: Number(it.foodId),
    quantity: Number(it.quantity),
  }));

  try {
    if (scope === "today") {
      if (items.length === 0) {
        return Response.json(
          { error: "a just-today save needs at least one item (skip a meal via its status instead)" },
          { status: 400 },
        );
      }
      const res = await setMealOverride(todayInAppTz(), mealId, items);
      return Response.json({ scope: "today", ...res });
    }
    const targets = await replaceMealItems(mealId, items);
    return Response.json({ scope: "template", targets });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
