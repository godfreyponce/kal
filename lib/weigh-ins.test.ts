import "../db/env";
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { gte } from "drizzle-orm";
import { db } from "../db";
import { weighIns } from "../db/schema";
import { listWeighIns } from "./weigh-ins";

// Sentinel dates for this file — never touch real rows.
const D1 = "2099-06-01";
const D2 = "2099-06-03";
const D3 = "2099-06-08";

async function cleanup() {
  await db.delete(weighIns).where(gte(weighIns.date, "2099-01-01"));
}
afterEach(cleanup);
afterAll(cleanup);

async function seed() {
  for (const [date, weightLb] of [
    [D1, "180.50"],
    [D2, "179.80"],
    [D3, "178.90"],
  ] as const) {
    await db
      .insert(weighIns)
      .values({ date, weightLb })
      .onConflictDoUpdate({ target: weighIns.date, set: { weightLb } });
  }
}

describe("listWeighIns", () => {
  it("returns rows ascending by date with numeric weightLb", async () => {
    await seed();
    const rows = await listWeighIns(D1);
    expect(rows).toEqual([
      { date: D1, weightLb: 180.5 },
      { date: D2, weightLb: 179.8 },
      { date: D3, weightLb: 178.9 },
    ]);
    for (const r of rows) expect(typeof r.weightLb).toBe("number");
  });

  it("filters to the window (gte since)", async () => {
    await seed();
    const rows = await listWeighIns(D2);
    expect(rows.map((r) => r.date)).toEqual([D2, D3]);
  });
});
