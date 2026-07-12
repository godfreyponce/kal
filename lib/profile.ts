import { eq } from "drizzle-orm";
import { db } from "../db";
import { profile } from "../db/schema";
import { ValidationError } from "./errors";

export type ProfileView = {
  heightCm: number;
  weightLb: number;
  age: number;
  sex: string;
  bodyFatPct: number | null;
  goalWeightLb: number | null;
  activityLevel: string | null;
  targetKcal: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
};

// goal_date is deliberately absent: the owner dropped deadlines (spec 2026-07-11).
// Targets are absent too — they only change via plan re-derivation (lib/plan.ts).
export type ProfilePatch = Partial<{
  heightCm: number;
  weightLb: number;
  age: number;
  sex: string;
  bodyFatPct: number | null;
  goalWeightLb: number | null;
  activityLevel: string | null;
}>;

export async function getProfile(): Promise<ProfileView> {
  const [row] = await db.select().from(profile).where(eq(profile.id, 1));
  if (!row) throw new Error("profile row missing");
  return {
    heightCm: row.heightCm,
    weightLb: Number(row.weightLb),
    age: row.age,
    sex: row.sex,
    bodyFatPct: row.bodyFatPct === null ? null : Number(row.bodyFatPct),
    goalWeightLb: row.goalWeightLb === null ? null : Number(row.goalWeightLb),
    activityLevel: row.activityLevel,
    targetKcal: row.targetKcal,
    targetProteinG: row.targetProteinG,
    targetCarbsG: row.targetCarbsG,
    targetFatG: row.targetFatG,
  };
}

export async function updateProfile(patch: ProfilePatch): Promise<ProfileView> {
  const set: Partial<typeof profile.$inferInsert> = {};
  if (patch.heightCm !== undefined) {
    if (!Number.isInteger(patch.heightCm) || patch.heightCm <= 0)
      throw new ValidationError("heightCm must be a positive integer");
    set.heightCm = patch.heightCm;
  }
  if (patch.weightLb !== undefined) {
    if (!Number.isFinite(patch.weightLb) || patch.weightLb <= 0)
      throw new ValidationError("weightLb must be positive");
    set.weightLb = String(patch.weightLb);
  }
  if (patch.age !== undefined) {
    if (!Number.isInteger(patch.age) || patch.age <= 0)
      throw new ValidationError("age must be a positive integer");
    set.age = patch.age;
  }
  if (patch.sex !== undefined) {
    if (!patch.sex.trim()) throw new ValidationError("sex must be non-empty");
    set.sex = patch.sex.trim();
  }
  if (patch.bodyFatPct !== undefined) {
    if (
      patch.bodyFatPct !== null &&
      (!Number.isFinite(patch.bodyFatPct) || patch.bodyFatPct <= 0 || patch.bodyFatPct >= 100)
    )
      throw new ValidationError("bodyFatPct must be between 0 and 100");
    set.bodyFatPct = patch.bodyFatPct === null ? null : String(patch.bodyFatPct);
  }
  if (patch.goalWeightLb !== undefined) {
    if (patch.goalWeightLb !== null && (!Number.isFinite(patch.goalWeightLb) || patch.goalWeightLb <= 0))
      throw new ValidationError("goalWeightLb must be positive");
    set.goalWeightLb = patch.goalWeightLb === null ? null : String(patch.goalWeightLb);
  }
  if (patch.activityLevel !== undefined) {
    set.activityLevel = patch.activityLevel === null ? null : patch.activityLevel.trim() || null;
  }
  if (Object.keys(set).length === 0) throw new ValidationError("empty patch");
  await db.update(profile).set(set).where(eq(profile.id, 1));
  return getProfile();
}
