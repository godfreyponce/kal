# Groceries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `foods` library into a curated, weight-aware "Groceries" source of truth — a management screen plus weight-based chat logging that never silently estimates.

**Architecture:** Extend the existing `foods` table with grocery metadata + a per-serving gram weight; macros stay stored per serving so the meal plan / Today / mark-eaten are untouched. Weight logging is pure conversion (oz/g → grams → servings → snapshot). A `lib/groceries.ts` CRUD layer is shared by REST routes and the chat tools. A `/groceries` screen manages items.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM + Neon Postgres (`@neondatabase/serverless`, neon-http), `@anthropic-ai/sdk`, Vitest, Tailwind v4.

## Global Constraints

- **Dev server:** `PORT=3100 npm run dev` (port 3000 is taken). Don't start a duplicate (EADDRINUSE). Next dev hot-reloads `.env.local`.
- **Tests:** `npm test` (vitest) needs `DATABASE_URL`; integration tests hit **live Neon**. Vitest files run in **parallel** — every integration test file MUST use its **own** sentinel date / sentinel name and clean up after itself.
- **Type check:** `npx tsc --noEmit` MUST stay clean.
- **Migrations:** after editing `db/schema.ts` run `npm run db:generate` then `npm run db:migrate` (migrate uses `DATABASE_URL_UNPOOLED`).
- **`"today"`** comes only from `todayInAppTz()` — never raw `new Date()`.
- **Any page that reads live DB or the current day MUST `export const dynamic = "force-dynamic"`** (Next 16 prerenders static by default; neon queries aren't detected as dynamic). Verify the build route table shows `ƒ`, not `○`.
- **neon-http** has no interactive transactions and one HTTP round-trip per query — batch independent reads with `Promise.all`.
- **Numeric columns** are read/written as **strings** in Drizzle — write with `.toFixed(2)`, read with `Number(...)`.
- **Swappable-brain rule:** client components mutate only via REST routes; server components may read libs directly for first paint.
- Branch in progress: `groceries`.

---

### Task 1: Extend the `foods` schema + migrate

**Files:**
- Modify: `db/schema.ts:1-12` (imports) and `db/schema.ts:34-44` (`foods` table)
- Generated: `db/migrations/0001_*.sql` (created by db:generate)

**Interfaces:**
- Produces: new `foods` columns — `store: string|null`, `link: string|null`, `category: string|null`, `servingGrams: string|null` (numeric), `isEstimated: boolean` (default false), `purchaseWeight: string|null` (numeric, grams), `price: string|null` (numeric, USD).

- [ ] **Step 1: Add `boolean` to the pg-core import**

In `db/schema.ts`, add `boolean` to the existing import from `"drizzle-orm/pg-core"`:

```ts
import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  date,
  timestamp,
  jsonb,
  uuid,
  unique,
  boolean,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Add the seven columns to the `foods` table**

In `db/schema.ts`, replace the `foods` table definition with (only the trailing columns are new; keep existing ones exactly):

```ts
// Self-maintained food library = the owner's "Groceries". Macros are per one
// `serving_desc` unit; `serving_grams` gives that serving's weight so chat can
// log by weight (oz/g). `is_estimated=false` means the numbers came off a real
// label. purchase_weight (grams) + price are recorded attributes (no auto-decrement).
export const foods = pgTable("foods", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  brand: text("brand"),
  servingDesc: text("serving_desc").notNull(),
  kcal: integer("kcal").notNull(),
  proteinG: numeric("protein_g", { precision: 6, scale: 2 }).notNull(),
  carbsG: numeric("carbs_g", { precision: 6, scale: 2 }).notNull(),
  fatG: numeric("fat_g", { precision: 6, scale: 2 }).notNull(),
  store: text("store"),
  link: text("link"),
  category: text("category"),
  servingGrams: numeric("serving_grams", { precision: 8, scale: 2 }),
  isEstimated: boolean("is_estimated").notNull().default(false),
  purchaseWeight: numeric("purchase_weight", { precision: 8, scale: 2 }),
  price: numeric("price", { precision: 8, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `db/migrations/0001_*.sql` containing `ALTER TABLE "foods" ADD COLUMN ...` for all seven columns (the boolean one with `DEFAULT false NOT NULL`).

- [ ] **Step 4: Apply the migration to Neon**

Run: `npm run db:migrate`
Expected: applies cleanly. Existing rows get `is_estimated=false` and NULL for the rest.

- [ ] **Step 5: Verify schema + types**

Run: `npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 6: Commit**

```bash
git add db/schema.ts db/migrations
git commit -m "feat(groceries): extend foods with store/link/category/serving_grams/is_estimated/purchase_weight/price"
```

---

### Task 2: Weight-conversion units helper (`lib/units.ts`)

**Files:**
- Create: `lib/units.ts`
- Test: `lib/units.test.ts`

**Interfaces:**
- Produces: `OZ_TO_G = 28.3495`, `LB_TO_G = 453.592`, `toGrams(value: number, unit: "g"|"oz"|"lb"): number`, `weightToServings(grams: number, servingGrams: number): number`.

- [ ] **Step 1: Write the failing test**

Create `lib/units.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toGrams, weightToServings, OZ_TO_G } from "./units";

describe("toGrams", () => {
  it("passes grams through unchanged", () => {
    expect(toGrams(200, "g")).toBe(200);
  });
  it("converts ounces", () => {
    expect(toGrams(8, "oz")).toBeCloseTo(226.796, 2);
    expect(OZ_TO_G).toBe(28.3495);
  });
  it("converts pounds", () => {
    expect(toGrams(1, "lb")).toBeCloseTo(453.592, 2);
    expect(toGrams(4.35, "lb")).toBeCloseTo(1973.13, 1);
  });
});

describe("weightToServings", () => {
  it("divides grams by the serving weight", () => {
    expect(weightToServings(200, 100)).toBe(2);
    expect(weightToServings(226.796, 113.398)).toBeCloseTo(2, 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/units.test.ts`
Expected: FAIL — cannot find module `./units`.

- [ ] **Step 3: Write the implementation**

Create `lib/units.ts`:

```ts
// Weight conversions. Storage is canonical grams; forms/chat speak oz/lb/g.
export const OZ_TO_G = 28.3495;
export const LB_TO_G = 453.592;

export function toGrams(value: number, unit: "g" | "oz" | "lb"): number {
  if (unit === "oz") return value * OZ_TO_G;
  if (unit === "lb") return value * LB_TO_G;
  return value;
}

/** Servings = weight in grams ÷ the food's per-serving gram weight. */
export function weightToServings(grams: number, servingGrams: number): number {
  return grams / servingGrams;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/units.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/units.ts lib/units.test.ts
git commit -m "feat(groceries): weight-conversion helpers (oz/lb/g → grams, grams → servings)"
```

---

### Task 3: Grocery CRUD lib (`lib/groceries.ts`)

**Files:**
- Create: `lib/groceries.ts`
- Test: `lib/groceries.test.ts`

**Interfaces:**
- Consumes: `db`, `foods` (Task 1 columns).
- Produces:
  - `type GroceryInput` — `{ name: string; brand?: string|null; store?: string|null; link?: string|null; category?: string|null; servingGrams: number; kcal: number; proteinG: number; carbsG: number; fatG: number; purchaseWeightG?: number|null; price?: number|null; isEstimated?: boolean }`
  - `type GroceryView` — `{ id: number; name: string; brand: string|null; store: string|null; link: string|null; category: string|null; servingGrams: number|null; kcal: number; proteinG: number; carbsG: number; fatG: number; purchaseWeightG: number|null; price: number|null }`
  - `listGroceries(): Promise<GroceryView[]>`
  - `createGrocery(input: GroceryInput): Promise<GroceryView>`
  - `updateGrocery(id: number, patch: Partial<GroceryInput>): Promise<GroceryView | null>`
  - `deleteGrocery(id: number): Promise<void>` (throws on FK reference)

- [ ] **Step 1: Write the failing test**

Create `lib/groceries.test.ts`. Sentinel **name** (this file owns names starting `ZZTEST_`); cleans up after itself.

```ts
import "../db/env";
import { describe, it, expect, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db";
import { foods } from "../db/schema";
import { listGroceries, createGrocery, updateGrocery, deleteGrocery } from "./groceries";

const SENTINEL = "ZZTEST_GROCERY";

async function clear() {
  await db.delete(foods).where(like(foods.name, "ZZTEST_%"));
}
afterAll(clear);

describe("grocery CRUD", () => {
  it("creates, lists, updates, and deletes a grocery", async () => {
    const created = await createGrocery({
      name: SENTINEL,
      brand: "TestBrand",
      store: "Walmart",
      category: "protein",
      servingGrams: 100,
      kcal: 150,
      proteinG: 30,
      carbsG: 10,
      fatG: 5,
      purchaseWeightG: 1973.13,
      price: 12.5,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.servingGrams).toBe(100);
    expect(created.kcal).toBe(150);
    expect(created.proteinG).toBe(30);
    expect(created.price).toBe(12.5);

    const all = await listGroceries();
    expect(all.some((g) => g.id === created.id && g.name === SENTINEL)).toBe(true);

    const updated = await updateGrocery(created.id, { price: 9.99, store: "Costco" });
    expect(updated?.price).toBe(9.99);
    expect(updated?.store).toBe("Costco");

    await deleteGrocery(created.id);
    const [gone] = await db.select().from(foods).where(eq(foods.id, created.id));
    expect(gone).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/groceries.test.ts`
Expected: FAIL — cannot find module `./groceries`.

- [ ] **Step 3: Write the implementation**

Create `lib/groceries.ts`:

```ts
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { foods } from "../db/schema";

export type GroceryInput = {
  name: string;
  brand?: string | null;
  store?: string | null;
  link?: string | null;
  category?: string | null;
  servingGrams: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  purchaseWeightG?: number | null;
  price?: number | null;
  isEstimated?: boolean;
};

export type GroceryView = {
  id: number;
  name: string;
  brand: string | null;
  store: string | null;
  link: string | null;
  category: string | null;
  servingGrams: number | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  purchaseWeightG: number | null;
  price: number | null;
};

type Row = typeof foods.$inferSelect;
const numOrNull = (v: string | null): number | null => (v === null ? null : Number(v));
const strOrNull = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : v.toFixed(2);

function toView(r: Row): GroceryView {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    store: r.store,
    link: r.link,
    category: r.category,
    servingGrams: numOrNull(r.servingGrams),
    kcal: r.kcal,
    proteinG: Number(r.proteinG),
    carbsG: Number(r.carbsG),
    fatG: Number(r.fatG),
    purchaseWeightG: numOrNull(r.purchaseWeight),
    price: numOrNull(r.price),
  };
}

export async function listGroceries(): Promise<GroceryView[]> {
  const rows = await db.select().from(foods).orderBy(asc(foods.name));
  return rows.map(toView);
}

export async function createGrocery(input: GroceryInput): Promise<GroceryView> {
  const [row] = await db
    .insert(foods)
    .values({
      name: input.name,
      brand: input.brand ?? null,
      store: input.store ?? null,
      link: input.link ?? null,
      category: input.category ?? null,
      servingDesc: `${input.servingGrams} g`,
      servingGrams: input.servingGrams.toFixed(2),
      kcal: Math.round(input.kcal),
      proteinG: input.proteinG.toFixed(2),
      carbsG: input.carbsG.toFixed(2),
      fatG: input.fatG.toFixed(2),
      isEstimated: input.isEstimated ?? false,
      purchaseWeight: strOrNull(input.purchaseWeightG),
      price: strOrNull(input.price),
    })
    .returning();
  return toView(row);
}

export async function updateGrocery(
  id: number,
  patch: Partial<GroceryInput>,
): Promise<GroceryView | null> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.brand !== undefined) set.brand = patch.brand;
  if (patch.store !== undefined) set.store = patch.store;
  if (patch.link !== undefined) set.link = patch.link;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.servingGrams !== undefined) {
    set.servingGrams = patch.servingGrams.toFixed(2);
    set.servingDesc = `${patch.servingGrams} g`;
  }
  if (patch.kcal !== undefined) set.kcal = Math.round(patch.kcal);
  if (patch.proteinG !== undefined) set.proteinG = patch.proteinG.toFixed(2);
  if (patch.carbsG !== undefined) set.carbsG = patch.carbsG.toFixed(2);
  if (patch.fatG !== undefined) set.fatG = patch.fatG.toFixed(2);
  if (patch.isEstimated !== undefined) set.isEstimated = patch.isEstimated;
  if (patch.purchaseWeightG !== undefined) set.purchaseWeight = strOrNull(patch.purchaseWeightG);
  if (patch.price !== undefined) set.price = strOrNull(patch.price);

  if (Object.keys(set).length === 0) {
    const [row] = await db.select().from(foods).where(eq(foods.id, id));
    return row ? toView(row) : null;
  }
  const [row] = await db.update(foods).set(set).where(eq(foods.id, id)).returning();
  return row ? toView(row) : null;
}

/** Throws if the food is referenced by meal_items or log_entries (FK restrict). */
export async function deleteGrocery(id: number): Promise<void> {
  await db.delete(foods).where(eq(foods.id, id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/groceries.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/groceries.ts lib/groceries.test.ts
git commit -m "feat(groceries): CRUD lib over foods (list/create/update/delete + view mapper)"
```

---

### Task 4: Chat tools — `add_grocery` + weight logging + source-of-truth prompt

**Files:**
- Modify: `lib/tools.ts` (imports, `TOOLS` array, `runTool` `log_food` case, new `add_grocery` case)
- Modify: `lib/system-prompt.ts:93-97` (Rules block)
- Test: `lib/tools-groceries.test.ts`

**Interfaces:**
- Consumes: `createGrocery` (Task 3), `toGrams` (Task 2), `foods.servingGrams` (Task 1).
- Produces: tool `add_grocery`; `log_food` accepts `oz`/`grams`.

- [ ] **Step 1: Write the failing test**

Create `lib/tools-groceries.test.ts`. Own sentinel **date** `2099-03-03` and sentinel names `ZZTOOL_%`; cleans up.

```ts
import "../db/env";
import { describe, it, expect, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db";
import { foods, logEntries } from "../db/schema";
import { createGrocery } from "./groceries";
import { runTool } from "./tools";

const TEST_DATE = "2099-03-03";

async function clear() {
  await db.delete(logEntries).where(eq(logEntries.date, TEST_DATE));
  await db.delete(foods).where(like(foods.name, "ZZTOOL_%"));
}
afterAll(clear);

describe("add_grocery tool", () => {
  it("inserts a food with serving_grams and is_estimated=false", async () => {
    const run = await runTool("add_grocery", {
      name: "ZZTOOL_OIL",
      serving_grams: 14,
      kcal: 120,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 14,
      category: "oil",
    });
    expect(run.summary).toMatch(/Added grocery/);
    const [row] = await db.select().from(foods).where(eq(foods.name, "ZZTOOL_OIL"));
    expect(row).toBeTruthy();
    expect(Number(row.servingGrams)).toBe(14);
    expect(row.isEstimated).toBe(false);
  });
});

describe("log_food by weight", () => {
  it("converts grams to servings and snapshots the right macros", async () => {
    await clear();
    const g = await createGrocery({
      name: "ZZTOOL_CHICKEN",
      servingGrams: 100,
      kcal: 150,
      proteinG: 30,
      carbsG: 10,
      fatG: 5,
    });

    const run = await runTool("log_food", { food_id: g.id, grams: 200, date: TEST_DATE });
    expect(run.writeBatchId).toBeTruthy();

    const [entry] = await db
      .select()
      .from(logEntries)
      .where(eq(logEntries.date, TEST_DATE));
    expect(entry.kcal).toBe(300); // 150 * (200/100)
    expect(entry.proteinG).toBe("60.00");
    expect(entry.carbsG).toBe("20.00");
    expect(entry.fatG).toBe("10.00");
  });

  it("errors if the food has no serving weight set", async () => {
    const g = await createGrocery({
      name: "ZZTOOL_NOGRAMS",
      servingGrams: 100,
      kcal: 10,
      proteinG: 1,
      carbsG: 1,
      fatG: 1,
    });
    // Null out serving_grams to simulate a seeded food.
    await db.update(foods).set({ servingGrams: null }).where(eq(foods.id, g.id));
    const run = await runTool("log_food", { food_id: g.id, oz: 8, date: TEST_DATE });
    expect(run.summary).toMatch(/Error/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/tools-groceries.test.ts`
Expected: FAIL — `add_grocery` unknown tool / `log_food` ignores `grams`.

- [ ] **Step 3: Add imports to `lib/tools.ts`**

At the top of `lib/tools.ts`, add:

```ts
import { createGrocery } from "./groceries";
import { toGrams } from "./units";
```

- [ ] **Step 4: Add `oz`/`grams` to the `log_food` tool schema and the `add_grocery` tool**

In `lib/tools.ts`, in the `log_food` entry's `input_schema.properties`, add two properties (after `quantity`):

```ts
        oz: { type: "number", description: "Amount eaten in ounces (weight-based logging; needs an existing food_id with a serving weight)." },
        grams: { type: "number", description: "Amount eaten in grams (weight-based logging; needs an existing food_id with a serving weight)." },
```

Then add a new tool object to the `TOOLS` array (after `log_food`):

```ts
  {
    name: "add_grocery",
    description:
      "Add a real grocery item to the owner's library (the source of truth) from its label. Use when the owner ate something not yet in the library: ask for the brand and the label's nutrition facts (serving size in grams + per-serving macros), then call this, then log_food by weight. Never invent macros.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Food name." },
        brand: { type: "string", description: "Brand, if known." },
        store: { type: "string", description: "Where it was bought, e.g. Walmart." },
        link: { type: "string", description: "Optional product/label URL." },
        category: { type: "string", description: "Optional tag: protein, oil, seasoning, supplement, etc." },
        serving_grams: { type: "number", description: "Grams in one label serving." },
        kcal: { type: "number", description: "Calories per serving." },
        protein_g: { type: "number", description: "Protein grams per serving." },
        carbs_g: { type: "number", description: "Carb grams per serving." },
        fat_g: { type: "number", description: "Fat grams per serving." },
        purchase_weight_g: { type: "number", description: "Optional total package weight in grams." },
        price: { type: "number", description: "Optional price paid (USD)." },
      },
      required: ["name", "serving_grams", "kcal"],
    },
  },
```

- [ ] **Step 5: Add weight conversion to the `log_food` case**

In `runTool`'s `log_food` case, the existing `food_id` branch fetches `f` via `select().from(foods)`. Capture its serving weight and compute `qty` from a weight when given. Replace the start of the case (the `const qty = ...` line) and the food-resolution block so it reads:

```ts
    case "log_food": {
      const date = str(input.date) ?? today;
      const mealId = num(input.meal_id) ?? null;
      const writeBatchId = randomUUID();

      let foodId: number;
      let per: { name: string; kcal: number; proteinG: number; carbsG: number; fatG: number };
      let servingGrams: number | null = null;

      const foodIdInput = num(input.food_id);
      if (foodIdInput !== undefined) {
        const [f] = await db.select().from(foods).where(eq(foods.id, foodIdInput));
        if (!f) return err(`No food with id ${foodIdInput}`);
        per = {
          name: f.name,
          kcal: f.kcal,
          proteinG: Number(f.proteinG),
          carbsG: Number(f.carbsG),
          fatG: Number(f.fatG),
        };
        foodId = f.id;
        servingGrams = f.servingGrams === null ? null : Number(f.servingGrams);
      } else {
        const name2 = str(input.name);
        const kcal = num(input.kcal);
        if (!name2 || kcal === undefined) {
          return err("Provide food_id, or name plus per-serving kcal (and macros).");
        }
        per = {
          name: name2,
          kcal,
          proteinG: num(input.protein_g) ?? 0,
          carbsG: num(input.carbs_g) ?? 0,
          fatG: num(input.fat_g) ?? 0,
        };
        const [created] = await db
          .insert(foods)
          .values({
            name: name2,
            brand: null,
            servingDesc: str(input.serving_desc) ?? "1 serving",
            kcal: Math.round(kcal),
            proteinG: per.proteinG.toFixed(2),
            carbsG: per.carbsG.toFixed(2),
            fatG: per.fatG.toFixed(2),
          })
          .returning({ id: foods.id });
        foodId = created.id;
      }

      // Quantity: from weight (oz/grams) when given, else servings.
      const ozInput = num(input.oz);
      const gramsInput = num(input.grams);
      let qty: number;
      let weightLabel: string | null = null;
      if (ozInput !== undefined || gramsInput !== undefined) {
        if (servingGrams === null) {
          return err(`${per.name} has no serving weight set — add its grams in Groceries first.`);
        }
        const grams = ozInput !== undefined ? toGrams(ozInput, "oz") : gramsInput!;
        qty = grams / servingGrams;
        weightLabel = ozInput !== undefined ? `${ozInput} oz` : `${gramsInput} g`;
      } else {
        qty = num(input.quantity) ?? 1;
      }
```

Then leave the existing `const entry = {...}; await db.insert(logEntries)...` block as-is, but update the returned card `title` to prefer the weight label:

```ts
          card: {
            label: "Food logged",
            title: weightLabel ? `${per.name} · ${weightLabel}` : qty === 1 ? per.name : `${per.name} · ${qty}×`,
            detail: `${entry.kcal} kcal · ${entry.proteinG}P · ${entry.carbsG}C · ${entry.fatG}F`,
          },
```

(Remove the now-duplicated `const qty = num(input.quantity) ?? 1;` and `const date`/`const mealId`/`const writeBatchId` lines that previously opened the case — they are reproduced above.)

- [ ] **Step 6: Add the `add_grocery` case to `runTool`**

Add this case (e.g. after `add_memory_fact`):

```ts
    case "add_grocery": {
      const name = str(input.name);
      const servingGrams = num(input.serving_grams);
      const kcal = num(input.kcal);
      if (!name || servingGrams === undefined || kcal === undefined) {
        return err("name, serving_grams, and kcal are required.");
      }
      const g = await createGrocery({
        name,
        brand: str(input.brand) ?? null,
        store: str(input.store) ?? null,
        link: str(input.link) ?? null,
        category: str(input.category) ?? null,
        servingGrams,
        kcal,
        proteinG: num(input.protein_g) ?? 0,
        carbsG: num(input.carbs_g) ?? 0,
        fatG: num(input.fat_g) ?? 0,
        purchaseWeightG: num(input.purchase_weight_g) ?? null,
        price: num(input.price) ?? null,
      });
      return ok({ id: g.id, name: g.name }, `Added grocery ${g.name} (id ${g.id})`, {
        card: {
          label: "Grocery added",
          title: g.name,
          detail: `${g.kcal} kcal / ${servingGrams} g serving`,
        },
      });
    }
```

- [ ] **Step 7: Add the source-of-truth rules to the system prompt**

In `lib/system-prompt.ts`, in the final `Rules:` list (lines ~93-97), replace the single `log_food` rule line with these:

```ts
- To record eating, prefer set_meal_status('eaten') for a planned meal (it fills the gaps without double-counting).
- Log groceries by weight: use search_foods to find the item, then log_food with its food_id and the weight the owner gives (oz or grams). The grocery library is the source of truth — never invent macros.
- If a food isn't in the library, ask the owner for the brand and the label's nutrition facts (serving size in grams + kcal/protein/carbs/fat), then call add_grocery to save it, then log_food by weight. (Photo/QR auto-fill is a future feature; capture facts via chat for now.)
- Cooking additions like oil and seasoning are grocery items too — log them alongside the main food so cooking fat counts.
```

- [ ] **Step 8: Run the tools test**

Run: `npm test -- lib/tools-groceries.test.ts`
Expected: PASS (add_grocery insert; grams→macros snapshot 300/60/20/10; no-serving-weight error).

- [ ] **Step 9: Verify full suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: all green (prior 8 + new tests), tsc clean.

- [ ] **Step 10: Commit**

```bash
git add lib/tools.ts lib/system-prompt.ts lib/tools-groceries.test.ts
git commit -m "feat(groceries): add_grocery tool + weight-based log_food + source-of-truth chat rules"
```

---

### Task 5: REST routes for groceries

**Files:**
- Create: `app/api/groceries/route.ts` (GET list, POST create)
- Create: `app/api/groceries/[id]/route.ts` (PATCH update, DELETE)

**Interfaces:**
- Consumes: `listGroceries`, `createGrocery`, `updateGrocery`, `deleteGrocery`, `GroceryInput` (Task 3).
- Produces: `GET/POST /api/groceries`, `PATCH/DELETE /api/groceries/:id`.

- [ ] **Step 1: Create the collection route**

Create `app/api/groceries/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { listGroceries, createGrocery, type GroceryInput } from "@/lib/groceries";

// GET /api/groceries — list all grocery items.
export async function GET() {
  return Response.json(await listGroceries());
}

// POST /api/groceries — create. body: GroceryInput (servingGrams + kcal required).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const servingGrams = Number(body.servingGrams);
  const kcal = Number(body.kcal);
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  if (!Number.isFinite(servingGrams) || servingGrams <= 0) {
    return Response.json({ error: "servingGrams must be a positive number" }, { status: 400 });
  }
  if (!Number.isFinite(kcal) || kcal < 0) {
    return Response.json({ error: "kcal must be a non-negative number" }, { status: 400 });
  }

  const input: GroceryInput = {
    name,
    brand: body.brand ?? null,
    store: body.store ?? null,
    link: body.link ?? null,
    category: body.category ?? null,
    servingGrams,
    kcal,
    proteinG: Number(body.proteinG) || 0,
    carbsG: Number(body.carbsG) || 0,
    fatG: Number(body.fatG) || 0,
    purchaseWeightG: body.purchaseWeightG == null ? null : Number(body.purchaseWeightG),
    price: body.price == null ? null : Number(body.price),
  };
  return Response.json(await createGrocery(input), { status: 201 });
}
```

- [ ] **Step 2: Create the item route**

Create `app/api/groceries/[id]/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { updateGrocery, deleteGrocery, type GroceryInput } from "@/lib/groceries";

// PATCH /api/groceries/:id — partial update.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const groceryId = Number(id);
  if (!Number.isInteger(groceryId)) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const patch: Partial<GroceryInput> = {};
  for (const k of ["name", "brand", "store", "link", "category"] as const) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  for (const k of ["servingGrams", "kcal", "proteinG", "carbsG", "fatG", "purchaseWeightG", "price"] as const) {
    if (body[k] !== undefined) patch[k] = body[k] == null ? null : Number(body[k]);
  }
  const updated = await updateGrocery(groceryId, patch);
  if (!updated) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(updated);
}

// DELETE /api/groceries/:id — fails with 409 if the food is used by a meal or log.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const groceryId = Number(id);
  if (!Number.isInteger(groceryId)) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    await deleteGrocery(groceryId);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "This food is used by your meal plan or past logs and can't be deleted." },
      { status: 409 },
    );
  }
}
```

Note: `patch[k] = null` for `servingGrams`/`kcal` is type-widened by `Number(body[k])` paths; since the form never sends null for those, this is safe. TypeScript accepts the `as const` keyed assignment because `GroceryInput`'s optional numeric fields accept `number`.

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: clean. (If TS complains about `patch[k] = null` for non-nullable numeric keys, split the loop: handle `purchaseWeightG`/`price` (nullable) separately from `servingGrams`/`kcal`/`proteinG`/`carbsG`/`fatG` (coerce with `Number`).)

- [ ] **Step 4: Smoke-test via curl** (dev server on :3100; log in first to get a session cookie, or temporarily test the lib through the chat tool)

Start dev if needed: `PORT=3100 npm run dev` (backgrounded). Then:

```bash
# Create
curl -s -XPOST localhost:3100/api/groceries -H 'Content-Type: application/json' \
  -d '{"name":"ZZCURL_RICE","servingGrams":45,"kcal":160,"proteinG":3,"carbsG":36,"fatG":0.5,"store":"Walmart"}'
# List (find the id)
curl -s localhost:3100/api/groceries | grep ZZCURL_RICE
```

Expected: POST returns the created object (201) with `"servingGrams":45`; list includes it.
(If routes require auth and return 307/401, that's the proxy gate working — verify instead via the UI in Task 6, or set a local `APP_PASSWORD` and log in. Then delete the test row: `curl -s -XDELETE localhost:3100/api/groceries/<id>`.)

- [ ] **Step 5: Commit**

```bash
git add app/api/groceries
git commit -m "feat(groceries): REST routes (GET/POST list+create, PATCH/DELETE item with in-use guard)"
```

---

### Task 6: Groceries screen (`/groceries`) + nav link

**Files:**
- Create: `app/groceries/page.tsx` (server, force-dynamic)
- Create: `app/groceries/groceries-list.tsx` (client)
- Modify: `app/page.tsx:79-82` (add a "Groceries" nav link next to "Chat →")
- Modify: `app/globals.css` (append a `.groceries` style block)

**Interfaces:**
- Consumes: `listGroceries`, `GroceryView` (Task 3); REST routes (Task 5).

- [ ] **Step 1: Create the server page**

Create `app/groceries/page.tsx`:

```tsx
import Link from "next/link";
import { listGroceries } from "@/lib/groceries";
import { GroceriesList } from "./groceries-list";

// Reads live DB — must render per request (see the force-dynamic gotcha).
export const dynamic = "force-dynamic";

export default async function GroceriesPage() {
  const groceries = await listGroceries();
  return (
    <main className="app groceries">
      <div className="head-row">
        <div>
          <h1 className="head-title">Groceries</h1>
          <div className="head-date">YOUR SOURCE OF TRUTH</div>
        </div>
        <Link href="/" className="chat-link">‹ Today</Link>
      </div>
      <div className="rule" />
      <GroceriesList initial={groceries} />
    </main>
  );
}
```

- [ ] **Step 2: Create the client list/form component**

Create `app/groceries/groceries-list.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { GroceryView } from "@/lib/groceries";

type WeightUnit = "g" | "oz" | "lb";
const OZ = 28.3495;
const LB = 453.592;
const toG = (v: number, u: WeightUnit) => (u === "oz" ? v * OZ : u === "lb" ? v * LB : v);

type FormState = {
  id: number | null;
  name: string;
  brand: string;
  store: string;
  link: string;
  category: string;
  serving: string;
  servingUnit: WeightUnit;
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  purchase: string;
  purchaseUnit: WeightUnit;
  price: string;
};

const EMPTY: FormState = {
  id: null, name: "", brand: "", store: "", link: "", category: "",
  serving: "", servingUnit: "g", kcal: "", proteinG: "", carbsG: "", fatG: "",
  purchase: "", purchaseUnit: "lb", price: "",
};

function toForm(g: GroceryView): FormState {
  return {
    id: g.id,
    name: g.name,
    brand: g.brand ?? "",
    store: g.store ?? "",
    link: g.link ?? "",
    category: g.category ?? "",
    serving: g.servingGrams != null ? String(g.servingGrams) : "",
    servingUnit: "g",
    kcal: String(g.kcal),
    proteinG: String(g.proteinG),
    carbsG: String(g.carbsG),
    fatG: String(g.fatG),
    purchase: g.purchaseWeightG != null ? String(g.purchaseWeightG) : "",
    purchaseUnit: "g",
    price: g.price != null ? String(g.price) : "",
  };
}

export function GroceriesList({ initial }: { initial: GroceryView[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const set = (k: keyof FormState, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || saving) return;
    const serving = Number(form.serving);
    const kcal = Number(form.kcal);
    if (!form.name.trim() || !Number.isFinite(serving) || serving <= 0 || !Number.isFinite(kcal)) {
      setError("Name, a positive serving size, and calories are required.");
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      brand: form.brand || null,
      store: form.store || null,
      link: form.link || null,
      category: form.category || null,
      servingGrams: toG(serving, form.servingUnit),
      kcal,
      proteinG: Number(form.proteinG) || 0,
      carbsG: Number(form.carbsG) || 0,
      fatG: Number(form.fatG) || 0,
      purchaseWeightG: form.purchase ? toG(Number(form.purchase), form.purchaseUnit) : null,
      price: form.price ? Number(form.price) : null,
    };
    try {
      const res = await fetch(form.id ? `/api/groceries/${form.id}` : "/api/groceries", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed");
      setForm(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    const res = await fetch(`/api/groceries/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Delete failed");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div>
      {error && <div className="gr-error">{error}</div>}

      {form ? (
        <form className="gr-form" onSubmit={save}>
          <input placeholder="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <div className="gr-2">
            <input placeholder="Brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            <input placeholder="Store" value={form.store} onChange={(e) => set("store", e.target.value)} />
          </div>
          <div className="gr-2">
            <input placeholder="Category (oil, protein…)" value={form.category} onChange={(e) => set("category", e.target.value)} />
            <input placeholder="Link" value={form.link} onChange={(e) => set("link", e.target.value)} />
          </div>
          <div className="gr-row">
            <input inputMode="decimal" placeholder="Serving size" value={form.serving} onChange={(e) => set("serving", e.target.value)} />
            <select value={form.servingUnit} onChange={(e) => set("servingUnit", e.target.value)}>
              <option value="g">g</option>
              <option value="oz">oz</option>
            </select>
            <span className="gr-hint">per serving →</span>
          </div>
          <div className="gr-4">
            <input inputMode="decimal" placeholder="kcal" value={form.kcal} onChange={(e) => set("kcal", e.target.value)} />
            <input inputMode="decimal" placeholder="P" value={form.proteinG} onChange={(e) => set("proteinG", e.target.value)} />
            <input inputMode="decimal" placeholder="C" value={form.carbsG} onChange={(e) => set("carbsG", e.target.value)} />
            <input inputMode="decimal" placeholder="F" value={form.fatG} onChange={(e) => set("fatG", e.target.value)} />
          </div>
          <div className="gr-row">
            <input inputMode="decimal" placeholder="Package weight" value={form.purchase} onChange={(e) => set("purchase", e.target.value)} />
            <select value={form.purchaseUnit} onChange={(e) => set("purchaseUnit", e.target.value)}>
              <option value="lb">lb</option>
              <option value="oz">oz</option>
              <option value="g">g</option>
            </select>
            <input inputMode="decimal" placeholder="$ price" value={form.price} onChange={(e) => set("price", e.target.value)} />
          </div>
          <div className="gr-actions">
            <button type="submit" className="btn-dark" disabled={saving}>{form.id ? "Save" : "Add"}</button>
            <button type="button" className="gr-cancel" onClick={() => { setForm(null); setError(null); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-dark gr-add" onClick={() => setForm({ ...EMPTY })}>+ Add grocery</button>
      )}

      <ul className="gr-list">
        {initial.map((g) => {
          const costPerServing =
            g.price != null && g.purchaseWeightG != null && g.servingGrams
              ? (g.price / (g.purchaseWeightG / g.servingGrams)).toFixed(2)
              : null;
          return (
            <li key={g.id} className="gr-item">
              <div className="gr-main">
                <b>{g.name}</b>
                <small>
                  {[g.brand, g.store].filter(Boolean).join(" · ")}
                  {g.servingGrams != null ? ` · ${g.servingGrams}g serving` : " · no weight set"}
                </small>
                <small>
                  {g.kcal} kcal · {g.proteinG}P · {g.carbsG}C · {g.fatG}F
                  {costPerServing ? ` · ~$${costPerServing}/serving` : ""}
                </small>
              </div>
              <div className="gr-item-actions">
                <button type="button" onClick={() => setForm(toForm(g))}>Edit</button>
                <button type="button" onClick={() => remove(g.id)}>Delete</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Add the nav link on the Today header**

In `app/page.tsx`, in the header actions `<div style={{ display: "flex", gap: 8 }}>` (lines ~79-82), add a Groceries link next to the existing Chat link:

```tsx
          <div style={{ display: "flex", gap: 8 }}>
            <SignOut />
            <Link href="/groceries" className="chat-link">Groceries</Link>
            <Link href="/chat" className="chat-link">Chat →</Link>
          </div>
```

- [ ] **Step 4: Append the `.groceries` styles to `globals.css`**

Append to `app/globals.css`:

```css
/* ---- Groceries screen ---- */
.gr-add { margin: 4px 0 18px; }
.gr-error {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--protein);
  background: #f6e9e7;
  padding: 8px 10px;
  border-radius: 6px;
  margin-bottom: 12px;
}
.gr-form { display: flex; flex-direction: column; gap: 8px; margin-bottom: 22px; }
.gr-form input, .gr-form select {
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--ink);
  width: 100%;
}
.gr-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.gr-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.gr-row { display: flex; align-items: center; gap: 8px; }
.gr-row input { flex: 1; }
.gr-row select { width: auto; }
.gr-hint { font-family: var(--font-mono); font-size: 11px; color: var(--faint); white-space: nowrap; }
.gr-actions { display: flex; gap: 10px; align-items: center; }
.gr-cancel {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--muted);
  background: none;
  border: none;
  cursor: pointer;
}
.gr-list { list-style: none; padding: 0; margin: 0; }
.gr-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.gr-main { display: flex; flex-direction: column; gap: 3px; }
.gr-main b { font-family: var(--font-serif); font-size: 15px; color: var(--ink); }
.gr-main small { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }
.gr-item-actions { display: flex; gap: 8px; flex-shrink: 0; }
.gr-item-actions button {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 4px 8px;
  cursor: pointer;
}
```

- [ ] **Step 5: Verify it renders + types**

Run: `npx tsc --noEmit` (clean), then with dev server up:
```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:3100/groceries
```
Expected: `200` (when logged in) or `307` redirect to `/login` (proxy gate — then verify by logging in via the browser). Add a grocery through the form, confirm it appears; edit it; delete a non-referenced one; try deleting a seeded meal-plan food and confirm the "in use" message shows instead of a crash.

- [ ] **Step 6: Verify the production build keeps `/groceries` dynamic**

Run: `npm run build`
Expected: build succeeds and the route table shows `ƒ /groceries` (NOT `○`). If it shows `○`, the `force-dynamic` export is missing.

- [ ] **Step 7: Commit**

```bash
git add app/groceries app/page.tsx app/globals.css
git commit -m "feat(groceries): /groceries management screen + Today nav link + styles"
```

---

### Task 7: Verify the end-to-end chat flow (manual)

**Files:** none (verification only).

- [ ] **Step 1: Source-of-truth happy path**

With dev server up and logged in, open `/chat` and send: *"I ate 8 oz of [an existing grocery's name]."*
Expected: Kal calls `search_foods`, then `log_food` with `oz: 8`, returns a card titled "… · 8 oz", and the totals reflect `perServing × (226.796 / serving_grams)`.

- [ ] **Step 2: Off-list capture path**

Send: *"I ate a granola bar I haven't added yet."*
Expected: Kal does **not** invent macros — it asks for the brand + label facts (serving grams + macros). Provide them; Kal calls `add_grocery`, then `log_food` by weight. Confirm the new item now appears on `/groceries`.

- [ ] **Step 3: Supplementary food**

Send: *"I cooked 6 oz chicken in 1 tbsp of [your olive oil grocery]."*
Expected: Kal logs both the chicken (by weight) and the oil, and the day's fat goes up accordingly.

- [ ] **Step 4: Note any issues** — if the model picks wrong tools, tighten the wording in `lib/system-prompt.ts` Rules and re-test. No commit unless a prompt tweak is made.

---

### Task 8: Update STATE.md (AFTER the owner confirms the feature works)

**Files:**
- Modify: `STATE.md`

> Per the maintenance protocol in `AGENTS.md`, only do this once the owner has confirmed the feature is good. Do not commit STATE changes for unaccepted work.

- [ ] **Step 1: Update STATE.md**
  - Bump *Last updated* to the acceptance date.
  - Remove "grocery-logging section" / `is_estimated` from the backlog (items 4).
  - Add a "Groceries" section summarizing: extended `foods` columns, weight logging, `add_grocery`, source-of-truth prompt rule, `/groceries` screen; note inventory-decrement + barcode scan still deferred.
  - Add `lib/units.ts`, `lib/groceries.ts`, `app/groceries/*`, `app/api/groceries/*` to the File map.

- [ ] **Step 2: Commit**

```bash
git add STATE.md
git commit -m "docs: record groceries feature in STATE"
```

- [ ] **Step 3: Finish the branch** — use the `superpowers:finishing-a-development-branch` skill to merge `groceries` (or open a PR), per the owner's preference.

---

## Self-Review

**Spec coverage:**
- Data model (7 columns) → Task 1. ✅
- Weight→macros conversion → Task 2 (`lib/units.ts`) + Task 4 (`log_food`). ✅
- `add_grocery` tool + source-of-truth prompt rules → Task 4. ✅
- `/groceries` screen (force-dynamic, add/edit/delete, cost/serving, category grouping, delete guard, nav link) → Task 6. Note: items are listed flat ordered by name; per-category grouping is left as a simple visual concern (the `category` field is shown inline) — acceptable for v1. ✅
- REST CRUD → Task 5. ✅
- Testing (units, add_grocery, weight log, CRUD) → Tasks 2/3/4. ✅
- Non-goals (no inventory decrement, no barcode) → respected; noted in Task 8 backlog. ✅
- Supplementary foods → no schema work needed; covered by `category` + verified in Task 7 Step 3. ✅

**Placeholder scan:** No TBD/TODO; every code step has full code. ✅

**Type consistency:** `GroceryInput`/`GroceryView` field names match across lib (Task 3), tools (Task 4), routes (Task 5), and UI (Task 6). `toGrams`/`weightToServings` signatures match between Task 2 and Task 4. `servingGrams` is the numeric-as-string DB column; `GroceryView.servingGrams` is `number|null`. ✅

**Known sharp edge (flagged in Task 5 Step 3):** the PATCH route's keyed loop assigns `Number(...)` to non-nullable numeric `GroceryInput` keys — if TS rejects the union, split the loop into nullable (`purchaseWeightG`, `price`) vs non-nullable groups. Resolve at implementation time.
