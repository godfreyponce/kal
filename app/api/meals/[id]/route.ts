import type { NextRequest } from "next/server";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { deleteMeal, updateMeal } from "@/lib/plan";

// PATCH /api/meals/:id — rename / re-hint a template meal.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mealId = Number(id);
  if (!Number.isInteger(mealId)) return Response.json({ error: "invalid id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const patch: { name?: string; timeHint?: string | null } = {};
  if (body.name !== undefined && body.name !== null) patch.name = String(body.name);
  if (body.timeHint !== undefined) patch.timeHint = body.timeHint ? String(body.timeHint) : null;
  try {
    const updated = await updateMeal(mealId, patch);
    if (!updated) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

// DELETE /api/meals/:id — remove from the template; targets re-derive.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mealId = Number(id);
  if (!Number.isInteger(mealId)) return Response.json({ error: "invalid id" }, { status: 400 });
  try {
    const targets = await deleteMeal(mealId);
    return Response.json({ targets });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }
}
