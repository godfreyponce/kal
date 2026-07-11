import "../db/env";
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { profile } from "../db/schema";
import { getProfile, updateProfile } from "./profile";

// The profile is a live singleton row — snapshot it once, restore after every test.
let original: typeof profile.$inferSelect;

beforeAll(async () => {
  const [row] = await db.select().from(profile).where(eq(profile.id, 1));
  original = row;
});

async function restore() {
  const { id: _id, ...rest } = original;
  await db.update(profile).set(rest).where(eq(profile.id, 1));
}
afterEach(restore);
afterAll(restore);

describe("getProfile", () => {
  it("returns the singleton with numerics as numbers", async () => {
    const p = await getProfile();
    expect(typeof p.weightLb).toBe("number");
    expect(typeof p.targetKcal).toBe("number");
    expect(p.heightCm).toBeGreaterThan(0);
  });
});

describe("updateProfile", () => {
  it("updates provided fields and returns the fresh view", async () => {
    const p = await updateProfile({ weightLb: 181.5, activityLevel: "very active" });
    expect(p.weightLb).toBe(181.5);
    expect(p.activityLevel).toBe("very active");
  });

  it("null clears nullable fields", async () => {
    const p = await updateProfile({ bodyFatPct: null, goalWeightLb: null });
    expect(p.bodyFatPct).toBeNull();
    expect(p.goalWeightLb).toBeNull();
  });

  it("never touches goal_date or targets", async () => {
    await updateProfile({ weightLb: 182 });
    const [row] = await db.select().from(profile).where(eq(profile.id, 1));
    expect(row.goalDate).toEqual(original.goalDate);
    expect(row.targetKcal).toBe(original.targetKcal);
  });

  it("rejects invalid values and empty patches", async () => {
    await expect(updateProfile({ weightLb: 0 })).rejects.toThrow(/positive/);
    await expect(updateProfile({ age: 2.5 })).rejects.toThrow(/integer/);
    await expect(updateProfile({ bodyFatPct: 150 })).rejects.toThrow(/between/);
    await expect(updateProfile({})).rejects.toThrow(/empty/);
  });
});
