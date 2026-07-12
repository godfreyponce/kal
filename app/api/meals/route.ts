import type { NextRequest } from "next/server";
import { createMeal } from "@/lib/plan";

// POST /api/meals — add a meal to the template (appended last).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  const created = await createMeal({ name, timeHint: body.timeHint ?? null });
  return Response.json(created, { status: 201 });
}
