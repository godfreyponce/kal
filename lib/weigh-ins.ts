import { asc, gte } from "drizzle-orm";
import { db } from "../db";
import { weighIns } from "../db/schema";

export type WeighInView = { date: string; weightLb: number };

/** Weigh-ins on or after `since`, ascending by date — feeds the weight-trend chart. */
export async function listWeighIns(since: string): Promise<WeighInView[]> {
  const rows = await db
    .select({ date: weighIns.date, weightLb: weighIns.weightLb })
    .from(weighIns)
    .where(gte(weighIns.date, since))
    .orderBy(asc(weighIns.date));

  return rows.map((r) => ({ date: r.date, weightLb: Number(r.weightLb) }));
}
