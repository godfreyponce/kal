import type { NextRequest } from "next/server";
import { todayInAppTz } from "@/lib/time";
import { setMealStatus, type MealStatusValue } from "@/lib/meal-status";

const ALLOWED: MealStatusValue[] = ["eaten", "missed", "substituted", "pending"];

// POST /api/meals/:id/status  body: { status, date? }
// status='eaten' fills the gaps; status='pending' undoes (reverts the batch + status).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mealId = Number(id);
  if (!Number.isInteger(mealId)) {
    return Response.json({ error: "invalid meal id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const status = body.status as MealStatusValue;
  if (!ALLOWED.includes(status)) {
    return Response.json({ error: `status must be one of ${ALLOWED.join(", ")}` }, { status: 400 });
  }

  const date = typeof body.date === "string" ? body.date : todayInAppTz();
  const result = await setMealStatus(date, mealId, status);
  return Response.json(result);
}
