import { and, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { apiCalls } from "../db/schema";
import { usageCostUsd, type Usage } from "./anthropic";

export type ApiPurpose = "chat" | "label";

/** Writes one ledger row for an Anthropic call. Never rejects: a failed insert must not break the reply. */
export async function recordApiCall(model: string, purpose: ApiPurpose, usage: Usage): Promise<void> {
  const cost = usageCostUsd(model, usage);
  try {
    await db.insert(apiCalls).values({
      model,
      purpose,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      costUsd: cost === null ? null : cost.toFixed(6),
    });
  } catch (e) {
    console.error("api_calls insert failed", e);
  }
}

/**
 * 00:00 UTC on `startDay` of this month, or of last month if that day is still ahead.
 * A day past the month's end clamps to its last day (31 in February → the 28th/29th).
 */
export function cycleStart(now: Date, startDay: number): Date {
  const at = (year: number, month: number) => {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(startDay, lastDay)));
  };
  const thisMonth = at(now.getUTCFullYear(), now.getUTCMonth());
  return thisMonth <= now ? thisMonth : at(now.getUTCFullYear(), now.getUTCMonth() - 1);
}

/**
 * Start of the cycle `now` falls in, from `SPEND_CYCLE_START_DAY`. A missing or bad value
 * (an empty string left by an env pull, a non-integer, outside 1-31) falls back to day 1.
 */
export function currentCycleStart(now = new Date()): Date {
  const day = Number(process.env.SPEND_CYCLE_START_DAY);
  return cycleStart(now, Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1);
}

/** Calls and priced cost per model in [from, to). Unpriced calls count toward `calls`, not `costUsd`. */
export async function spendByModel(
  from: Date,
  to: Date,
): Promise<{ model: string; calls: number; unpricedCalls: number; costUsd: number }[]> {
  const rows = await db
    .select({
      model: apiCalls.model,
      calls: sql<number>`count(*)::int`,
      unpricedCalls: sql<number>`(count(*) filter (where ${apiCalls.costUsd} is null))::int`,
      costUsd: sql<string>`coalesce(sum(${apiCalls.costUsd}), 0)`,
    })
    .from(apiCalls)
    .where(and(gte(apiCalls.createdAt, from), lt(apiCalls.createdAt, to)))
    .groupBy(apiCalls.model)
    .orderBy(apiCalls.model);
  return rows.map((r) => ({ ...r, costUsd: Number(r.costUsd) }));
}

/** Priced spend since the current credit cycle began (see `currentCycleStart`). */
export async function monthToDateSpendUsd(
  now = new Date(),
): Promise<{ costUsd: number; unpricedCalls: number; since: Date }> {
  const since = currentCycleStart(now);
  const byModel = await spendByModel(since, now);
  return {
    costUsd: byModel.reduce((acc, m) => acc + m.costUsd, 0),
    unpricedCalls: byModel.reduce((acc, m) => acc + m.unpricedCalls, 0),
    since,
  };
}

/** One script line. A row with no priced calls says `unpriced`, never `$0.00`. */
export function spendLine(label: string, m: { calls: number; unpricedCalls: number; costUsd: number }): string {
  if (m.calls > 0 && m.unpricedCalls === m.calls) return `${label}  ${m.calls} calls  unpriced`;
  const unpriced = m.unpricedCalls > 0 ? `  (${m.unpricedCalls} unpriced)` : "";
  return `${label}  ${m.calls} calls  $${m.costUsd.toFixed(2)}${unpriced}`;
}
