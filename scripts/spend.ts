import "../db/env";
import { currentCycleStart, spendByModel, spendLine } from "../lib/spend";

// Prints Anthropic spend since the current credit cycle began, split by model.
// Unpriced calls (model missing from PRICING) are counted apart, never shown as $0.
// Run: npx tsx scripts/spend.ts
async function main() {
  const now = new Date();
  const since = currentCycleStart(now);
  const byModel = await spendByModel(since, now);

  console.log(`Cycle start ${since.toISOString()}`);
  for (const m of byModel) console.log(spendLine(m.model, m));
  console.log(
    spendLine("Total", {
      calls: byModel.reduce((acc, m) => acc + m.calls, 0),
      unpricedCalls: byModel.reduce((acc, m) => acc + m.unpricedCalls, 0),
      costUsd: byModel.reduce((acc, m) => acc + m.costUsd, 0),
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
