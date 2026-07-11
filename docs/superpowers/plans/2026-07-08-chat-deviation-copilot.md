# Chat Deviation Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kal's chat a deviation copilot — when the owner is off-plan (traveling, unprepared, eating out) it finds real macros for off-plan food via a strict knowledge ladder, logs what was actually eaten, and adapts *today's* plan only — all cheap via prompt caching on Haiku.

**Architecture:** A new `meal_overrides` table holds day-scoped replacements for a meal's template items (no rows = template applies; tomorrow auto-reverts). Three new chat tools (`search_nutrition`, `fetch_page`, `override_meal`) plus system-prompt ladder rules give the model knowledge without guessing. The system prompt splits into a cacheable static block and a small dynamic block; a rolling cache marker on the conversation makes tool-loop turns ~10× cheaper.

**Tech Stack:** Next.js 16 (App Router), Neon Postgres + Drizzle (neon-http driver), `@anthropic-ai/sdk` (Haiku, prompt caching), Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-08-chat-deviation-copilot-design.md`

## Global Constraints

- **Next 16 has breaking changes** — read `node_modules/next/dist/docs/` before touching routes/UI. `params` is a Promise; the auth gate file is `proxy.ts` (not middleware).
- **`todayInAppTz()` is the ONLY source of "today"** — never raw `new Date()` for dates.
- **Never surface a bare multiplier** — every amount shown to the model or UI goes through `resolveItem` (`lib/resolve-item.ts`).
- **`npm test` hits live Neon** (needs `DATABASE_URL` in `.env.local`). **NEVER run `npm run db:seed`** — it is a FULL WIPE of live data.
- **Sentinel dates:** each integration-test FILE gets its own (vitest runs files in parallel). Taken: 2099-01-01, 2099-02-02, 2099-03-03, 2099-04-04. This plan assigns: `lib/overrides.test.ts` → **2099-05-05**, `lib/tools-deviation.test.ts` → **2099-06-06**, `lib/system-prompt.test.ts` → **2099-07-07**.
- **Dev server:** `PORT=3100 npm run dev`, backgrounded, never start a duplicate (EADDRINUSE). After editing `globals.css`: `rm -rf .next`, restart, hard-refresh (Turbopack serves stale CSS otherwise).
- **Before adding any CSS class to `globals.css`, grep it first** (a past `.mrow` collision broke the Today screen).
- **No `·` middot separators** anywhere in UI text.
- **Owner style rule:** don't compromise simplicity for structure; match existing code style.
- `npx tsc --noEmit` must be clean before every commit. Full suite green before every commit (currently 56/56 across 12 files; it grows).
- Never `vercel env pull` into `.env.local` (blanks encrypted vars).
- Deploys are owner-ordered — do not deploy without an explicit go.

---

### Task 1: Schema — `meal_overrides` table + `foods.one_off` (migration 0005)

**Files:**
- Modify: `db/schema.ts` (add `oneOff` to `foods`; add `mealOverrides` table)
- Modify: `db/seed.ts` (add `mealOverrides` to the wipe list)
- Create: `db/migrations/0005_*.sql` (generated)

**Interfaces:**
- Consumes: existing `foods`, `meals` tables.
- Produces: `mealOverrides` table export (`id, date, mealId, foodId, quantity numeric(8,3), writeBatchId uuid, createdAt`); `foods.oneOff: boolean NOT NULL DEFAULT false`. Every later task references these.

- [ ] **Step 1: Add `oneOff` to the `foods` table in `db/schema.ts`**

Insert after the `displayQty` column (keep the existing comment style):

```ts
  // Off-plan foods captured by chat (restaurant meals, estimates). They must live
  // in foods so macros resolve via resolveItem, but they are not groceries — the
  // Groceries screen hides one_off rows.
  oneOff: boolean("one_off").notNull().default(false),
