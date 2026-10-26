import "../db/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { apiCalls } from "../db/schema";
import { currentCycleStart, cycleStart, monthToDateSpendUsd, recordApiCall, spendByModel, spendLine } from "./spend";

// Live-DB rows sit in a 2001 sentinel window; recordApiCall rows land at now() under ZZTEST_ ids.
const cleanup = () =>
  db.delete(apiCalls).where(or(lt(apiCalls.createdAt, new Date("2002-01-01T00:00:00Z")), like(apiCalls.model, "ZZTEST_%")));

describe("cycleStart", () => {
  it("starts this month when the day has passed", () => {
    expect(cycleStart(new Date("2026-10-25T12:00:00Z"), 18).toISOString()).toBe("2026-10-18T00:00:00.000Z");
  });
  it("rolls back a month when the day is ahead", () => {
    expect(cycleStart(new Date("2026-11-05T12:00:00Z"), 18).toISOString()).toBe("2026-10-18T00:00:00.000Z");
  });
  it("clamps to the month's last day", () => {
    expect(cycleStart(new Date("2026-03-10T00:00:00Z"), 31).toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
  it("day 1 is the calendar month", () => {
    expect(cycleStart(new Date("2026-10-01T00:00:00Z"), 1).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("currentCycleStart", () => {
  const saved = process.env.SPEND_CYCLE_START_DAY;
  afterAll(() => {
    if (saved === undefined) delete process.env.SPEND_CYCLE_START_DAY;
    else process.env.SPEND_CYCLE_START_DAY = saved;
  });
  it.each(["", "abc", "0", "32", "1.5"])("falls back to day 1 for SPEND_CYCLE_START_DAY=%j", (value) => {
    process.env.SPEND_CYCLE_START_DAY = value;
    expect(currentCycleStart(new Date("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
  it("uses a valid SPEND_CYCLE_START_DAY", () => {
    process.env.SPEND_CYCLE_START_DAY = "18";
    expect(currentCycleStart(new Date("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-18T00:00:00.000Z");
  });
});

describe("spendLine", () => {
  it("prints an all-unpriced model as unpriced, not $0.00", () => {
    expect(spendLine("claude-nope", { calls: 3, unpricedCalls: 3, costUsd: 0 })).toBe("claude-nope  3 calls  unpriced");
  });
  it("prints priced cost with the unpriced count beside it", () => {
    expect(spendLine("Total", { calls: 4, unpricedCalls: 1, costUsd: 0.75 })).toBe("Total  4 calls  $0.75  (1 unpriced)");
  });
  it("prints an empty total as $0.00", () => {
    expect(spendLine("Total", { calls: 0, unpricedCalls: 0, costUsd: 0 })).toBe("Total  0 calls  $0.00");
  });
  it("prints a fully priced model plainly", () => {
    expect(spendLine("claude-opus-5-5", { calls: 2, unpricedCalls: 0, costUsd: 0.5 })).toBe("claude-opus-5-5  2 calls  $0.50");
  });
});

describe("ledger (live DB, 2001 sentinel window)", () => {
  const savedDay = process.env.SPEND_CYCLE_START_DAY;
  const row = (createdAt: string, model: string, costUsd: string | null) => ({
    createdAt: new Date(createdAt), model, purpose: "chat",
    inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd,
  });

  beforeAll(async () => {
    await cleanup();
    await db.insert(apiCalls).values([
      row("2001-06-20T00:00:00Z", "claude-opus-5-5", "0.50"),
      row("2001-06-21T00:00:00Z", "claude-opus-5-5", "0.25"),
      row("2001-06-21T00:00:00Z", "claude-haiku-4-5", null),
      row("2001-06-10T00:00:00Z", "claude-opus-5-5", "9"),
    ]);
  });
  afterAll(async () => {
    await cleanup();
    if (savedDay === undefined) delete process.env.SPEND_CYCLE_START_DAY;
    else process.env.SPEND_CYCLE_START_DAY = savedDay;
  });

  it("monthToDateSpendUsd sums priced rows since the cycle start", async () => {
    process.env.SPEND_CYCLE_START_DAY = "15";
    const r = await monthToDateSpendUsd(new Date("2001-06-25T00:00:00Z"));
    expect(r.since.toISOString()).toBe("2001-06-15T00:00:00.000Z");
    expect(r.costUsd).toBeCloseTo(0.75, 6);
  });

  it("unpriced rows are counted, not summed as $0", async () => {
    process.env.SPEND_CYCLE_START_DAY = "15";
    const r = await monthToDateSpendUsd(new Date("2001-06-25T00:00:00Z"));
    expect(r.unpricedCalls).toBe(1);
    const byModel = await spendByModel(new Date("2001-06-15T00:00:00Z"), new Date("2001-06-25T00:00:00Z"));
    expect(byModel.find((m) => m.model === "claude-haiku-4-5")).toMatchObject({ calls: 1, unpricedCalls: 1, costUsd: 0 });
  });

  it("recordApiCall writes one row", async () => {
    await recordApiCall("ZZTEST_model", "chat", { input_tokens: 10, output_tokens: 5 });
    const rows = await db.select().from(apiCalls).where(eq(apiCalls.model, "ZZTEST_model"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: "chat", inputTokens: 10, outputTokens: 5, costUsd: null });
  });

  it("recordApiCall swallows insert errors", async () => {
    // 2 ** 40 overflows the integer column, so the insert fails.
    await expect(recordApiCall("ZZTEST_model", "chat", { input_tokens: 2 ** 40 })).resolves.toBeUndefined();
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(apiCalls).where(eq(apiCalls.model, "ZZTEST_model"));
    expect(n).toBe(1);
  });
});
