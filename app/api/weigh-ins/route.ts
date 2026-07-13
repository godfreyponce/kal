import type { NextRequest } from "next/server";
import { db } from "@/db";
import { weighIns } from "@/db/schema";
import { todayInAppTz } from "@/lib/time";

// POST /api/weigh-ins  body: { weightLb, date?, note? }
// One weigh-in per day (date is unique) — re-posting the same day overwrites.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) ?? {};
  const weight = Number(body.weightLb);
  if (!Number.isFinite(weight) || weight <= 0) {
    return Response.json({ error: "weightLb must be a positive number" }, { status: 400 });
  }

  const date = typeof body.date === "string" ? body.date : todayInAppTz();
  const note = typeof body.note === "string" ? body.note : null;

  await db
    .insert(weighIns)
    .values({ date, weightLb: weight.toFixed(2), note })
    .onConflictDoUpdate({ target: weighIns.date, set: { weightLb: weight.toFixed(2), note } });

  return Response.json({ date, weightLb: weight });
}