```

- [ ] **Step 2: Add the `mealOverrides` table to `db/schema.ts`**

Insert after the `mealStatus` table definition:

```ts
// Day-scoped plan adaptation (chat deviation feature). Rows for (date, meal_id)
// replace that meal's template meal_items FOR THAT DATE ONLY; no rows = template
// applies, so tomorrow auto-reverts with nothing to clean up. write_batch_id
// groups one override_meal call for batch Undo.
export const mealOverrides = pgTable("meal_overrides", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  mealId: integer("meal_id")
    .notNull()
    .references(() => meals.id, { onDelete: "cascade" }),
  foodId: integer("food_id")
    .notNull()
    .references(() => foods.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 8, scale: 3 }).notNull(),
  writeBatchId: uuid("write_batch_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Add the table to the seed wipe list**

In `db/seed.ts`: add `mealOverrides` to the schema import, and add this as the FIRST delete in the wipe block (before `logEntries`) — its `foodId` FK is `restrict`, so foods can't be wiped while override rows exist:

```ts
  await db.delete(mealOverrides);
```

- [ ] **Step 4: Generate + inspect the migration**

Run: `npm run db:generate`
Expected: a new `db/migrations/0005_<name>.sql` containing `CREATE TABLE "meal_overrides"` (with both FKs) and `ALTER TABLE "foods" ADD COLUMN "one_off" boolean DEFAULT false NOT NULL`. Read the SQL to confirm before applying.

- [ ] **Step 5: Apply to Neon**

Run: `npm run db:migrate`
Expected: exits 0. (Uses `DATABASE_URL_UNPOOLED` from `.env.local`.)

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean, 56/56 (schema addition breaks nothing).

- [ ] **Step 7: Commit**

```bash
git add db/schema.ts db/seed.ts db/migrations/
git commit -m "feat(db): meal_overrides table + foods.one_off (migration 0005)"
```

---

### Task 2: Groceries screen hides `one_off` foods

**Files:**
- Modify: `lib/groceries.ts` (`listGroceries`, `getGroceryGroups`)
- Test: `lib/groceries.test.ts` (extend)

**Interfaces:**
- Consumes: `foods.oneOff` (Task 1).
- Produces: `listGroceries()` / `getGroceryGroups()` exclude `one_off` rows — no signature change.

- [ ] **Step 1: Write the failing tests** (append to `lib/groceries.test.ts`; add `foods`, `db`, `eq` imports if not already present):

```ts
describe("one_off foods are hidden from Groceries", () => {
  let oneOffId: number;

  beforeAll(async () => {
    const [row] = await db
      .insert(foods)
      .values({
        name: "ZZOFF Chipotle bowl (test)",
        servingDesc: "1 bowl",
        kcal: 650,
        proteinG: "45.00",
        carbsG: "60.00",
        fatG: "22.00",
        oneOff: true,
      })
      .returning({ id: foods.id });
    oneOffId = row.id;
  });

  afterAll(async () => {
    await db.delete(foods).where(eq(foods.id, oneOffId));
  });

  it("listGroceries excludes one_off foods", async () => {
    const list = await listGroceries();
    expect(list.some((g) => g.id === oneOffId)).toBe(false);
  });

  it("getGroceryGroups excludes one_off foods", async () => {
    const groups = await getGroceryGroups();
    expect(groups.groceries.some((g) => g.id === oneOffId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/groceries.test.ts`
Expected: the two new tests FAIL (the one_off food appears in both lists).

- [ ] **Step 3: Implement the filter**

In `lib/groceries.ts` — `listGroceries`:

```ts
export async function listGroceries(): Promise<GroceryView[]> {
  const rows = await db
    .select()
    .from(foods)
    .where(eq(foods.oneOff, false))
    .orderBy(asc(foods.name));
  return rows.map(toView);
}
```

In `getGroceryGroups`, apply the same `.where(eq(foods.oneOff, false))` to the first read of the `Promise.all` (the bare `db.select().from(foods)`); leave the `mealItems` join read untouched (template items are never one_off).

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/groceries.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/groceries.ts lib/groceries.test.ts
git commit -m "feat(groceries): hide one_off (off-plan) foods from the screen"
```

---

### Task 3: `lib/overrides.ts` — set/read overrides + Undo extension

**Files:**
- Create: `lib/overrides.ts`
- Modify: `lib/undo.ts` (delete override rows in `revertWriteBatch`)
- Test: `lib/overrides.test.ts` (new; sentinel **2099-05-05**)

**Interfaces:**
- Consumes: `mealOverrides` (Task 1); `resolveItem`/`formatPlanLine`/`formatMacros`/`sumResolved` from `lib/resolve-item.ts`.
- Produces (used by Tasks 4, 5, 7, 8):
  - `setMealOverride(date: string, mealId: number, items: OverrideItemInput[]): Promise<SetMealOverrideResult>` — throws on empty items / unknown food / non-positive qty.
  - `getOverridesForDate(date: string): Promise<Map<number, OverrideLine[]>>` — keyed by mealId, insertion-ordered.
  - `type OverrideItemInput = { foodId: number; quantity: number }`
  - `type OverrideLine = { foodId: number; quantity: number; food: { name: string; servingDesc: string; kcal: number; proteinG: number; carbsG: number; fatG: number; rawToCookedYield: number | null } }`
  - `type SetMealOverrideResult = { writeBatchId: string; lines: string[]; total: string }`

- [ ] **Step 1: Write the failing tests** — create `lib/overrides.test.ts`:

```ts
import "../db/env";
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { foods, logEntries, mealOverrides, meals, mealStatus } from "../db/schema";
import { getOverridesForDate, setMealOverride } from "./overrides";
import { revertWriteBatch } from "./undo";

// Own sentinel per test FILE — vitest runs files in parallel against live Neon.
const DATE = "2099-05-05";

async function cleanup() {
  await db.delete(mealOverrides).where(eq(mealOverrides.date, DATE));
  await db.delete(logEntries).where(eq(logEntries.date, DATE));
  await db.delete(mealStatus).where(eq(mealStatus.date, DATE));
}
afterEach(cleanup);
afterAll(cleanup);

// Pick real seeded rows dynamically — food names change over time (e.g. the
// Large Eggs rename), so never hardcode them.
async function anyTwoFoods() {
  return db.select().from(foods).orderBy(asc(foods.id)).limit(2);
}
async function firstMeal() {
  const [m] = await db
    .select({ id: meals.id, name: meals.name })
    .from(meals)
    .orderBy(asc(meals.sortOrder))
    .limit(1);
  return m;
}

describe("setMealOverride", () => {
  it("writes rows and returns resolved lines + total + batch id", async () => {
    const [f1, f2] = await anyTwoFoods();
    const meal = await firstMeal();
    const res = await setMealOverride(DATE, meal.id, [
      { foodId: f1.id, quantity: 1 },
      { foodId: f2.id, quantity: 2 },
    ]);
    expect(res.writeBatchId).toBeTruthy();
    expect(res.lines).toHaveLength(2);
    expect(res.lines[0]).toContain(f1.name);
    expect(res.total).toMatch(/kcal/);
    const rows = await db
      .select()
      .from(mealOverrides)
      .where(and(eq(mealOverrides.date, DATE), eq(mealOverrides.mealId, meal.id)));
    expect(rows).toHaveLength(2);
  });

  it("re-override replaces the previous rows (last write wins)", async () => {
    const [f1, f2] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [
      { foodId: f1.id, quantity: 1 },
      { foodId: f2.id, quantity: 1 },
    ]);
    await setMealOverride(DATE, meal.id, [{ foodId: f2.id, quantity: 3 }]);
    const map = await getOverridesForDate(DATE);
    const lines = map.get(meal.id)!;
    expect(lines).toHaveLength(1);
    expect(lines[0].foodId).toBe(f2.id);
    expect(lines[0].quantity).toBe(3);
  });

  it("rejects unknown food ids and empty item lists", async () => {
    const meal = await firstMeal();
    await expect(
      setMealOverride(DATE, meal.id, [{ foodId: 999999, quantity: 1 }]),
    ).rejects.toThrow(/No food/);
    await expect(setMealOverride(DATE, meal.id, [])).rejects.toThrow(/non-empty/);
  });
});

