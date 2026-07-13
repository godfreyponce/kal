import type { NextRequest } from "next/server";
import { ValidationError } from "@/lib/errors";
import { updateProfile, type ProfilePatch } from "@/lib/profile";

// PATCH /api/profile — partial update of the singleton profile row.
// goal_date is not accepted: the owner dropped deadlines; targets only move
// via plan re-derivation (/api/meals/[id]/items with scope "template").
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) ?? {};
  const patch: ProfilePatch = {};

  // Non-nullable numerics: skip null/undefined.
  for (const k of ["heightCm", "weightLb", "age"] as const) {
    if (body[k] !== undefined && body[k] !== null) patch[k] = Number(body[k]);
  }
  if (body.sex !== undefined && body.sex !== null) patch.sex = String(body.sex);
  // Nullable: null (or "") clears.
  for (const k of ["bodyFatPct", "goalWeightLb"] as const) {
    if (body[k] !== undefined) patch[k] = body[k] === null || body[k] === "" ? null : Number(body[k]);
  }
  if (body.activityLevel !== undefined) {
    patch.activityLevel = body.activityLevel ? String(body.activityLevel) : null;
  }

  try {
    return Response.json(await updateProfile(patch));
  } catch (err) {
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
