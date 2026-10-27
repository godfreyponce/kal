import "./env";
import { eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { foods, mealItems, profile } from "./schema";
import { LABEL_FOODS, perBasis } from "./label-data";

// ---------------------------------------------------------------------------
// Label macros -> live foods rows, by id (#10). Run: npx tsx db/apply-label-data.ts [--apply]
//
// Dry run by default. With --apply it writes, in one batch, only kcal/protein/carbs/fat,
// is_estimated=false, brand, store (where LABEL_FOODS sets one), and the milk's rename.
// Every basis column, meal_items, profile, and log_entries stay as they are, so live
// targets lag the new plan sum until the next plan edit (owner's call).
// Aborts before any write if a row's name or serving_desc no longer matches LABEL_FOODS.
// Safe to rerun: the guard accepts a row's new name.
//
// NEVER run db/apply-seed-v2.ts to "sync" these numbers: it replaces the live plan and targets.
// ---------------------------------------------------------------------------

type Macros = { kcal: number; p: number; c: number; f: number };

const fmt = (m: Macros) => `${m.kcal}/${m.p}/${m.c}/${m.f}`;

function planSum(items: Array<{ foodId: number; quantity: string }>, macrosById: Map<number, Macros>) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const it of items) {
    const m = macrosById.get(it.foodId)!;
    const q = Number(it.quantity);
    t.kcal += m.kcal * q;
    t.p += m.p * q;
    t.c += m.c * q;
    t.f += m.f * q;
  }
  return { kcal: Math.round(t.kcal), p: Math.round(t.p), c: Math.round(t.c), f: Math.round(t.f) };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const ids = LABEL_FOODS.map((l) => l.liveId);
  const rows = await db.select().from(foods).where(inArray(foods.id, ids));
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const mismatches: string[] = [];
  for (const l of LABEL_FOODS) {
    const row = rowById.get(l.liveId);
    if (!row) {
      mismatches.push(`id ${l.liveId} (${l.name}): missing`);
      continue;
    }
    if (row.name !== l.name && row.name !== l.newName) {
      mismatches.push(`id ${l.liveId}: name "${row.name}", expected "${l.name}"${l.newName ? ` or "${l.newName}"` : ""}`);
    }
    if (row.servingDesc !== l.servingDesc) {
      mismatches.push(`id ${l.liveId}: serving_desc "${row.servingDesc}", expected "${l.servingDesc}"`);
    }
  }
  if (mismatches.length > 0) {
    console.error(`guard: ${mismatches.length} mismatch(es), nothing written`);
    for (const m of mismatches) console.error(`  ${m}`);
    process.exit(1);
  }
  console.log(`guard: ${LABEL_FOODS.length}/${LABEL_FOODS.length} rows match`);

  for (const l of LABEL_FOODS) {
    const row = rowById.get(l.liveId)!;
    const old: Macros = { kcal: row.kcal, p: Number(row.proteinG), c: Number(row.carbsG), f: Number(row.fatG) };
    const changes = [
      l.newName && row.name !== l.newName ? `rename -> "${l.newName}"` : "",
      row.brand !== l.brand ? `brand ${JSON.stringify(row.brand)} -> ${JSON.stringify(l.brand)}` : "",
      l.store && row.store !== l.store ? `store ${JSON.stringify(row.store)} -> ${JSON.stringify(l.store)}` : "",
    ].filter(Boolean);
    console.log(
      `${row.name} [id ${row.id}]: ${fmt(old)}${row.isEstimated ? " (estimated)" : ""} -> ${fmt(perBasis(l))}` +
        (changes.length ? `; ${changes.join("; ")}` : ""),
    );
  }

  const items = await db.select({ foodId: mealItems.foodId, quantity: mealItems.quantity }).from(mealItems);
  const planFoods = await db
    .select({ id: foods.id, kcal: foods.kcal, p: foods.proteinG, c: foods.carbsG, f: foods.fatG })
    .from(foods)
    .where(inArray(foods.id, [...new Set(items.map((i) => i.foodId))]));
  const before = new Map(planFoods.map((r) => [r.id, { kcal: r.kcal, p: Number(r.p), c: Number(r.c), f: Number(r.f) }]));
  const after = new Map(before);
  for (const l of LABEL_FOODS) if (after.has(l.liveId)) after.set(l.liveId, perBasis(l));
  const [targets] = await db.select().from(profile).limit(1);
  console.log(`plan sum (kcal/P/C/F): ${fmt(planSum(items, before))} -> ${fmt(planSum(items, after))}`);
  console.log(
    `live targets (unchanged): ${targets.targetKcal}/${targets.targetProteinG}/${targets.targetCarbsG}/${targets.targetFatG}`,
  );

  if (!apply) {
    console.log("dry run: nothing written (pass --apply)");
    return;
  }
  const updates = LABEL_FOODS.map((l) => {
    const m = perBasis(l);
    return db
      .update(foods)
      .set({
        kcal: m.kcal,
        proteinG: String(m.p),
        carbsG: String(m.c),
        fatG: String(m.f),
        isEstimated: false,
        brand: l.brand,
        ...(l.store ? { store: l.store } : {}),
        ...(l.newName ? { name: l.newName } : {}),
      })
      .where(eq(foods.id, l.liveId));
  });
  await db.batch(updates as [(typeof updates)[number], ...typeof updates]);
  console.log(`applied ${updates.length} rows`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