describe("undo", () => {
  it("revertWriteBatch removes the override rows", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    const res = await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 1 }]);
    await revertWriteBatch(res.writeBatchId);
    const map = await getOverridesForDate(DATE);
    expect(map.has(meal.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/overrides.test.ts`
Expected: FAIL — `./overrides` module not found.

- [ ] **Step 3: Implement `lib/overrides.ts`**

```ts
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { foods, mealOverrides } from "../db/schema";
import { formatMacros, formatPlanLine, resolveItem, sumResolved } from "./resolve-item";

export type OverrideItemInput = { foodId: number; quantity: number };

/** One override row joined with its food, numerics already Number()ed. */
export type OverrideLine = {
  foodId: number;
  quantity: number;
  food: {
    name: string;
    servingDesc: string;
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    rawToCookedYield: number | null;
  };
};

export type SetMealOverrideResult = {
  writeBatchId: string;
  /** Resolved display lines (absolute amounts, never multipliers). */
  lines: string[];
  total: string;
};

type FoodRow = typeof foods.$inferSelect;

function toBasis(f: FoodRow) {
  return {
    name: f.name,
    servingDesc: f.servingDesc,
    kcal: f.kcal,
    proteinG: Number(f.proteinG),
    carbsG: Number(f.carbsG),
    fatG: Number(f.fatG),
    rawToCookedYield: f.rawToCookedYield === null ? null : Number(f.rawToCookedYield),
  };
}

/**
 * Replace a meal's planned items FOR ONE DATE ONLY (the template is untouched).
 * Deletes any prior override rows for (date, meal) — last write wins — and
 * inserts the new list under a fresh write_batch_id for batch Undo.
 * (neon-http has no interactive txns; sequential statements, fine single-user.)
 */
export async function setMealOverride(
  date: string,
  mealId: number,
  items: OverrideItemInput[],
): Promise<SetMealOverrideResult> {
  if (items.length === 0) throw new Error("items must be non-empty");
  const rows = await db
    .select()
    .from(foods)
    .where(inArray(foods.id, items.map((i) => i.foodId)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const it of items) {
    if (!byId.has(it.foodId)) throw new Error(`No food with id ${it.foodId}`);
    if (!(it.quantity > 0)) throw new Error("quantity must be positive");
  }

  const writeBatchId = randomUUID();
  await db
    .delete(mealOverrides)
    .where(and(eq(mealOverrides.date, date), eq(mealOverrides.mealId, mealId)));
  await db.insert(mealOverrides).values(
    items.map((it) => ({
      date,
      mealId,
      foodId: it.foodId,
      quantity: String(it.quantity),
      writeBatchId,
    })),
  );

  const resolved = items.map((it) => resolveItem(it.quantity, toBasis(byId.get(it.foodId)!)));
  const lines = resolved.map((r, i) => formatPlanLine(r, byId.get(items[i].foodId)!.name));
  return { writeBatchId, lines, total: formatMacros(sumResolved(resolved)) };
}

/** All override rows for a date, joined with foods, keyed by meal id. */
export async function getOverridesForDate(date: string): Promise<Map<number, OverrideLine[]>> {
  const rows = await db
    .select({
      mealId: mealOverrides.mealId,
      foodId: mealOverrides.foodId,
      quantity: mealOverrides.quantity,
      name: foods.name,
      servingDesc: foods.servingDesc,
      kcal: foods.kcal,
      proteinG: foods.proteinG,
      carbsG: foods.carbsG,
      fatG: foods.fatG,
      rawToCookedYield: foods.rawToCookedYield,
    })
    .from(mealOverrides)
    .innerJoin(foods, eq(mealOverrides.foodId, foods.id))
    .where(eq(mealOverrides.date, date))
    .orderBy(asc(mealOverrides.id));

  const map = new Map<number, OverrideLine[]>();
  for (const r of rows) {
    const list = map.get(r.mealId) ?? [];
    list.push({
      foodId: r.foodId,
      quantity: Number(r.quantity),
      food: {
        name: r.name,
        servingDesc: r.servingDesc,
        kcal: r.kcal,
        proteinG: Number(r.proteinG),
        carbsG: Number(r.carbsG),
        fatG: Number(r.fatG),
        rawToCookedYield: r.rawToCookedYield === null ? null : Number(r.rawToCookedYield),
      },
    });
    map.set(r.mealId, list);
  }
  return map;
}
```

- [ ] **Step 4: Extend `lib/undo.ts`** — add `mealOverrides` to the import and a third delete:

```ts
import { eq } from "drizzle-orm";
import { db } from "../db";
import { logEntries, mealOverrides, mealStatus } from "../db/schema";

/**
 * Revert a write batch: delete the log_entries it created, clear the meal_status
 * row tied to the same batch, and remove any meal_overrides it set. Powers the
 * chat tool-card Undo.
 * (neon-http has no interactive txns; sequential deletes, fine single-user.)
 */
export async function revertWriteBatch(batchId: string): Promise<{ revertedEntries: number }> {
  const deleted = await db
    .delete(logEntries)
    .where(eq(logEntries.writeBatchId, batchId))
    .returning({ id: logEntries.id });
  await db.delete(mealStatus).where(eq(mealStatus.writeBatchId, batchId));
  await db.delete(mealOverrides).where(eq(mealOverrides.writeBatchId, batchId));
  return { revertedEntries: deleted.length };
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run lib/overrides.test.ts`
Expected: all PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/overrides.ts lib/overrides.test.ts lib/undo.ts
git commit -m "feat(chat): meal override lib — day-scoped plan adaptation + batch undo"
```

---

### Task 4: `getTodayView` renders override items + `adjusted` flag

**Files:**
- Modify: `lib/today.ts`
- Test: `lib/overrides.test.ts` (extend — same file, same sentinel; in-file tests run sequentially)

**Interfaces:**
- Consumes: `getOverridesForDate` (Task 3).
- Produces: `TodayMeal` gains `adjusted: boolean`; when an override exists for `(date, meal)`, `items` and `plannedKcal` come from the override (still via `resolveItem`). Task 10's UI reads `meal.adjusted`.

- [ ] **Step 1: Write the failing test** (append to `lib/overrides.test.ts`; add `import { getTodayView } from "./today";`):

```ts
describe("getTodayView with overrides", () => {
  it("renders override items, recomputes plannedKcal, and marks the meal adjusted", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 2 }]);
    const view = await getTodayView(DATE);
    const m = view.meals.find((x) => x.id === meal.id)!;
    expect(m.adjusted).toBe(true);
    expect(m.items).toHaveLength(1);
    expect(m.items[0].foodName).toBe(f1.name);
    expect(m.plannedKcal).toBe(m.items[0].kcal);
    expect(view.meals.filter((x) => x.id !== meal.id).every((x) => !x.adjusted)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/overrides.test.ts`
Expected: new test FAILS (`adjusted` undefined, items are the template's).

- [ ] **Step 3: Implement in `lib/today.ts`**

1. Add imports: `import { getOverridesForDate } from "./overrides";`
2. Add to `TodayMeal`:

```ts
  /** True when meal_overrides replaced this meal's items for `date` (today only). */
  adjusted: boolean;
```

3. Add `getOverridesForDate(date)` as a sixth member of the existing `Promise.all` batch (destructure as `overrides`).
4. After the template `itemsByMeal`/`plannedKcal` loop, overlay the overrides (same resolve path as the template loop):

```ts
  // Day-scoped overrides replace the template's items for this date only.
  for (const [mealId, lines] of overrides) {
    const list: TodayMealItem[] = [];
    let kcalSum = 0;
    for (const line of lines) {
      const plate = resolveItem(line.quantity, line.food);
      const one = resolveItem(1, line.food);
      list.push({
        foodName: line.food.name,
        amountLabel: plate.amountLabel,
        rawLabel: plate.rawLabel,
        kcal: plate.kcal,
        proteinG: plate.proteinG,
        carbsG: plate.carbsG,
        fatG: plate.fatG,
        servingLabel: one.amountLabel,
        serving: { kcal: one.kcal, proteinG: one.proteinG, carbsG: one.carbsG, fatG: one.fatG },
      });
      kcalSum += plate.kcal;
    }
    itemsByMeal.set(mealId, list);
    plannedKcal.set(mealId, kcalSum);
  }
```

5. In `mealsView`'s map callback, add `adjusted: overrides.has(m.id),` to the returned object.

- [ ] **Step 4: Run tests + full suite**

Run: `npx vitest run lib/overrides.test.ts && npm test`
Expected: all PASS (today.test.ts unaffected — its sentinel has no overrides).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/today.ts lib/overrides.test.ts
git commit -m "feat(today): render day-scoped meal overrides + adjusted flag"
```

---

### Task 5: `setMealStatus('eaten')` fills gaps from the override

**Files:**
- Modify: `lib/meal-status.ts`
- Test: `lib/overrides.test.ts` (extend)

**Interfaces:**
- Consumes: `getOverridesForDate` (Task 3).
- Produces: no signature change — the eaten path logs override items when they exist for `(date, meal)`, template items otherwise.

- [ ] **Step 1: Write the failing tests** (append to `lib/overrides.test.ts`; add `import { setMealStatus } from "./meal-status";`):

```ts
describe("mark-eaten with an override", () => {
  it("logs the override items, not the template's", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 2 }]);
    const res = await setMealStatus(DATE, meal.id, "eaten");
    expect(res.loggedFoodIds).toEqual([f1.id]);
    const rows = await db
      .select()
      .from(logEntries)
      .where(and(eq(logEntries.date, DATE), eq(logEntries.mealId, meal.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].foodId).toBe(f1.id);
    expect(rows[0].kcal).toBe(Math.round(f1.kcal * 2));
  });

  it("undoing mark-eaten reverts the logs but keeps the override", async () => {
    const [f1] = await anyTwoFoods();
    const meal = await firstMeal();
    await setMealOverride(DATE, meal.id, [{ foodId: f1.id, quantity: 1 }]);
    await setMealStatus(DATE, meal.id, "eaten");
    await setMealStatus(DATE, meal.id, "pending");
    const logs = await db.select().from(logEntries).where(eq(logEntries.date, DATE));
    expect(logs).toHaveLength(0);
    const map = await getOverridesForDate(DATE);
    expect(map.get(meal.id)).toHaveLength(1); // separate batch — override survives
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/overrides.test.ts`
Expected: first new test FAILS (template items logged instead of the override's).

- [ ] **Step 3: Implement in `lib/meal-status.ts`**

Add `import { getOverridesForDate } from "./overrides";`. In the eaten branch, extend the existing `Promise.all` and pick the planned list:

```ts
  const [templatePlanned, existing, overridesMap] = await Promise.all([
    db
      .select({
        foodId: mealItems.foodId,
        quantity: mealItems.quantity,
        kcal: foods.kcal,
        proteinG: foods.proteinG,
        carbsG: foods.carbsG,
        fatG: foods.fatG,
      })
      .from(mealItems)
      .innerJoin(foods, eq(mealItems.foodId, foods.id))
      .where(eq(mealItems.mealId, mealId)),
    db
      .select({ foodId: logEntries.foodId })
      .from(logEntries)
      .where(and(eq(logEntries.date, date), eq(logEntries.mealId, mealId))),
    getOverridesForDate(date),
  ]);

  // A day-scoped override replaces the template as "what was planned" for today.
  const ov = overridesMap.get(mealId);
  const planned = ov
    ? ov.map((l) => ({
        foodId: l.foodId,
        quantity: String(l.quantity),
        kcal: l.food.kcal,
        proteinG: l.food.proteinG.toFixed(2),
        carbsG: l.food.carbsG.toFixed(2),
        fatG: l.food.fatG.toFixed(2),
      }))
    : templatePlanned;
```

The rest of the branch (`alreadyLogged`, `gaps`, insert, `upsertStatus`) is unchanged — it already works off `planned`.

- [ ] **Step 4: Run tests + full suite**

Run: `npx vitest run lib/overrides.test.ts && npm test`
Expected: all PASS (meal-status.test.ts sentinel 2099-02-02 has no overrides — untouched behavior).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/meal-status.ts lib/overrides.test.ts
git commit -m "feat(meals): mark-eaten fills gaps from the day's override when one exists"
```

---

### Task 6: `lib/fetch-page.ts` — owner-pasted URL → readable text

**Files:**
- Create: `lib/fetch-page.ts`
- Test: `lib/fetch-page.test.ts` (pure — no network, no DB)

**Interfaces:**
- Produces (used by Task 7):
  - `htmlToText(html: string): string` — pure; strips script/style/comments/tags, decodes basic entities, collapses whitespace, caps at 20 000 chars.
  - `urlGuardError(raw: string): string | null` — pure; null = OK, else a human-readable rejection.
  - `fetchPage(url: string): Promise<{ ok: true; text: string } | { ok: false; error: string }>` — never throws.

- [ ] **Step 1: Write the failing tests** — create `lib/fetch-page.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { htmlToText, urlGuardError } from "./fetch-page";

describe("htmlToText", () => {
  it("strips tags, scripts, styles, comments; collapses whitespace", () => {
    const html = `<html><head><style>.x{color:red}</style><script>var a=1;</script></head>
      <body><!-- nav --><h1>Menu</h1><p>Chicken bowl  <b>650</b> kcal</p></body></html>`;
    expect(htmlToText(html)).toBe("Menu Chicken bowl 650 kcal");
  });

  it("decodes basic entities", () => {
    expect(htmlToText("<p>Mac &amp; cheese &gt; 500 kcal</p>")).toBe("Mac & cheese > 500 kcal");
  });

  it("caps output at 20000 chars", () => {
    expect(htmlToText(`<p>${"a".repeat(30000)}</p>`).length).toBe(20000);
  });
});

describe("urlGuardError", () => {
  it("accepts public http(s) URLs", () => {
    expect(urlGuardError("https://www.chipotle.com/nutrition-calculator")).toBeNull();
    expect(urlGuardError("http://example.com/menu.html")).toBeNull();
  });

  it.each([
    "notaurl",
    "ftp://example.com/x",
    "file:///etc/passwd",
    "http://localhost:3100/",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.1.1/",
    "http://[::1]/",
  ])("rejects %s", (u) => {
    expect(urlGuardError(u)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/fetch-page.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/fetch-page.ts`**

```ts
// Fetch an owner-pasted URL (menu / nutrition page) and reduce it to readable
// text the model can extract macros from. BEST-EFFORT by design: big retailers
// (Walmart/Amazon/Target) bot-wall server fetches — those return an honest error
// and the chat rules make Kal say so and climb to the next ladder rung.

const MAX_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 10_000;

/** Strip an HTML document to readable text. Pure. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

/**
 * Reject anything that isn't public http(s): other protocols, localhost,
 * private/link-local IPv4 ranges, IP-literal IPv6. Cheap SSRF guard — the app
 * is single-user behind auth, but the fetch runs server-side.
 */
export function urlGuardError(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Not a valid URL.";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return "Only http(s) URLs are supported.";
  }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return "Local addresses are not allowed.";
  if (host.includes(":") || host.startsWith("[")) return "IP-literal addresses are not allowed.";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      return "Private addresses are not allowed.";
    }
  }
  return null;
}

/** Fetch + strip a page. Never throws — errors come back as { ok: false }. */
export async function fetchPage(
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const guard = urlGuardError(url);
  if (guard) return { ok: false, error: guard };
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KalBot/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
    });
    if (!res.ok) return { ok: false, error: `Fetch failed: HTTP ${res.status}.` };
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml|text\/plain/.test(ct)) {
      return { ok: false, error: `Unsupported content type: ${ct || "unknown"}.` };
    }
    const body = await res.text();
    const text = ct.includes("text/plain")
      ? body.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS)
      : htmlToText(body);
    if (!text) return { ok: false, error: "Page had no readable text (likely bot-walled or empty)." };
    return { ok: true, text };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.name === "TimeoutError"
          ? "Fetch timed out."
          : "Fetch failed (network error or blocked).",
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/fetch-page.test.ts`
Expected: all PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/fetch-page.ts lib/fetch-page.test.ts
git commit -m "feat(chat): fetch-page lib — owner-pasted URLs to readable text (guarded, best-effort)"
```

---

### Task 7: Chat tools — `search_nutrition`, `fetch_page`, `override_meal`, `log_food` flags

**Files:**
- Modify: `lib/tools.ts`
- Test: `lib/tools-deviation.test.ts` (new; sentinel **2099-06-06**)

**Interfaces:**
- Consumes: `searchNutrition` (`lib/nutrition-lookup.ts`, existing), `fetchPage` (Task 6), `setMealOverride`/`OverrideItemInput` (Task 3).
- Produces: three new entries in `TOOLS` + `runTool` cases; `log_food` new-food path accepts `is_estimated` and `one_off` booleans. Task 9's prompt rules name these tools — keep the names exactly `search_nutrition`, `fetch_page`, `override_meal`.

- [ ] **Step 1: Write the failing tests** — create `lib/tools-deviation.test.ts`:

```ts
import "../db/env";
import { describe, it, expect, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { foods, logEntries, mealOverrides, meals } from "../db/schema";
import { runTool } from "./tools";
import { revertWriteBatch } from "./undo";

const DATE = "2099-06-06"; // own sentinel — parallel test files

afterAll(async () => {
  await db.delete(mealOverrides).where(eq(mealOverrides.date, DATE));
  await db.delete(logEntries).where(eq(logEntries.date, DATE));
});

async function firstFood() {
  const [f] = await db.select().from(foods).orderBy(asc(foods.id)).limit(1);
  return f;
}
async function firstMeal() {
  const [m] = await db.select().from(meals).orderBy(asc(meals.sortOrder)).limit(1);
  return m;
}

describe("override_meal tool", () => {
  it("writes an override and returns an undoable card", async () => {
    const f = await firstFood();
    const m = await firstMeal();
    const run = await runTool("override_meal", {
      meal_id: m.id,
      items: [{ food_id: f.id, quantity: 2 }],
      date: DATE,
    });
    expect(run.writeBatchId).toBeTruthy();
    expect(run.card?.label).toBe("Meal adjusted");
    expect(run.forModel).toContain(f.name);
    const rows = await db.select().from(mealOverrides).where(eq(mealOverrides.date, DATE));
    expect(rows).toHaveLength(1);
    await revertWriteBatch(run.writeBatchId!);
    const after = await db.select().from(mealOverrides).where(eq(mealOverrides.date, DATE));
    expect(after).toHaveLength(0);
  });

  it("returns an error result for an unknown food id (nothing written)", async () => {
    const m = await firstMeal();
    const run = await runTool("override_meal", {
      meal_id: m.id,
      items: [{ food_id: 999999, quantity: 1 }],
      date: DATE,
    });
    expect(run.forModel).toContain("error");
    expect(run.writeBatchId).toBeNull();
    const rows = await db.select().from(mealOverrides).where(eq(mealOverrides.date, DATE));
    expect(rows).toHaveLength(0);
  });
});

describe("knowledge-ladder tools", () => {
  it("search_nutrition with an empty query returns no hits (no network call)", async () => {
    const run = await runTool("search_nutrition", { query: "  " });
    expect(JSON.parse(run.forModel)).toEqual({ hits: [] });
  });

  it("fetch_page rejects a non-http URL (no network call)", async () => {
    const run = await runTool("fetch_page", { url: "ftp://example.com/menu" });
    expect(run.forModel).toContain("error");
  });
});

describe("log_food off-plan flags", () => {
  it("new-food path honors is_estimated and one_off", async () => {
    const run = await runTool("log_food", {
      name: "ZZDEV test bowl",
      kcal: 500,
      protein_g: 30,
      carbs_g: 50,
      fat_g: 15,
      serving_desc: "1 bowl",
      is_estimated: true,
      one_off: true,
      date: DATE,
    });
    expect(JSON.parse(run.forModel).logged.name).toBe("ZZDEV test bowl");
    const [f] = await db.select().from(foods).where(eq(foods.name, "ZZDEV test bowl"));
    expect(f.isEstimated).toBe(true);
    expect(f.oneOff).toBe(true);
    // Cleanup: log rows first (foods FK is restrict), then the food itself.
    await db.delete(logEntries).where(eq(logEntries.foodId, f.id));
    await db.delete(foods).where(eq(foods.id, f.id));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/tools-deviation.test.ts`
Expected: FAIL — `Unknown tool: override_meal` etc.

- [ ] **Step 3: Implement in `lib/tools.ts`**

Add imports:

```ts
import { fetchPage } from "./fetch-page";
import { searchNutrition } from "./nutrition-lookup";
import { setMealOverride, type OverrideItemInput } from "./overrides";
```

Append three entries to `TOOLS`:

```ts
  {
    name: "search_nutrition",
    description:
      "Search public nutrition databases (USDA + OpenFoodFacts) for a food's label macros by name. Use for OFF-PLAN foods not in the owner's library (restaurants, travel, packaged foods) BEFORE asking the owner for a source or estimating. Hits are per label serving with a source tag.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Food name, e.g. 'Chipotle chicken bowl' or 'Clif Bar chocolate chip'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_page",
    description:
      "Fetch a web page the owner pasted (menu or nutrition page) and return its readable text so you can extract macros. Best-effort: many retail sites block server fetches — if this errors, tell the owner plainly and fall back to a photo or a confirmed estimate. Never fabricate page content.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The http(s) URL the owner provided." },
      },
      required: ["url"],
    },
  },
  {
    name: "override_meal",
    description:
      "Adapt TODAY'S plan only: replace one meal's planned items for one date (a deviation — traveling, eating out). The template plan is NEVER changed. Pass the FULL replacement item list (include any kept items). Foods must already exist in the library — for off-plan foods use log_food's new-food path or add_grocery first. quantity is a multiplier of the food's serving basis (per-100 g foods: 1.7 means 170 g).",
    input_schema: {
      type: "object",
      properties: {
        meal_id: { type: "integer", description: "The meal to adapt." },
        items: {
          type: "array",
          description: "Full replacement item list for the meal.",
          items: {
            type: "object",
            properties: {
              food_id: { type: "integer", description: "Existing library food id." },
              quantity: { type: "number", description: "Multiplier of the food's serving basis." },
            },
            required: ["food_id", "quantity"],
          },
        },
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
      },
      required: ["meal_id", "items"],
    },
  },
```

Extend `log_food`'s `input_schema.properties` with:

```ts
        is_estimated: {
          type: "boolean",
          description:
            "New food only: true when the macros are your estimate rather than a label or database hit.",
        },
        one_off: {
          type: "boolean",
          description:
            "New food only: true for off-plan one-offs (restaurant/travel food) so they don't appear in the Groceries screen.",
        },
```

In `log_food`'s new-food insert, add two values:

```ts
            isEstimated: input.is_estimated === true,
            oneOff: input.one_off === true,
```

Add three `runTool` cases (before `default`):

```ts
    case "search_nutrition": {
      const query = str(input.query) ?? "";
      const hits = await searchNutrition(query);
      return ok({ hits }, `Nutrition search "${query.trim()}" (${hits.length} hits)`);
    }

    case "fetch_page": {
      const url = str(input.url);
      if (!url) return err("url is required.");
      const page = await fetchPage(url);
      if (!page.ok) return err(page.error);
      return ok({ text: page.text }, `Fetched ${url} (${page.text.length} chars)`);
    }

    case "override_meal": {
      const mealId = num(input.meal_id);
      const rawItems = Array.isArray(input.items) ? input.items : null;
      if (mealId === undefined || !rawItems || rawItems.length === 0) {
        return err("meal_id and a non-empty items array are required.");
      }
      const items: OverrideItemInput[] = [];
      for (const raw of rawItems) {
        const o = raw as Record<string, unknown>;
        const foodId = num(o.food_id);
        const quantity = num(o.quantity);
        if (foodId === undefined || quantity === undefined || quantity <= 0) {
          return err("Each item needs a food_id and a positive quantity.");
        }
        items.push({ foodId, quantity });
      }
      const date = str(input.date) ?? today;
      try {
        const result = await setMealOverride(date, mealId, items);
        const [meal] = await db.select({ name: meals.name }).from(meals).where(eq(meals.id, mealId));
        const mealName = meal?.name ?? `Meal ${mealId}`;
        return ok(
          { adjusted: mealName, date, lines: result.lines, total: result.total },
          `Adjusted ${mealName} for ${date} (${items.length} items)`,
          {
            writeBatchId: result.writeBatchId,
            card: { label: "Meal adjusted", title: `${mealName} (today only)`, detail: result.total },
          },
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : "override failed");
      }
    }
```

- [ ] **Step 4: Run tests + full suite**

Run: `npx vitest run lib/tools-deviation.test.ts && npm test`
Expected: all PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/tools.ts lib/tools-deviation.test.ts
git commit -m "feat(chat): search_nutrition, fetch_page, override_meal tools + log_food off-plan flags"
```

---

### Task 8: System prompt static/dynamic split + prompt caching

**Files:**
- Modify: `lib/system-prompt.ts` (return `{ staticText, dynamicText }`)
- Modify: `lib/resolve-item.ts` (`PlanMeal.status` becomes optional)
- Modify: `app/api/chat/route.ts` (system blocks array, tool cache mark, rolling message mark)
- Test: `lib/system-prompt.test.ts` (new; sentinel **2099-07-07**)

**Interfaces:**
- Consumes: `getOverridesForDate` (Task 3), `buildPlanBlock` (modified here).
- Produces: `assembleSystemPrompt(date: string): Promise<{ staticText: string; dynamicText: string }>`. Task 9 edits the Rules inside `staticText`; Task 11 touches the route again.

**Why this shape:** the Anthropic prompt prefix is `tools → system blocks → messages`, and a cache breakpoint caches everything before it. Breakpoints used (max 4 allowed): (1) last tool, (2) static system block, (3) rolling marker on the conversation's last block. The dynamic block sits between (2) and (3): a mid-conversation write changes only the dynamic block, so breakpoints 1–2 still hit; within one request's tool loop nothing changes, so (3) makes each loop iteration re-read the whole history from cache. Haiku's minimum cacheable prefix is 2048 tokens — tools + static block clear it comfortably.

- [ ] **Step 1: Write the failing tests** — create `lib/system-prompt.test.ts`:

```ts
import "../db/env";
import { describe, it, expect, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { foods, mealOverrides, meals } from "../db/schema";
import { setMealOverride } from "./overrides";
import { assembleSystemPrompt } from "./system-prompt";

const DATE = "2099-07-07"; // own sentinel — parallel test files

afterAll(async () => {
  await db.delete(mealOverrides).where(eq(mealOverrides.date, DATE));
});

it("splits static (cacheable) and dynamic (per-day) content", async () => {
  const { staticText, dynamicText } = await assembleSystemPrompt(DATE);
  expect(staticText).toContain("MEAL PLAN TEMPLATE");
  expect(staticText).toContain("Rules:");
  expect(staticText).not.toContain(DATE); // nothing date-bound in the cacheable block
  expect(dynamicText).toContain(`TODAY (${DATE})`);
  expect(dynamicText).toContain("MEAL STATUS TODAY:");
  expect(dynamicText).toContain("remaining");
});

it("keeps staticText byte-identical across calls; overrides render only dynamically", async () => {
  const before = await assembleSystemPrompt(DATE);
  const [f] = await db.select().from(foods).orderBy(asc(foods.id)).limit(1);
  const [m] = await db.select().from(meals).orderBy(asc(meals.sortOrder)).limit(1);
  await setMealOverride(DATE, m.id, [{ foodId: f.id, quantity: 1 }]);
  const after = await assembleSystemPrompt(DATE);
  expect(after.staticText).toBe(before.staticText); // cache never busted by an override
  expect(after.dynamicText).toContain("ADJUSTED MEALS");
  expect(after.dynamicText).toContain(f.name);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/system-prompt.test.ts`
Expected: FAIL — `assembleSystemPrompt` returns a string, not blocks.

- [ ] **Step 3: Make `PlanMeal.status` optional in `lib/resolve-item.ts`**

```ts
export type PlanMeal = {
  id: number;
  name: string;
  /** Per-day status — omit for the date-independent template rendering. */
  status?: string;
  items: Array<{ quantity: number; food: FoodBasis }>;
};
```

And in `buildPlanBlock`, make the header conditional:

```ts
      const status = meal.status ? ` [${meal.status}]` : "";
      const header = `${meal.name.toUpperCase()} [meal id ${meal.id}]${status}`;
```

(Existing callers pass `status`, so `lib/resolve-item.test.ts` stays green.)

- [ ] **Step 4: Restructure `lib/system-prompt.ts`**

Add `import { getOverridesForDate } from "./overrides";`. Add `getOverridesForDate(date)` as the eighth member of the `Promise.all` (destructure as `overrides`). Keep all data-shaping code (itemsByMeal, statusByMeal, weightLine, memoryBlock) unchanged, EXCEPT the plan block no longer takes status:

```ts
  const planBlock = buildPlanBlock(
    mealRows.map((meal) => ({
      id: meal.id,
      name: meal.name,
      items: itemsByMeal.get(meal.id) ?? [],
    })),
  );
```

Replace the return with:

```ts
  const { targets, consumed, remaining } = summary;

  const staticText = `You are Kal, a personal nutrition assistant for the app's single owner. Be direct and quantitative.

PROFILE: ${p.age}yo ${p.sex}, ${p.heightCm}cm, ${Number(p.weightLb)}lb${
    p.bodyFatPct ? `, ${Number(p.bodyFatPct)}% body fat` : ""
  }${p.goalWeightLb ? `, goal ${Number(p.goalWeightLb)}lb${p.goalDate ? ` by ${p.goalDate}` : ""}` : ""}${
    p.activityLevel ? `, ${p.activityLevel}` : ""
  }.
DAILY TARGETS: ${targets.kcal} kcal / ${targets.proteinG}P / ${targets.carbsG}C / ${targets.fatG}F.
MEAL PLAN TEMPLATE (amounts absolute; macros pre-computed per line and per meal; today's per-meal status and any today-only adjustments are in the TODAY block below):
${planBlock}
MEMORY:
${memoryBlock}

Rules:
${RULES}`;

  const statusLine = mealRows
    .map((m) => `${m.name} [meal id ${m.id}]: ${statusByMeal.get(m.id) ?? "pending"}`)
    .join("; ");

  const adjustedMeals = mealRows
    .filter((m) => overrides.has(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      items: overrides.get(m.id)!.map((l) => ({ quantity: l.quantity, food: l.food })),
    }));
  const adjustedBlock = adjustedMeals.length
    ? `\nTODAY'S ADJUSTED MEALS (set via override_meal — these REPLACE the template for today only):\n${buildPlanBlock(adjustedMeals)}`
    : "";

  const dynamicText = `TODAY (${date}): consumed ${m(consumed.kcal)} kcal / ${m(consumed.proteinG)}P / ${m(
    consumed.carbsG,
  )}C / ${m(consumed.fatG)}F; remaining ${m(remaining.kcal)} kcal / ${m(remaining.proteinG)}P / ${m(
    remaining.carbsG,
  )}C / ${m(remaining.fatG)}F.
MEAL STATUS TODAY: ${statusLine}.${adjustedBlock}
WEIGHT: ${weightLine}`;

  return { staticText, dynamicText };
```

Hoist the existing rules text into a module-level `const RULES = \`- All food amounts...\`` (the exact rule lines currently in the template literal, unchanged — Task 9 extends them). Export the return type:

```ts
export type SystemPromptBlocks = { staticText: string; dynamicText: string };
```

and change the signature to `Promise<SystemPromptBlocks>`.

- [ ] **Step 5: Update `app/api/chat/route.ts`**

Replace `const system = await assembleSystemPrompt(date);` with:

```ts
  const { staticText, dynamicText } = await assembleSystemPrompt(date);
  // Cache breakpoints: (1) last tool, (2) static system block. The dynamic block
  // sits after them so per-day numbers never bust the tools+static prefix.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
  const tools: Anthropic.Tool[] = TOOLS.map((t, i) =>
    i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
  );
```

Add above `POST` (module scope):

```ts
// Breakpoint (3): keep one rolling cache marker on the conversation's last block
// so each tool-loop iteration (which replays the whole history) reads everything
// before it from cache. Old marks are stripped first — max 4 breakpoints total.
function setRollingCacheMark(messages: Msg[]) {
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) delete (b as { cache_control?: unknown }).cache_control;
    }
  }
  const last = messages[messages.length - 1];
  if (Array.isArray(last?.content) && last.content.length > 0) {
    (last.content[last.content.length - 1] as { cache_control?: unknown }).cache_control = {
      type: "ephemeral",
    };
  }
}
```

Inside the loop, call `setRollingCacheMark(messages);` immediately before `client.messages.stream({...})`, and change the stream params to use the new locals: `system`, `tools` (instead of `TOOLS`).

Note: messages are persisted to `chat_messages` BEFORE marks are applied, so no `cache_control` leaks into the DB.

- [ ] **Step 6: Run tests + full suite + typecheck**

Run: `npx vitest run lib/system-prompt.test.ts && npm test && npx tsc --noEmit`
Expected: all PASS, clean.

- [ ] **Step 7: Verify caching against the real API**

With the dev server up (`PORT=3100 npm run dev`, backgrounded; log in first):

```bash
# login (local password is [REDACTED]) — capture the session cookie
curl -si localhost:3100/api/auth/login -H 'Content-Type: application/json' \
  -d '{"password":"[REDACTED]"}' | grep -i '^set-cookie' | sed 's/^[Ss]et-[Cc]ookie: //;s/;.*//' > /tmp/kal-cookie.txt

SID=$(uuidgen)
# turn 1 — expect cacheWrite > 0 in the usage event
curl -sN localhost:3100/api/chat -H 'Content-Type: application/json' -H "Cookie: $(cat /tmp/kal-cookie.txt)" \
  -d "{\"sessionId\":\"$SID\",\"message\":\"What are my remaining macros?\"}" | grep '"type":"usage"'
# turn 2, same session — expect cacheRead > 0
curl -sN localhost:3100/api/chat -H 'Content-Type: application/json' -H "Cookie: $(cat /tmp/kal-cookie.txt)" \
  -d "{\"sessionId\":\"$SID\",\"message\":\"And how much protein is that per meal left?\"}" | grep '"type":"usage"'
```

Expected: turn 1 usage shows `cacheWrite` in the thousands; turn 2 shows `cacheRead` in the thousands and a visibly lower cost. If both are 0, the prefix is below Haiku's 2048-token cache minimum or the marks aren't applied — debug before proceeding.

- [ ] **Step 8: Commit**

```bash
git add lib/system-prompt.ts lib/system-prompt.test.ts lib/resolve-item.ts app/api/chat/route.ts
git commit -m "feat(chat): prompt caching — static/dynamic system split + rolling history marker"
```

---

### Task 9: Knowledge-ladder rules in the system prompt

**Files:**
- Modify: `lib/system-prompt.ts` (append to `RULES`)
- Test: `lib/system-prompt.test.ts` (extend)

**Interfaces:**
- Consumes: tool names from Task 7 (`search_nutrition`, `fetch_page`, `override_meal`) — referenced verbatim in the rules.
- Produces: the deviation behavior contract. No code interfaces.

- [ ] **Step 1: Write the failing test** (append to `lib/system-prompt.test.ts`):

```ts
it("static rules encode the off-plan knowledge ladder", async () => {
  const { staticText } = await assembleSystemPrompt(DATE);
  expect(staticText).toContain("OFF-PLAN FOODS");
  expect(staticText).toContain("search_nutrition");
  expect(staticText).toContain("fetch_page");
  expect(staticText).toContain("override_meal");
  expect(staticText).toContain("is_estimated=true");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/system-prompt.test.ts`
Expected: new test FAILS.

- [ ] **Step 3: Append to `RULES` in `lib/system-prompt.ts`** (after the existing last rule):

```
- OFF-PLAN FOODS (deviations: traveling, eating out, nothing prepped) — climb this ladder IN ORDER, never skip ahead:
  1) search_nutrition for real label data.
  2) If no usable hit, ask the owner for a source: a link to the menu or nutrition page (then fetch_page it), or a photo of the label/menu. If fetch_page fails, say so plainly and move on — never pretend you read a page.
  3) Only after 1 and 2 fail: give a clearly-labeled ESTIMATE. State the assumed portion and macros out loud and get an explicit yes BEFORE logging or adjusting anything. Save such foods via log_food's new-food path with is_estimated=true and one_off=true.
  The never-invent-a-serving-size rule stays ABSOLUTE for plan/library foods; estimating is allowed only in this off-plan lane, and never silently.
- To adapt today's plan around a deviation, use override_meal (today only — it never changes the template). Pass the FULL replacement item list. After that, set_meal_status('eaten') on that meal logs the adjusted items.
- When the same substitution keeps coming up (e.g. a usual travel dinner), save it with add_memory_fact so future chats already know it.
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run lib/system-prompt.test.ts && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 5: Live model smoke test** (real conversation quality check — dev server up, cookie from Task 8):

```bash
SID=$(uuidgen)
curl -sN localhost:3100/api/chat -H 'Content-Type: application/json' -H "Cookie: $(cat /tmp/kal-cookie.txt)" \
  -d "{\"sessionId\":\"$SID\",\"message\":\"I couldn't prep dinner — I'm at Chipotle. What should I order to stay on target?\"}"
```

Expected behavior: the model calls `get_day_summary` and `search_nutrition` (visible as `tool_use` events) and grounds its recommendation in remaining macros — no invented portions. Follow up in the same session with "yes — swap my dinner for that and log it" and confirm it calls `override_meal` (and logs). Then clean up: revert via `POST /api/undo` with the returned `writeBatchId`s, or delete today's `meal_overrides`/`log_entries` rows created by the test directly in the DB. Verify Today's screen is back to normal.

- [ ] **Step 6: Commit**

```bash
git add lib/system-prompt.ts lib/system-prompt.test.ts
git commit -m "feat(chat): off-plan knowledge-ladder rules (lookup -> source -> confirmed estimate)"
```

---

### Task 10: Today screen "adjusted" marker (mockup gate → build)

**Files:**
- Create: `design/deviation-adjusted-meal.html` (mockup — one focused round)
- Modify: `app/meal-list.tsx`, `app/meal-popup.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: `TodayMeal.adjusted` (Task 4).
- Produces: visible marker on adjusted meal rows + popup. No code interfaces.

- [ ] **Step 1: Build the mockup**

Create `design/deviation-adjusted-meal.html`: a self-contained static page replicating the Today meal-row style (copy fonts/colors from existing `design/today-meal-popup-*.html` mockups) showing 2–3 marker treatments on a sample "Dinner (adjusted)" row + the popup header — e.g. (A) tiny uppercase bordered tag after the name, (B) dot + italic "adjusted" under the time hint, (C) swapped-arrows glyph before the kcal. Owner picks one.

- [ ] **Step 2: CHECKPOINT — owner approval**

Show the mockup (open in browser). **Do not build until the owner picks a treatment.** Record the pick in the plan/commit message.

- [ ] **Step 3: Implement the chosen treatment** (reference code for treatment A — adapt to the owner's pick):

`app/meal-list.tsx` — inside the `.ct` span, after the name span:

```tsx
<span className="ct">
  <span className={`n${eaten ? " done" : ""}`}>{m.name}</span>
  {m.adjusted && <small className="adjtag">adjusted</small>}
  {!eaten && m.timeHint && <small>{m.timeHint}</small>}
</span>
```

`app/meal-popup.tsx` — add the same `{meal.adjusted && <span className="adjtag">adjusted</span>}` beside the title in the header row (read the file first; place it inside the existing header flex so the ✕ can't overlap).

`app/globals.css` — **first run `grep -n "adjtag" app/globals.css`** (must be empty — the `.mrow` collision lesson), then add near the other meal-list styles:

```css
.adjtag {
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 4px;
  align-self: center;
}
```

(Use the file's existing color tokens — check what the muted token is actually named before using `--ink-3`.)

- [ ] **Step 4: Verify in the real app**

`rm -rf .next` + restart dev server (CSS was touched), hard-refresh. Set a test override for today via a one-off script or the chat, load `localhost:3100`, confirm the tag renders on the row and in the popup, then remove the test override (delete today's `meal_overrides` rows) and confirm it disappears.

- [ ] **Step 5: Full suite + typecheck + commit**

```bash
npm test && npx tsc --noEmit
git add design/deviation-adjusted-meal.html app/meal-list.tsx app/meal-popup.tsx app/globals.css
git commit -m "feat(today): adjusted-meal marker (owner-picked treatment)"
```

---

### Task 11: Photos in chat (mockup gate → build; CUT-ABLE)

This phase is independent — everything before it ships without it. Skip on schedule pressure.

**Files:**
- Create: `design/chat-photo-attach.html` (mockup), `app/image-scale.ts`
- Modify: `app/chat/chat.tsx`, `app/groceries/groceries-list.tsx`, `app/api/chat/route.ts`, `app/globals.css` (if the owner's pick needs styles)

**Interfaces:**
- Consumes: chat route (Task 8's version).
- Produces: `fileToScaledJpeg(file: File, max?: number): Promise<{ base64: string; mediaType: "image/jpeg" }>` in `app/image-scale.ts`; chat POST body gains optional `imageBase64` + `mediaType`.

- [ ] **Step 1: Build the mockup**

Create `design/chat-photo-attach.html`: the chat composer with an attach affordance (2–3 small options: 📷 button left of the input / inside the input box / long-press on send) + a pending-image chip above the composer + how a sent image renders in the user bubble.

- [ ] **Step 2: CHECKPOINT — owner approval.** Do not build until picked.

- [ ] **Step 3: Extract the downscaler**

Create `app/image-scale.ts` by MOVING `fileToScaledJpeg` verbatim from `app/groceries/groceries-list.tsx` (lines ~12–35, including its comment) and adding `export`. In `groceries-list.tsx`, delete the local copy and add `import { fileToScaledJpeg } from "@/app/image-scale";`.

Run: `npx tsc --noEmit` — clean; Groceries photo flow still compiles.

- [ ] **Step 4: Route accepts an image**

In `app/api/chat/route.ts`:

```ts
const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];
```

In `POST`, after parsing `message`:

```ts
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : null;
  const mediaType = IMAGE_MEDIA_TYPES.includes(body.mediaType) ? (body.mediaType as ImageMediaType) : null;
  if (!sessionId || (!message && !(imageBase64 && mediaType))) {
    return Response.json({ error: "sessionId and a message or image are required" }, { status: 400 });
  }
  if (imageBase64 && imageBase64.length > 6_000_000) {
    return Response.json({ error: "image too large" }, { status: 400 });
  }
```

And build the user blocks with the image first:

```ts
  const userBlocks: Anthropic.ContentBlockParam[] = [];
  if (imageBase64 && mediaType) {
    userBlocks.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: imageBase64 },
    });
  }
  if (message) userBlocks.push({ type: "text", text: message });
```

(Persistence and history replay need no change — blocks go to `chat_messages.content` jsonb as-is; the 30-message cap bounds image token growth, and the rolling cache mark makes replays cheap.)

- [ ] **Step 5: Composer UI in `app/chat/chat.tsx`** (adapt placement to the owner's pick):

- State: `const [photo, setPhoto] = useState<{ base64: string; mediaType: "image/jpeg"; preview: string } | null>(null);` and a `const fileRef = useRef<HTMLInputElement>(null);`
- Hidden input + attach button in the composer box:

```tsx
<input
  ref={fileRef}
  type="file"
  accept="image/*"
  hidden
  onChange={async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const scaled = await fileToScaledJpeg(f);
    setPhoto({ ...scaled, preview: `data:image/jpeg;base64,${scaled.base64}` });
  }}
/>
<button type="button" className="attach" aria-label="Attach photo" onClick={() => fileRef.current?.click()} disabled={sending}>
  📷
</button>
```

- Pending chip above the composer when `photo` is set (thumbnail + ✕ to clear via `setPhoto(null)`).
- In `send()`: allow sending when `photo` exists even with empty text (`if ((!text && !photo) || sending || !sessionId) return;`); include the image in the fetch body (`imageBase64: photo?.base64, mediaType: photo?.mediaType`); render the user bubble with the thumbnail (extend the user `Item` with `imageUrl?: string`, render `<img src={it.imageUrl} alt="" />` above the text); `setPhoto(null)` after dispatch.
- `import { fileToScaledJpeg } from "@/app/image-scale";`

- [ ] **Step 6: Verify end-to-end**

Dev server up; in the browser, attach a real Nutrition-Facts photo, send "what's in this label?" — the model must read the actual macros off the image (Haiku vision). Check the DB `chat_messages` row stores the image block, and turn 2 of the session still streams normally. Also re-verify the Groceries label-photo flow still works (the moved downscaler).

- [ ] **Step 7: Full suite + typecheck + commit**

```bash
npm test && npx tsc --noEmit
git add app/image-scale.ts app/chat/chat.tsx app/groceries/groceries-list.tsx app/api/chat/route.ts app/globals.css design/chat-photo-attach.html
git commit -m "feat(chat): photo attachments — label/menu images straight into the conversation"
```

---

### Task 12: End-to-end verification, owner acceptance, STATE.md

**Files:**
- Modify: `STATE.md`

- [ ] **Step 1: Full verification pass**

```bash
npm test          # all files green (grew from 56/56 by ~15 tests across 4 new/2 extended files)
npx tsc --noEmit  # clean
npm run build     # route table: '/' and '/groceries' still ƒ (force-dynamic); /api/chat present
```

Then one full live deviation conversation via the UI (dev server): off-plan question → ladder behavior → "swap dinner + log it" → Today screen shows the adjusted marker + correct rings → Undo card reverts → screen back to template. Clean up any test rows.

- [ ] **Step 2: CHECKPOINT — owner acceptance**

The owner tries it (locally or asks for a deploy — deploys are owner-ordered). Only proceed to Step 3 after the owner confirms it's good.

- [ ] **Step 3: Update `STATE.md` in the same change as acceptance**

Per the maintenance protocol: bump *Last updated*; move **prompt caching** (backlog #2) out of the backlog; add a **Chat deviation copilot** section (schema 0005, ladder tools, overrides, caching numbers observed, photo phase if built); adjust the roadmap; add a parked backlog item: **"Grocery spend tracking — owner idea 2026-07-07: track spending per grocery run; needs a purchases-over-time model (foods.price alone can't answer weekly spend); own brainstorm when picked up."** Note the stale prompt line if Task 11 shipped: the add_grocery rule's "(Photo/QR auto-fill is a future feature…)" parenthetical should be updated to mention chat photos.

```bash
git add STATE.md
git commit -m "docs: STATE — chat deviation copilot (ladder tools, day overrides, prompt caching)"
```

---

## Self-review (done at plan-writing time)

- **Spec coverage:** ladder (Tasks 6, 7, 9) ✓; `meal_overrides` + `one_off` schema (Task 1) ✓; Groceries filter (Task 2) ✓; `override_meal` + Undo (Tasks 3, 7) ✓; Today merge + fill-the-gaps (Tasks 4, 5) ✓; caching split + verification (Task 8) ✓; photos own-phase cut-able (Task 11) ✓; adjusted marker + mockup gates (Tasks 10, 11) ✓; error handling (fetch guard Task 6, tool errs Task 7, no-confirm rule Task 9) ✓; testing strategy incl. fresh sentinels ✓; STATE.md + parked spend tracking (Task 12) ✓.
- **Type consistency:** `OverrideLine.food` matches `FoodBasis` shape consumed by `resolveItem`; `setMealOverride` result `{writeBatchId, lines, total}` used identically in Task 7; `TodayMeal.adjusted` produced in Task 4, consumed in Task 10; `assembleSystemPrompt` blocks produced in Task 8, consumed by route and Task 9 tests.
- **Placeholders:** none — every code step has complete code; the two UI tasks carry explicit owner-pick checkpoints with reference implementations.
