# Plan Screen Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the working `/plan` screen core — profile editor (plain form), meal-plan template editing with just-today/every-day save scopes and automatic target re-derivation, and the memory-facts manager — per `docs/superpowers/specs/2026-07-11-plan-screen-design.md` (Phase 1 only; the 3D figure and trend chart are Phase 2).

**Architecture:** Mirror the Groceries screen exactly: thin `app/api/*` route handlers → business logic in `lib/*.ts` → a `force-dynamic` server page passing plain data to `"use client"` components that `fetch` + `startTransition(() => router.refresh())`. The just-today save scope reuses the existing `setMealOverride` engine (`lib/overrides.ts`); every-day mutates `meals`/`meal_items` and re-derives `profile.target*` from the live plan (targets always derive from the plan).

**Tech Stack:** Next.js 16 App Router (params is a Promise; no middleware — `proxy.ts` handles auth globally, so routes need NO auth checks), Drizzle + neon-http (no interactive transactions; numerics are strings), Vitest integration tests against live Neon, Tailwind-free hand CSS in `app/globals.css`.

## Global Constraints

- Next 16: route `ctx.params` is a `Promise` — always `await ctx.params`.
- Any page reading live DB MUST `export const dynamic = "force-dynamic"`; after build, `/plan` must show `ƒ` in the route table.
- neon-http: no interactive transactions — sequential statements are the house pattern (single-user app).
- Drizzle numeric columns read as strings (`Number()` at the boundary) and write as strings (`String()`).
- Integration tests hit live Neon: each test FILE uses its OWN sentinel (dates like `2099-06-06` or content prefixes), cleans up in `afterEach` AND `afterAll`, and never mutates real rows without snapshot/restore.
- Repo is PUBLIC: no env values, credentials, or owner personal data in code, tests, or commits.
- Dev server: `PORT=3100 npm run dev` (3000 is taken). Verify: `npm test`, `npx tsc --noEmit` (must stay clean).
- After editing `globals.css`, Turbopack serves STALE CSS — `rm -rf .next`, restart dev, hard-refresh.
- `profile.goal_date` column stays in the schema but Phase 1 never reads or writes it (owner dropped deadlines). Do NOT touch `lib/system-prompt.ts`.
- No interpunct (·) separators in any new UI copy — spaces/stacking instead.
- Error typing (owner decision 2026-07-11, supersedes the message-regex mapping originally
  written here): lib validation failures throw `ValidationError`, missing-entity failures
  throw `NotFoundError` (both tiny classes in `lib/errors.ts`); routes map
  `instanceof ValidationError` → 400 and `instanceof NotFoundError` → 404. Never classify
  errors by message text. (Retrofit of Tasks 1–3 code done as a fix commit after Task 3.)
- Commit after every green task; never commit with a red suite.

---

### Task 1: `lib/profile.ts` — profile read/update

**Files:**
- Create: `lib/profile.ts`
- Test: `lib/profile.test.ts`

**Interfaces:**
- Consumes: `db` from `../db`, `profile` table from `../db/schema`.
- Produces: `getProfile(): Promise<ProfileView>`, `updateProfile(patch: ProfilePatch): Promise<ProfileView>`, types `ProfileView`, `ProfilePatch` (Task 2's route and Task 7's page import these).

- [ ] **Step 1: Write the failing test**

```ts
// lib/profile.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/profile.test.ts`
Expected: FAIL — `Cannot find module './profile'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/profile.ts
import { eq } from "drizzle-orm";
import { db } from "../db";
import { profile } from "../db/schema";

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
      throw new Error("heightCm must be a positive integer");
    set.heightCm = patch.heightCm;
  }
  if (patch.weightLb !== undefined) {
    if (!Number.isFinite(patch.weightLb) || patch.weightLb <= 0)
      throw new Error("weightLb must be positive");
    set.weightLb = String(patch.weightLb);
  }
  if (patch.age !== undefined) {
    if (!Number.isInteger(patch.age) || patch.age <= 0)
      throw new Error("age must be a positive integer");
    set.age = patch.age;
  }
  if (patch.sex !== undefined) {
    if (!patch.sex.trim()) throw new Error("sex must be non-empty");
    set.sex = patch.sex.trim();
  }
  if (patch.bodyFatPct !== undefined) {
    if (
      patch.bodyFatPct !== null &&
      (!Number.isFinite(patch.bodyFatPct) || patch.bodyFatPct <= 0 || patch.bodyFatPct >= 100)
    )
      throw new Error("bodyFatPct must be between 0 and 100");
    set.bodyFatPct = patch.bodyFatPct === null ? null : String(patch.bodyFatPct);
  }
  if (patch.goalWeightLb !== undefined) {
    if (patch.goalWeightLb !== null && (!Number.isFinite(patch.goalWeightLb) || patch.goalWeightLb <= 0))
      throw new Error("goalWeightLb must be positive");
    set.goalWeightLb = patch.goalWeightLb === null ? null : String(patch.goalWeightLb);
  }
  if (patch.activityLevel !== undefined) {
    set.activityLevel = patch.activityLevel === null ? null : patch.activityLevel.trim() || null;
  }
  if (Object.keys(set).length === 0) throw new Error("empty patch");
  await db.update(profile).set(set).where(eq(profile.id, 1));
  return getProfile();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/profile.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` → clean, then:

```bash
git add lib/profile.ts lib/profile.test.ts
git commit -m "feat(plan): lib/profile — read/update the profile singleton (refs #5)"
```

---

### Task 2: `PATCH /api/profile` route

**Files:**
- Create: `app/api/profile/route.ts`

**Interfaces:**
- Consumes: `updateProfile`, `ProfilePatch` from `@/lib/profile` (Task 1).
- Produces: `PATCH /api/profile` accepting JSON `{ weightLb?, goalWeightLb?, heightCm?, age?, sex?, bodyFatPct?, activityLevel? }` → 200 `ProfileView` | 400 `{ error }`. Task 7's `ProfileForm` calls this.

- [ ] **Step 1: Write the route** (routes are thin; the suite tests `lib/` — routes are verified by curl, matching the Groceries precedent)

```ts
// app/api/profile/route.ts
import type { NextRequest } from "next/server";
import { updateProfile, type ProfilePatch } from "@/lib/profile";

// PATCH /api/profile — partial update of the singleton profile row.
// goal_date is not accepted: the owner dropped deadlines; targets only move
// via plan re-derivation (/api/meals/[id]/items with scope "template").
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const patch: ProfilePatch = {};

  // Non-nullable numerics: skip null/undefined.
  for (const k of ["heightCm", "weightLb", "age"] as const) {
    if (body[k] !== undefined && body[k] !== null) patch[k] = Number(body[k]);
  }
  if (body.sex !== undefined && body.sex !== null) patch.sex = String(body.sex);
  // Nullable: null (or "") clears.
  for (const k of ["bodyFatPct", "goalWeightLb"] as const) {
    if (body[k] !== undefined) patch[k] = body[k] === null || body[k] === "" ? null : Number(body[k]);
  }
  if (body.activityLevel !== undefined) {
    patch.activityLevel = body.activityLevel ? String(body.activityLevel) : null;
  }

  try {
    return Response.json(await updateProfile(patch));
  } catch (err) {
    if (err instanceof Error && /must|empty|required/.test(err.message)) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Verify with curl against the dev server**

Run (dev server on 3100 must be up; log in first in a browser to get the cookie, or use the login route):

```bash
curl -s -X POST http://localhost:3100/api/auth/login -H 'content-type: application/json' \
  -d "{\"password\":\"$(grep APP_PASSWORD .env.local | cut -d= -f2)\"}" -c /tmp/kal-cookie -o /dev/null
curl -s -X PATCH http://localhost:3100/api/profile -b /tmp/kal-cookie \
  -H 'content-type: application/json' -d '{"weightLb": 0}'
```
Expected: `{"error":"weightLb must be positive"}` (400). Then send a valid no-op-ish patch and restore:

```bash
curl -s -b /tmp/kal-cookie http://localhost:3100/api/profile -X PATCH \
  -H 'content-type: application/json' -d '{"activityLevel":"active"}'
```
Expected: 200 JSON containing `"activityLevel":"active"` and the target fields. Unauthenticated (`curl` without `-b`) must return 401 (proxy gate).

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add app/api/profile/route.ts
git commit -m "feat(plan): PATCH /api/profile (refs #5)"
```

---

### Task 3: `lib/plan.ts` — plan view + target re-derivation

**Files:**
- Create: `lib/plan.ts`
- Test: `lib/plan.test.ts`

**Interfaces:**
- Consumes: `resolveItem` from `./resolve-item`; `db`; `foods`, `mealItems`, `meals`, `profile` from schema.
- Produces (Tasks 4–8 rely on these exact names):
  - `getPlanView(): Promise<PlanView>` where `PlanView = { meals: PlanMealView[]; totals: PlanTargets }`, `PlanMealView = { id, name, timeHint, sortOrder, items: PlanItemView[], kcal }`, `PlanItemView = { id, foodId, foodName, brand, imageUrl, category, quantity, servingDesc, servingGrams, unitKcal, amountLabel, kcal }`, `PlanTargets = { kcal, proteinG, carbsG, fatG }` (all numbers).
  - `recomputeTargets(): Promise<RetargetResult>` with `RetargetResult = { old: PlanTargets; next: PlanTargets }`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/plan.test.ts
import "../db/env";
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { asc, eq, like } from "drizzle-orm";
import { db } from "../db";
import { foods, mealItems, meals, profile } from "../db/schema";
import { getPlanView, recomputeTargets, replaceMealItems, createMeal, updateMeal, deleteMeal } from "./plan";

// Sentinel meal name for this FILE (parallel-safe); targets snapshot/restore
// because recomputeTargets writes the live profile row.
const TEST_MEAL = "zz test plan 2099-06-06";
let targetSnapshot: { targetKcal: number; targetProteinG: number; targetCarbsG: number; targetFatG: number };

beforeAll(async () => {
  const [row] = await db.select().from(profile).where(eq(profile.id, 1));
  targetSnapshot = {
    targetKcal: row.targetKcal,
    targetProteinG: row.targetProteinG,
    targetCarbsG: row.targetCarbsG,
    targetFatG: row.targetFatG,
  };
});

async function cleanup() {
  await db.delete(meals).where(like(meals.name, `${TEST_MEAL}%`)); // meal_items cascade
  await db.update(profile).set(targetSnapshot).where(eq(profile.id, 1));
}
afterEach(cleanup);
afterAll(cleanup);

async function firstFood() {
  const [f] = await db.select().from(foods).orderBy(asc(foods.id)).limit(1);
  return f;
}

describe("getPlanView", () => {
  it("returns sorted meals with resolved items and rounded totals", async () => {
    const view = await getPlanView();
    expect(view.meals.length).toBeGreaterThan(0);
    const sorts = view.meals.map((m) => m.sortOrder);
    expect(sorts).toEqual([...sorts].sort((a, b) => a - b));
    const anyItem = view.meals.flatMap((m) => m.items)[0];
    expect(anyItem.amountLabel).toBeTruthy();
    expect(typeof anyItem.kcal).toBe("number");
    expect(view.totals.kcal).toBeGreaterThan(0);
  });
});

describe("recomputeTargets", () => {
  it("derives targets from the live plan and reports old vs next", async () => {
    const f = await firstFood();
    const { id } = await createMeal({ name: TEST_MEAL });
    const base = await recomputeTargets(); // plan without test items
    await db.insert(mealItems).values({ mealId: id, foodId: f.id, quantity: "2" });
    const res = await recomputeTargets();
    expect(res.old.kcal).toBe(base.next.kcal);
    expect(res.next.kcal).toBe(base.next.kcal + 2 * f.kcal); // integer qty → exact
    const [row] = await db.select().from(profile).where(eq(profile.id, 1));
    expect(row.targetKcal).toBe(res.next.kcal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/plan.test.ts`
Expected: FAIL — `Cannot find module './plan'`

- [ ] **Step 3: Write the implementation** (includes the Task 4 mutation signatures so the file compiles once; Task 4 adds their tests)

```ts
// lib/plan.ts
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { foods, mealItems, meals, profile } from "../db/schema";
import { resolveItem } from "./resolve-item";

export type PlanItemView = {
  id: number;
  foodId: number;
  foodName: string;
  brand: string | null;
  imageUrl: string | null;
  category: string | null;
  quantity: number;
  servingDesc: string;
  servingGrams: number | null;
  unitKcal: number;
  amountLabel: string;
  kcal: number;
};
export type PlanMealView = {
  id: number;
  name: string;
  timeHint: string | null;
  sortOrder: number;
  items: PlanItemView[];
  kcal: number;
};
export type PlanTargets = { kcal: number; proteinG: number; carbsG: number; fatG: number };
export type PlanView = { meals: PlanMealView[]; totals: PlanTargets };
export type RetargetResult = { old: PlanTargets; next: PlanTargets };
export type PlanItemInput = { foodId: number; quantity: number };

export async function getPlanView(): Promise<PlanView> {
  const [mealRows, itemRows] = await Promise.all([
    db.select().from(meals).orderBy(asc(meals.sortOrder)),
    db
      .select({
        id: mealItems.id,
        mealId: mealItems.mealId,
        foodId: mealItems.foodId,
        quantity: mealItems.quantity,
        foodName: foods.name,
        brand: foods.brand,
        imageUrl: foods.imageUrl,
        category: foods.category,
        servingDesc: foods.servingDesc,
        servingGrams: foods.servingGrams,
        kcal: foods.kcal,
        proteinG: foods.proteinG,
        carbsG: foods.carbsG,
        fatG: foods.fatG,
        rawToCookedYield: foods.rawToCookedYield,
      })
      .from(mealItems)
      .innerJoin(foods, eq(mealItems.foodId, foods.id))
      .orderBy(asc(mealItems.id)),
  ]);

  const byMeal = new Map<number, PlanItemView[]>();
  for (const r of itemRows) {
    const q = Number(r.quantity);
    const resolved = resolveItem(q, {
      name: r.foodName,
      servingDesc: r.servingDesc,
      kcal: r.kcal,
      proteinG: Number(r.proteinG),
      carbsG: Number(r.carbsG),
      fatG: Number(r.fatG),
      rawToCookedYield: r.rawToCookedYield === null ? null : Number(r.rawToCookedYield),
    });
    const list = byMeal.get(r.mealId) ?? [];
    list.push({
      id: r.id,
      foodId: r.foodId,
      foodName: r.foodName,
      brand: r.brand,
      imageUrl: r.imageUrl,
      category: r.category,
      quantity: q,
      servingDesc: r.servingDesc,
      servingGrams: r.servingGrams === null ? null : Number(r.servingGrams),
      unitKcal: r.kcal,
      amountLabel: resolved.amountLabel,
      kcal: resolved.kcal,
    });
    byMeal.set(r.mealId, list);
  }

  // Totals use the seed's rule: sum raw food macros × qty, round ONCE at the end
  // (matches computeTargets in db/seed-data.ts, so plan totals == derived targets).
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const r of itemRows) {
    const q = Number(r.quantity);
    t.kcal += r.kcal * q;
    t.p += Number(r.proteinG) * q;
    t.c += Number(r.carbsG) * q;
    t.f += Number(r.fatG) * q;
  }

  return {
    meals: mealRows.map((m) => {
      const items = byMeal.get(m.id) ?? [];
      return {
        id: m.id,
        name: m.name,
        timeHint: m.timeHint,
        sortOrder: m.sortOrder,
        items,
        kcal: items.reduce((s, i) => s + i.kcal, 0),
      };
    }),
    totals: {
      kcal: Math.round(t.kcal),
      proteinG: Math.round(t.p),
      carbsG: Math.round(t.c),
      fatG: Math.round(t.f),
    },
  };
}

/** Re-derive profile targets from the live plan (owner rule: never hand-picked). */
export async function recomputeTargets(): Promise<RetargetResult> {
  const rows = await db
    .select({
      quantity: mealItems.quantity,
      kcal: foods.kcal,
      proteinG: foods.proteinG,
      carbsG: foods.carbsG,
      fatG: foods.fatG,
    })
    .from(mealItems)
    .innerJoin(foods, eq(mealItems.foodId, foods.id));
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const r of rows) {
    const q = Number(r.quantity);
    t.kcal += r.kcal * q;
    t.p += Number(r.proteinG) * q;
    t.c += Number(r.carbsG) * q;
    t.f += Number(r.fatG) * q;
  }
  const [prev] = await db.select().from(profile).where(eq(profile.id, 1));
  const next: PlanTargets = {
    kcal: Math.round(t.kcal),
    proteinG: Math.round(t.p),
    carbsG: Math.round(t.c),
    fatG: Math.round(t.f),
  };
  await db
    .update(profile)
    .set({
      targetKcal: next.kcal,
      targetProteinG: next.proteinG,
      targetCarbsG: next.carbsG,
      targetFatG: next.fatG,
    })
    .where(eq(profile.id, 1));
  return {
    old: {
      kcal: prev.targetKcal,
      proteinG: prev.targetProteinG,
      carbsG: prev.targetCarbsG,
      fatG: prev.targetFatG,
    },
    next,
  };
}

async function assertItemsValid(items: PlanItemInput[]) {
  for (const it of items) {
    if (!(it.quantity > 0)) throw new Error("quantity must be positive");
  }
  if (items.length === 0) return;
  const rows = await db
    .select({ id: foods.id })
    .from(foods)
    .where(inArray(foods.id, items.map((i) => i.foodId)));
  const have = new Set(rows.map((r) => r.id));
  for (const it of items) {
    if (!have.has(it.foodId)) throw new Error(`No food with id ${it.foodId}`);
  }
}

/** Replace a meal's TEMPLATE items (every day) and re-derive targets.
 *  Empty items = the meal stays but contributes nothing. */
export async function replaceMealItems(mealId: number, items: PlanItemInput[]): Promise<RetargetResult> {
  const [meal] = await db.select({ id: meals.id }).from(meals).where(eq(meals.id, mealId));
  if (!meal) throw new Error(`No meal with id ${mealId}`);
  await assertItemsValid(items);
  await db.delete(mealItems).where(eq(mealItems.mealId, mealId));
  if (items.length > 0) {
    await db.insert(mealItems).values(
      items.map((it) => ({ mealId, foodId: it.foodId, quantity: String(it.quantity) })),
    );
  }
  return recomputeTargets();
}

export async function createMeal(input: { name: string; timeHint?: string | null }): Promise<{ id: number }> {
  const name = input.name?.trim();
  if (!name) throw new Error("name required");
  const rows = await db.select({ sortOrder: meals.sortOrder }).from(meals);
  const nextSort = rows.length === 0 ? 1 : Math.max(...rows.map((r) => r.sortOrder)) + 1;
  const [row] = await db
    .insert(meals)
    .values({ name, sortOrder: nextSort, timeHint: input.timeHint?.trim() || null })
    .returning({ id: meals.id });
  return row;
}

export async function updateMeal(
  id: number,
  patch: { name?: string; timeHint?: string | null },
): Promise<{ id: number } | null> {
  const set: Partial<typeof meals.$inferInsert> = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error("name required");
    set.name = patch.name.trim();
  }
  if (patch.timeHint !== undefined) set.timeHint = patch.timeHint?.trim() || null;
  if (Object.keys(set).length === 0) throw new Error("empty patch");
  const rows = await db.update(meals).set(set).where(eq(meals.id, id)).returning({ id: meals.id });
  return rows[0] ?? null;
}

/** Delete a meal (items cascade; day rows cascade; logs keep with meal_id null). */
export async function deleteMeal(id: number): Promise<RetargetResult> {
  const rows = await db.delete(meals).where(eq(meals.id, id)).returning({ id: meals.id });
  if (rows.length === 0) throw new Error(`No meal with id ${id}`);
  return recomputeTargets();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/plan.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/plan.ts lib/plan.test.ts
git commit -m "feat(plan): lib/plan — plan view + target re-derivation from the live plan (refs #5)"
```

---

### Task 4: `lib/plan.ts` mutation tests (template scope + meal CRUD)

**Files:**
- Modify: `lib/plan.test.ts` (append describes)

**Interfaces:**
- Consumes: `replaceMealItems`, `createMeal`, `updateMeal`, `deleteMeal` from Task 3 (already implemented there).
- Produces: proven behavior Task 5's routes rely on.

- [ ] **Step 1: Append the failing-if-broken tests**

```ts
// append to lib/plan.test.ts
describe("replaceMealItems (template scope)", () => {
  it("replaces items and re-derives targets", async () => {
    const f = await firstFood();
    const { id } = await createMeal({ name: TEST_MEAL, timeHint: "test hint" });
    const base = await recomputeTargets();
    const res = await replaceMealItems(id, [{ foodId: f.id, quantity: 3 }]);
    expect(res.next.kcal).toBe(base.next.kcal + 3 * f.kcal);
    const view = await getPlanView();
    const m = view.meals.find((x) => x.id === id)!;
    expect(m.items).toHaveLength(1);
    expect(m.items[0].foodId).toBe(f.id);
    expect(m.timeHint).toBe("test hint");
    // replace again — last write wins
    const res2 = await replaceMealItems(id, []);
    expect(res2.next.kcal).toBe(base.next.kcal);
  });

  it("rejects unknown meals, unknown foods, and bad quantities", async () => {
    const f = await firstFood();
    await expect(replaceMealItems(999999, [{ foodId: f.id, quantity: 1 }])).rejects.toThrow(/No meal/);
    const { id } = await createMeal({ name: TEST_MEAL });
    await expect(replaceMealItems(id, [{ foodId: 999999, quantity: 1 }])).rejects.toThrow(/No food/);
    await expect(replaceMealItems(id, [{ foodId: f.id, quantity: 0 }])).rejects.toThrow(/positive/);
  });
});

describe("meal CRUD", () => {
  it("createMeal appends with the next sortOrder; updateMeal renames", async () => {
    const { id } = await createMeal({ name: TEST_MEAL });
    const view = await getPlanView();
    const created = view.meals.find((m) => m.id === id)!;
    expect(created.sortOrder).toBe(Math.max(...view.meals.map((m) => m.sortOrder)));
    await updateMeal(id, { name: `${TEST_MEAL} renamed`, timeHint: null });
    const after = (await getPlanView()).meals.find((m) => m.id === id)!;
    expect(after.name).toBe(`${TEST_MEAL} renamed`);
    expect(after.timeHint).toBeNull();
    expect(await updateMeal(999999, { name: "x" })).toBeNull();
  });

  it("deleteMeal cascades items and re-derives targets", async () => {
    const f = await firstFood();
    const { id } = await createMeal({ name: TEST_MEAL });
    const base = await recomputeTargets();
    await replaceMealItems(id, [{ foodId: f.id, quantity: 2 }]);
    const res = await deleteMeal(id);
    expect(res.next.kcal).toBe(base.next.kcal);
    const view = await getPlanView();
    expect(view.meals.find((m) => m.id === id)).toBeUndefined();
    await expect(deleteMeal(id)).rejects.toThrow(/No meal/);
  });
});
```

- [ ] **Step 2: Run the file**

Run: `npx vitest run lib/plan.test.ts`
Expected: PASS (6 tests). If a failure leaves a `zz test plan` meal behind, the `like`-based cleanup removes it on the next run.

- [ ] **Step 3: Run the WHOLE suite** (mutations touch shared tables — prove nothing else broke)

Run: `npm test`
Expected: all green (89 existing + new).

- [ ] **Step 4: Commit**

```bash
git add lib/plan.test.ts
git commit -m "test(plan): template replace + meal CRUD coverage (refs #5)"
```

---

### Task 5: meal routes — CRUD + scoped item save

**Files:**
- Create: `app/api/meals/route.ts` (POST)
- Create: `app/api/meals/[id]/route.ts` (PATCH, DELETE)
- Create: `app/api/meals/[id]/items/route.ts` (PUT)

Note: `app/api/meals/[id]/status/route.ts` already exists — these are siblings; do not touch it.

**Interfaces:**
- Consumes: Task 3's `lib/plan.ts` exports; `setMealOverride` from `@/lib/overrides` (exists: `setMealOverride(date: string, mealId: number, items: {foodId, quantity}[])` → `{ writeBatchId, lines, total }`); `todayInAppTz()` from `@/lib/time`.
- Produces (Task 8's editor calls these):
  - `POST /api/meals` `{ name, timeHint? }` → 201 `{ id }`
  - `PATCH /api/meals/:id` `{ name?, timeHint? }` → 200 `{ id }` | 404
  - `DELETE /api/meals/:id` → 200 `{ targets: RetargetResult }`
  - `PUT /api/meals/:id/items` `{ scope: "today" | "template", items: {foodId, quantity}[] }` →
    today: 200 `{ scope: "today", writeBatchId, lines, total }` (requires ≥1 item);
    template: 200 `{ scope: "template", targets: RetargetResult }` (empty items allowed).

- [ ] **Step 1: Write the three route files**

```ts
// app/api/meals/route.ts
import type { NextRequest } from "next/server";
import { createMeal } from "@/lib/plan";

// POST /api/meals — add a meal to the template (appended last).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  const created = await createMeal({ name, timeHint: body.timeHint ?? null });
  return Response.json(created, { status: 201 });
}
```

```ts
// app/api/meals/[id]/route.ts
import type { NextRequest } from "next/server";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { deleteMeal, updateMeal } from "@/lib/plan";

// PATCH /api/meals/:id — rename / re-hint a template meal.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mealId = Number(id);
  if (!Number.isInteger(mealId)) return Response.json({ error: "invalid id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const patch: { name?: string; timeHint?: string | null } = {};
  if (body.name !== undefined && body.name !== null) patch.name = String(body.name);
  if (body.timeHint !== undefined) patch.timeHint = body.timeHint ? String(body.timeHint) : null;
  try {
    const updated = await updateMeal(mealId, patch);
    if (!updated) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

// DELETE /api/meals/:id — remove from the template; targets re-derive.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mealId = Number(id);
  if (!Number.isInteger(mealId)) return Response.json({ error: "invalid id" }, { status: 400 });
  try {
    const targets = await deleteMeal(mealId);
    return Response.json({ targets });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }
}
```

```ts
// app/api/meals/[id]/items/route.ts
import type { NextRequest } from "next/server";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { setMealOverride } from "@/lib/overrides";
import { replaceMealItems, type PlanItemInput } from "@/lib/plan";
import { todayInAppTz } from "@/lib/time";

// PUT /api/meals/:id/items — save a meal's items with a scope:
//   "today"    → day-scoped meal_overrides row set (the chat ⇄ engine); template untouched.
//   "template" → rewrite meal_items for every day; profile targets re-derive.
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mealId = Number(id);
  if (!Number.isInteger(mealId)) return Response.json({ error: "invalid id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const scope = body.scope;
  if (scope !== "today" && scope !== "template") {
    return Response.json({ error: 'scope must be "today" or "template"' }, { status: 400 });
  }
  if (!Array.isArray(body.items)) {
    return Response.json({ error: "items must be an array" }, { status: 400 });
  }
  const items: PlanItemInput[] = body.items.map((it: { foodId: unknown; quantity: unknown }) => ({
    foodId: Number(it.foodId),
    quantity: Number(it.quantity),
  }));

  try {
    if (scope === "today") {
      if (items.length === 0) {
        return Response.json(
          { error: "a just-today save needs at least one item (skip a meal via its status instead)" },
          { status: 400 },
        );
      }
      const res = await setMealOverride(todayInAppTz(), mealId, items);
      return Response.json({ scope: "today", ...res });
    }
    const targets = await replaceMealItems(mealId, items);
    return Response.json({ scope: "template", targets });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Verify with curl** (same cookie jar as Task 2; use throwaway data)

```bash
MEAL=$(curl -s -b /tmp/kal-cookie -X POST http://localhost:3100/api/meals \
  -H 'content-type: application/json' -d '{"name":"curl test meal"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
FOOD=$(curl -s -b /tmp/kal-cookie http://localhost:3100/api/groceries | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
# template save → targets re-derive (old != next)
curl -s -b /tmp/kal-cookie -X PUT http://localhost:3100/api/meals/$MEAL/items \
  -H 'content-type: application/json' -d "{\"scope\":\"template\",\"items\":[{\"foodId\":$FOOD,\"quantity\":2}]}"
# today save → writeBatchId + lines
curl -s -b /tmp/kal-cookie -X PUT http://localhost:3100/api/meals/$MEAL/items \
  -H 'content-type: application/json' -d "{\"scope\":\"today\",\"items\":[{\"foodId\":$FOOD,\"quantity\":1}]}"
# cleanup: delete restores targets (response old != next again)
curl -s -b /tmp/kal-cookie -X DELETE http://localhost:3100/api/meals/$MEAL
```
Expected: 201 → template response with `targets.old`/`targets.next` differing by 2× the food's kcal → today response with `writeBatchId` and a resolved line → delete 200 and targets back to the original. (The today-override row cascades away with the meal delete.)

- [ ] **Step 3: Typecheck, full suite, commit**

```bash
npx tsc --noEmit && npm test
git add app/api/meals/route.ts app/api/meals/[id]/route.ts app/api/meals/[id]/items/route.ts
git commit -m "feat(plan): meal CRUD + scoped item-save routes (today = ⇄ override engine) (refs #5)"
```

---

### Task 6: memory facts — lib + routes

**Files:**
- Create: `lib/memory.ts`
- Test: `lib/memory.test.ts`
- Create: `app/api/memory-facts/route.ts` (GET, POST)
- Create: `app/api/memory-facts/[id]/route.ts` (PATCH, DELETE)

**Interfaces:**
- Consumes: `memoryFacts` table (id, content, createdAt, updatedAt). Chat's `add_memory_fact` keeps writing the same table — do not touch `lib/tools.ts`.
- Produces: `listMemoryFacts(): Promise<MemoryFactView[]>` (`{ id, content, createdAt }`, oldest first — same order the system prompt uses), `addMemoryFact(content)`, `updateMemoryFact(id, content)`, `deleteMemoryFact(id): Promise<boolean>`; routes `GET/POST /api/memory-facts`, `PATCH/DELETE /api/memory-facts/:id`. Task 7/9 import these.

- [ ] **Step 1: Write the failing test**

```ts
// lib/memory.test.ts
import "../db/env";
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "../db";
import { memoryFacts } from "../db/schema";
import { addMemoryFact, deleteMemoryFact, listMemoryFacts, updateMemoryFact } from "./memory";

// Sentinel content prefix for this FILE (parallel-safe cleanup by prefix).
const P = "zz-test-memory-2099:";

async function cleanup() {
  await db.delete(memoryFacts).where(like(memoryFacts.content, `${P}%`));
}
afterEach(cleanup);
afterAll(cleanup);

describe("memory facts", () => {
  it("add → list (oldest first) → update → delete round-trip", async () => {
    const a = await addMemoryFact(`${P} first`);
    const b = await addMemoryFact(`${P} second`);
    const mine = (await listMemoryFacts()).filter((f) => f.content.startsWith(P));
    expect(mine.map((f) => f.id)).toEqual([a.id, b.id]);

    const upd = await updateMemoryFact(a.id, `${P} first edited`);
    expect(upd?.content).toBe(`${P} first edited`);
    expect(await updateMemoryFact(999999, `${P} nope`)).toBeNull();

    expect(await deleteMemoryFact(a.id)).toBe(true);
    expect(await deleteMemoryFact(a.id)).toBe(false);
    const left = (await listMemoryFacts()).filter((f) => f.content.startsWith(P));
    expect(left.map((f) => f.id)).toEqual([b.id]);
  });

  it("rejects empty content", async () => {
    await expect(addMemoryFact("   ")).rejects.toThrow(/required/);
    const a = await addMemoryFact(`${P} keep`);
    await expect(updateMemoryFact(a.id, "")).rejects.toThrow(/required/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/memory.test.ts`
Expected: FAIL — `Cannot find module './memory'`

- [ ] **Step 3: Write lib + routes**

```ts
// lib/memory.ts
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { memoryFacts } from "../db/schema";
import { ValidationError } from "./errors";

export type MemoryFactView = { id: number; content: string; createdAt: string };

const toView = (r: typeof memoryFacts.$inferSelect): MemoryFactView => ({
  id: r.id,
  content: r.content,
  createdAt: r.createdAt.toISOString(),
});

/** Oldest first — the same order the system prompt injects them. */
export async function listMemoryFacts(): Promise<MemoryFactView[]> {
  const rows = await db.select().from(memoryFacts).orderBy(asc(memoryFacts.createdAt), asc(memoryFacts.id));
  return rows.map(toView);
}

export async function addMemoryFact(content: string): Promise<MemoryFactView> {
  const trimmed = content?.trim();
  if (!trimmed) throw new ValidationError("content required");
  const [row] = await db.insert(memoryFacts).values({ content: trimmed }).returning();
  return toView(row);
}

export async function updateMemoryFact(id: number, content: string): Promise<MemoryFactView | null> {
  const trimmed = content?.trim();
  if (!trimmed) throw new ValidationError("content required");
  const rows = await db
    .update(memoryFacts)
    .set({ content: trimmed, updatedAt: new Date() })
    .where(eq(memoryFacts.id, id))
    .returning();
  return rows[0] ? toView(rows[0]) : null;
}

export async function deleteMemoryFact(id: number): Promise<boolean> {
  const rows = await db.delete(memoryFacts).where(eq(memoryFacts.id, id)).returning({ id: memoryFacts.id });
  return rows.length > 0;
}
```

```ts
// app/api/memory-facts/route.ts
import type { NextRequest } from "next/server";
import { addMemoryFact, listMemoryFacts } from "@/lib/memory";

export async function GET() {
  return Response.json(await listMemoryFacts());
}

// POST /api/memory-facts — the user tells Kal something directly.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) return Response.json({ error: "content is required" }, { status: 400 });
  return Response.json(await addMemoryFact(content), { status: 201 });
}
```

```ts
// app/api/memory-facts/[id]/route.ts
import type { NextRequest } from "next/server";
import { deleteMemoryFact, updateMemoryFact } from "@/lib/memory";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const factId = Number(id);
  if (!Number.isInteger(factId)) return Response.json({ error: "invalid id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) return Response.json({ error: "content is required" }, { status: 400 });
  const updated = await updateMemoryFact(factId, content);
  if (!updated) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(updated);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const factId = Number(id);
  if (!Number.isInteger(factId)) return Response.json({ error: "invalid id" }, { status: 400 });
  const gone = await deleteMemoryFact(factId);
  if (!gone) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/memory.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Typecheck, full suite, commit**

```bash
npx tsc --noEmit && npm test
git add lib/memory.ts lib/memory.test.ts app/api/memory-facts
git commit -m "feat(plan): memory-facts lib + REST (refs #5)"
```

---

### Task 7: `/plan` page shell + ProfileForm + navigation + CSS

**Files:**
- Create: `app/plan/page.tsx`
- Create: `app/plan/profile-form.tsx`
- Modify: `app/page.tsx` (add the Plan nav pill next to Groceries/Chat, line ~81)
- Modify: `app/globals.css` (append the `.plan-*` styles below)

**Interfaces:**
- Consumes: `getProfile` (Task 1), `getPlanView` (Task 3), `listMemoryFacts` (Task 6), `listGroceries` from `@/lib/groceries` (exists — `GroceryView` has `id`, `name`, `servingDesc`, `kcal`, `servingGrams`, `imageUrl`, `category`), `getOverridesForDate` from `@/lib/overrides`, `todayInAppTz` from `@/lib/time`.
- Produces: the `/plan` route; `<ProfileForm profile={ProfileView} />`. Placeholder slots for Tasks 8–9 components (`MealPlanEditor`, `MemoryList`) — page compiles without them first by rendering nothing in those slots, then Tasks 8/9 swap them in.

- [ ] **Step 1: Write the server page**

```tsx
// app/plan/page.tsx
import Link from "next/link";
import { getProfile } from "@/lib/profile";
import { getPlanView } from "@/lib/plan";
import { listMemoryFacts } from "@/lib/memory";
import { listGroceries } from "@/lib/groceries";
import { getOverridesForDate } from "@/lib/overrides";
import { todayInAppTz } from "@/lib/time";
import { ProfileForm } from "./profile-form";

// Reads live DB — must render per request (see the force-dynamic gotcha).
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const today = todayInAppTz();
  const [profile, plan, facts, groceries, overrides] = await Promise.all([
    getProfile(),
    getPlanView(),
    listMemoryFacts(),
    listGroceries(),
    getOverridesForDate(today),
  ]);
  const adjustedMealIds = Array.from(overrides.keys());

  return (
    <main className="app plan">
      <div className="head-row">
        <div>
          <h1 className="head-title">Plan</h1>
          <div className="head-date">PROFILE MEALS MEMORY</div>
        </div>
        <Link href="/" className="chat-link">‹ Today</Link>
      </div>
      <div className="rule" />

      <section>
        <div className="plan-sec-head">
          <span className="plan-kicker">Profile</span>
        </div>
        <ProfileForm profile={profile} />
      </section>

      <section>
        <div className="plan-sec-head">
          <span className="plan-kicker">Meal plan</span>
          <span className="plan-kicker">{plan.meals.length} meals</span>
        </div>
        {/* Task 8 mounts <MealPlanEditor plan={plan} groceries={groceries} adjustedMealIds={adjustedMealIds} /> here */}
      </section>

      <section>
        <div className="plan-sec-head">
          <span className="plan-kicker">Memory</span>
          <span className="plan-kicker">{facts.length} facts</span>
        </div>
        {/* Task 9 mounts <MemoryList facts={facts} /> here */}
      </section>
    </main>
  );
}
```

(The unused `groceries`/`adjustedMealIds` bindings are consumed in Task 8 — if lint complains in the interim, prefix with `void groceries; void adjustedMealIds;` and remove that line in Task 8.)

- [ ] **Step 2: Write the ProfileForm client component**

```tsx
// app/plan/profile-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ProfileView } from "@/lib/profile";

// Plain form (Phase 1). Phase 2 replaces the top of this section with the 3D
// figure; this form remains the underlying editor the figure's regions open.
export function ProfileForm({ profile }: { profile: ProfileView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    weightLb: String(profile.weightLb),
    goalWeightLb: profile.goalWeightLb === null ? "" : String(profile.goalWeightLb),
    heightCm: String(profile.heightCm),
    age: String(profile.age),
    sex: profile.sex,
    bodyFatPct: profile.bodyFatPct === null ? "" : String(profile.bodyFatPct),
    activityLevel: profile.activityLevel ?? "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setSaved(false);
  };

  async function save() {
    setError(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        weightLb: Number(form.weightLb),
        goalWeightLb: form.goalWeightLb === "" ? null : Number(form.goalWeightLb),
        heightCm: Number(form.heightCm),
        age: Number(form.age),
        sex: form.sex,
        bodyFatPct: form.bodyFatPct === "" ? null : Number(form.bodyFatPct),
        activityLevel: form.activityLevel || null,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "save failed");
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <div className="plan-card">
      {error && <div className="gr-error">{error}</div>}
      <div className="plan-grid">
        <label>
          <span className="plan-lbl">Weight (lb)</span>
          <input className="plan-inp" inputMode="decimal" value={form.weightLb} onChange={set("weightLb")} />
        </label>
        <label>
          <span className="plan-lbl">Goal weight (lb)</span>
          <input className="plan-inp" inputMode="decimal" value={form.goalWeightLb} onChange={set("goalWeightLb")} />
        </label>
        <label>
          <span className="plan-lbl">Height (cm)</span>
          <input className="plan-inp" inputMode="numeric" value={form.heightCm} onChange={set("heightCm")} />
        </label>
        <label>
          <span className="plan-lbl">Age</span>
          <input className="plan-inp" inputMode="numeric" value={form.age} onChange={set("age")} />
        </label>
        <label>
          <span className="plan-lbl">Sex</span>
          <input className="plan-inp" value={form.sex} onChange={set("sex")} />
        </label>
        <label>
          <span className="plan-lbl">Body fat (%)</span>
          <input className="plan-inp" inputMode="decimal" value={form.bodyFatPct} onChange={set("bodyFatPct")} />
        </label>
        <label>
          <span className="plan-lbl">Activity</span>
          <input className="plan-inp" value={form.activityLevel} onChange={set("activityLevel")} />
        </label>
      </div>

      <div className="plan-targets">
        <span className="plan-lbl">Daily targets derived from the meal plan</span>
        <span className="plan-targets-v">
          {profile.targetKcal} kcal&ensp;
          <b className="mac-p">P {profile.targetProteinG}</b>&ensp;
          <b className="mac-c">C {profile.targetCarbsG}</b>&ensp;
          <b className="mac-f">F {profile.targetFatG}</b>
        </span>
      </div>

      <button className="btn-dark plan-save" onClick={save} disabled={pending}>
        {saved ? "Saved ✓" : pending ? "Saving…" : "Save profile"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Add nav + CSS**

In `app/page.tsx`, change the header link cluster (currently `SignOut` / `Groceries` / `Chat →`) to include Plan:

```tsx
          <div style={{ display: "flex", gap: 8 }}>
            <SignOut />
            <Link href="/plan" className="chat-link">Plan</Link>
            <Link href="/groceries" className="chat-link">Groceries</Link>
            <Link href="/chat" className="chat-link">Chat →</Link>
          </div>
```

Append to `app/globals.css` (one `/* ===== Plan screen ===== */` block; reuses existing tokens; `mac-p/c/f` classes are new — check they don't already exist, and if they do reuse them):

```css
/* ===== Plan screen (app/plan) ===== */
.plan section { margin-top: 22px; }
.plan-sec-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.plan-kicker {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--faint);
}
.plan-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  padding: 13px 14px;
}
.plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.plan-lbl {
  display: block; font-family: var(--font-mono); font-size: 8.5px; letter-spacing: 0.07em;
  text-transform: uppercase; color: var(--faint); margin-bottom: 3px;
}
.plan-inp {
  font-family: var(--font-mono); font-size: 16px; font-variant-numeric: tabular-nums;
  color: var(--ink); background: #fff; border: 1px solid var(--border); border-radius: 7px;
  padding: 7px 9px; width: 100%;
}
.plan-inp:focus { outline: 2px solid rgba(217, 119, 87, 0.4); outline-offset: 1px; border-color: var(--accent); }
.plan-targets {
  background: var(--surface-2); border-radius: 10px; padding: 9px 12px; margin-top: 12px;
}
.plan-targets-v { font-family: var(--font-mono); font-size: 12.5px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.plan-targets-v b { font-weight: 500; }
.mac-p { color: var(--protein); }
.mac-c { color: var(--carbs); }
.mac-f { color: var(--fat); }
.plan-save { margin-top: 12px; }
```

(`.plan-inp` is 16px on purpose — iOS Safari auto-zooms focused inputs below 16px.)

- [ ] **Step 4: Verify in the running app**

```bash
rm -rf .next && PORT=3100 npm run dev   # background; CSS changed → stale-CSS gotcha
curl -s -b /tmp/kal-cookie http://localhost:3100/plan | grep -o "<h1[^<]*</h1>"
```
Expected: `<h1 class="head-title">Plan</h1>`. In a browser: `/plan` shows the profile form; editing weight + Save shows "Saved ✓" and survives a reload; Today's header shows the Plan pill.

- [ ] **Step 5: Build-mode check, typecheck, commit**

```bash
npm run build 2>&1 | grep "/plan"
```
Expected: the route table row for `/plan` is `ƒ` (dynamic), NOT `○`.

```bash
npx tsc --noEmit
git add app/plan/page.tsx app/plan/profile-form.tsx app/page.tsx app/globals.css
git commit -m "feat(plan): /plan page shell + profile editor + nav (refs #5)"
```

---

### Task 8: MealPlanEditor client component

**Files:**
- Create: `app/plan/meal-plan-editor.tsx`
- Modify: `app/plan/page.tsx` (mount it in the Meal plan section)
- Modify: `app/globals.css` (append the styles below)

**Interfaces:**
- Consumes: `PlanView`, `PlanMealView`, `PlanTargets`, `RetargetResult` types from `@/lib/plan`; `GroceryView` from `@/lib/groceries`; routes from Task 5.
- Produces: `<MealPlanEditor plan={PlanView} groceries={GroceryView[]} adjustedMealIds={number[]} />`.

Behavior spec (encode exactly):
- Read view: meals as sections — serif name, mono time-hint, kcal subtotal, Edit button; a ⇄ marker (`adjusted today`) on meals whose id is in `adjustedMealIds`; item rows with a 40px thumb (img or first letter on `--surface-2`), name + `amountLabel`, kcal right-aligned. A totals strip on top: `PLAN {totals.kcal} KCAL P … C … F …`.
- Edit mode (one meal at a time, state `editingId`): each item gets a quantity `<input inputMode="decimal">` + −/+ steppers (step 1 when `servingGrams === null`, else 0.1) + remove ×; a `<select>` of groceries to add (label `{name} ({servingDesc})`); a link-button "not in groceries? ask kal in chat →" that routes to `/chat`; scope segmented control Just today / Every day (default Just today); Save (label "Save for today" / "Save meal") + Cancel.
- Save: `PUT /api/meals/{id}/items` with `{ scope, items: [{foodId, quantity}] }`. On `scope==="template"` response, show the recalc banner `targets: {old.kcal} → {next.kcal} kcal` until the next edit. On success `startTransition(() => router.refresh())` and exit edit mode. Just-today with zero items → surface the API's 400 message inline.
- Add meal: dashed button → prompt-less inline mini-form (name + optional hint + Add) → `POST /api/meals`. Delete meal: small "remove" button inside edit mode with `confirm()`-free two-tap pattern (first tap arms it: label flips to "really remove?"; second tap calls `DELETE /api/meals/{id}`).

- [ ] **Step 1: Write the component**

```tsx
// app/plan/meal-plan-editor.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { GroceryView } from "@/lib/groceries";
import type { PlanView, RetargetResult } from "@/lib/plan";

type EditItem = { foodId: number; quantity: number; foodName: string; servingDesc: string; servingGrams: number | null; unitKcal: number };

export function MealPlanEditor({
  plan,
  groceries,
  adjustedMealIds,
}: {
  plan: PlanView;
  groceries: GroceryView[];
  adjustedMealIds: number[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [items, setItems] = useState<EditItem[]>([]);
  const [scope, setScope] = useState<"today" | "template">("today");
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<RetargetResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);
  const [addingMeal, setAddingMeal] = useState(false);
  const [newMeal, setNewMeal] = useState({ name: "", timeHint: "" });
  const adjusted = new Set(adjustedMealIds);

  function beginEdit(mealId: number) {
    const meal = plan.meals.find((m) => m.id === mealId)!;
    setItems(
      meal.items.map((i) => ({
        foodId: i.foodId,
        quantity: i.quantity,
        foodName: i.foodName,
        servingDesc: i.servingDesc,
        servingGrams: i.servingGrams,
        unitKcal: i.unitKcal,
      })),
    );
    setScope("today");
    setError(null);
    setBanner(null);
    setArmedDelete(false);
    setEditingId(mealId);
  }

  const step = (it: EditItem) => (it.servingGrams === null ? 1 : 0.1);
  const round3 = (x: number) => Math.round(x * 1000) / 1000;

  function bump(idx: number, dir: 1 | -1) {
    setItems(items.map((it, i) => (i === idx ? { ...it, quantity: Math.max(0, round3(it.quantity + dir * step(it))) } : it)));
  }
  function setQty(idx: number, raw: string) {
    const q = Number(raw);
    setItems(items.map((it, i) => (i === idx ? { ...it, quantity: Number.isFinite(q) ? q : it.quantity } : it)));
  }
  function addFood(foodId: number) {
    const f = groceries.find((g) => g.id === foodId);
    if (!f || items.some((it) => it.foodId === foodId)) return;
    setItems([...items, { foodId: f.id, quantity: 1, foodName: f.name, servingDesc: f.servingDesc, servingGrams: f.servingGrams, unitKcal: f.kcal }]);
  }

  async function save() {
    if (editingId === null) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/meals/${editingId}/items`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, items: items.filter((i) => i.quantity > 0).map((i) => ({ foodId: i.foodId, quantity: i.quantity })) }),
    });
    setSaving(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "save failed");
      return;
    }
    if (body.scope === "template") setBanner(body.targets);
    setEditingId(null);
    startTransition(() => router.refresh());
  }

  async function removeMeal() {
    if (editingId === null) return;
    if (!armedDelete) {
      setArmedDelete(true);
      return;
    }
    const res = await fetch(`/api/meals/${editingId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "delete failed");
      return;
    }
    setBanner(body.targets);
    setEditingId(null);
    startTransition(() => router.refresh());
  }

  async function addMeal() {
    if (!newMeal.name.trim()) return;
    const res = await fetch("/api/meals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newMeal.name, timeHint: newMeal.timeHint || null }),
    });
    if (res.ok) {
      setAddingMeal(false);
      setNewMeal({ name: "", timeHint: "" });
      startTransition(() => router.refresh());
    }
  }

  return (
    <div>
      <div className="plan-totals">
        <span>PLAN <b>{plan.totals.kcal}</b> KCAL</span>
        <span>
          <b className="mac-p">P {plan.totals.proteinG}</b>&ensp;
          <b className="mac-c">C {plan.totals.carbsG}</b>&ensp;
          <b className="mac-f">F {plan.totals.fatG}</b>
        </span>
      </div>

      {banner && (
        <div className="plan-recalc">
          <div className="plan-recalc-k">Targets recalculated</div>
          <div className="plan-recalc-v">{banner.old.kcal} → <b>{banner.next.kcal}</b> kcal</div>
          <div className="plan-recalc-why">targets always derive from the plan</div>
        </div>
      )}

      {plan.meals.map((meal) => {
        const editing = editingId === meal.id;
        return (
          <div className="plan-meal" key={meal.id}>
            <div className="plan-meal-head">
              <span>
                <span className="plan-meal-nm">{meal.name}</span>
                {meal.timeHint && <span className="plan-meal-hint">{meal.timeHint}</span>}
                {adjusted.has(meal.id) && <span className="plan-adjusted" aria-label="adjusted today">⇄</span>}
              </span>
              <span className="plan-meal-end">
                <span className="plan-meal-kc">{meal.kcal} kcal</span>
                {!editing && (
                  <button className="plan-edit-btn" onClick={() => beginEdit(meal.id)}>Edit</button>
                )}
              </span>
            </div>

            {!editing &&
              meal.items.map((i) => (
                <div className="plan-food" key={i.id}>
                  <span className="plan-thumb">
                    {i.imageUrl ? <img src={i.imageUrl} alt="" /> : i.foodName[0]}
                  </span>
                  <span className="plan-food-mid">
                    <span className="plan-food-nm">{i.foodName}</span>
                    <span className="plan-food-meta">{i.unitKcal} kcal per {i.servingDesc}</span>
                  </span>
                  <span className="plan-food-amt">
                    {i.amountLabel}
                    <span className="plan-food-kc">{i.kcal} kcal</span>
                  </span>
                </div>
              ))}

            {editing && (
              <div className="plan-edit">
                {error && <div className="gr-error">{error}</div>}
                {items.map((it, idx) => (
                  <div className="plan-edit-row" key={it.foodId}>
                    <span className="plan-food-mid">
                      <span className="plan-food-nm">{it.foodName}</span>
                      <span className="plan-food-meta">{it.unitKcal} kcal per {it.servingDesc}</span>
                    </span>
                    <span className="plan-stepper">
                      <button onClick={() => bump(idx, -1)}>−</button>
                      <input inputMode="decimal" value={String(it.quantity)} onChange={(e) => setQty(idx, e.target.value)} />
                      <button onClick={() => bump(idx, 1)}>+</button>
                    </span>
                    <button className="plan-x" onClick={() => setItems(items.filter((_, i) => i !== idx))}>×</button>
                  </div>
                ))}

                <select
                  className="plan-add-select"
                  value=""
                  onChange={(e) => addFood(Number(e.target.value))}
                >
                  <option value="" disabled>+ add item from groceries</option>
                  {groceries
                    .filter((g) => !items.some((it) => it.foodId === g.id))
                    .map((g) => (
                      <option key={g.id} value={g.id}>{g.name} ({g.servingDesc})</option>
                    ))}
                </select>
                <button className="plan-ask-chat" onClick={() => router.push("/chat")}>
                  not in groceries? ask kal in chat →
                </button>

                <div className="plan-scope">
                  <span className="plan-lbl" style={{ marginBottom: 0 }}>Apply</span>
                  <div className="plan-scope-seg">
                    <button className={scope === "today" ? "on" : ""} onClick={() => setScope("today")}>Just today</button>
                    <button className={scope === "template" ? "on" : ""} onClick={() => setScope("template")}>Every day</button>
                  </div>
                </div>
                <div className="plan-scope-hint">
                  {scope === "today"
                    ? "just today = a ⇄ override — template untouched, back to normal tomorrow"
                    : "every day changes the template — targets re-derive from the new plan"}
                </div>

                <div className="plan-actions">
                  <button className="btn-dark" onClick={save} disabled={saving}>
                    {saving ? "Saving…" : scope === "today" ? "Save for today" : "Save meal"}
                  </button>
                  <button className="plan-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
                <button className="plan-remove" onClick={removeMeal}>
                  {armedDelete ? "really remove this meal from every day?" : "remove meal"}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {!addingMeal && (
        <button className="plan-add-meal" onClick={() => setAddingMeal(true)}>+ add meal</button>
      )}
      {addingMeal && (
        <div className="plan-new-meal">
          <input className="plan-inp" placeholder="Meal name" value={newMeal.name} onChange={(e) => setNewMeal({ ...newMeal, name: e.target.value })} />
          <input className="plan-inp" placeholder="Time hint (optional)" value={newMeal.timeHint} onChange={(e) => setNewMeal({ ...newMeal, timeHint: e.target.value })} />
          <div className="plan-actions">
            <button className="btn-dark" onClick={addMeal}>Add meal</button>
            <button className="plan-cancel" onClick={() => setAddingMeal(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it** — in `app/plan/page.tsx`, replace the Task-8 placeholder comment with:

```tsx
        <MealPlanEditor plan={plan} groceries={groceries} adjustedMealIds={adjustedMealIds} />
```
and add `import { MealPlanEditor } from "./meal-plan-editor";` (remove any `void` shims from Task 7).

- [ ] **Step 3: Append CSS to `app/globals.css`**

```css
/* Plan — meal editor */
.plan-totals {
  display: flex; justify-content: space-between; align-items: center;
  font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-soft);
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 9px;
  padding: 7px 11px; margin-bottom: 6px; font-variant-numeric: tabular-nums;
}
.plan-totals b { font-weight: 500; }
.plan-recalc {
  border-left: 2px solid var(--accent); background: var(--surface);
  border-radius: 0 10px 10px 0; padding: 9px 12px; margin: 10px 0;
}
.plan-recalc-k { font-family: var(--font-mono); font-size: 8.5px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--accent); }
.plan-recalc-v { font-family: var(--font-serif); font-size: 15px; font-variant-numeric: tabular-nums; }
.plan-recalc-v b { font-weight: 600; }
.plan-recalc-why { font-family: var(--font-mono); font-size: 8.5px; color: var(--faint); }
.plan-meal { margin-top: 16px; }
.plan-meal-head {
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 1px solid #dcd8ce; padding-bottom: 6px;
}
.plan-meal-nm { font-family: var(--font-serif); font-size: 19px; font-weight: 500; letter-spacing: -0.01em; }
.plan-meal-hint { font-family: var(--font-mono); font-size: 8.5px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--faint); margin-left: 8px; }
.plan-adjusted { color: var(--accent); margin-left: 7px; font-size: 13px; }
.plan-meal-end { display: flex; align-items: baseline; gap: 10px; }
.plan-meal-kc { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.plan-edit-btn {
  font-family: var(--font-mono); font-size: 8.5px; letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--muted); background: none; border: 1px solid var(--border); border-radius: 6px;
  padding: 2px 8px; cursor: pointer;
}
.plan-food { display: flex; align-items: center; gap: 12px; padding: 9px 0; }
.plan-food + .plan-food { border-top: 1px solid var(--border); }
.plan-thumb {
  width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-2); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
  font-family: var(--font-serif); font-size: 17px; color: var(--muted);
}
.plan-thumb img { width: 100%; height: 100%; object-fit: contain; mix-blend-mode: multiply; }
.plan-food-mid { flex: 1; min-width: 0; }
.plan-food-nm { display: block; font-size: 14.5px; color: var(--ink); line-height: 1.3; }
.plan-food-meta { display: block; font-family: var(--font-mono); font-size: 10px; color: var(--faint); font-variant-numeric: tabular-nums; }
.plan-food-amt { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-soft); text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.plan-food-kc { display: block; color: var(--faint); font-size: 9.5px; margin-top: 1px; }
.plan-edit { padding-top: 4px; }
.plan-edit-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
.plan-edit-row + .plan-edit-row { border-top: 1px solid var(--border); }
.plan-stepper { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
.plan-stepper button {
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--border);
  background: #fff; font-family: var(--font-mono); font-size: 14px; color: var(--ink-soft);
  cursor: pointer; line-height: 1; padding: 0;
}
.plan-stepper input {
  width: 58px; text-align: center; font-family: var(--font-mono); font-size: 16px;
  border: 1px solid var(--border); border-radius: 7px; padding: 4px 2px;
  font-variant-numeric: tabular-nums;
}
.plan-x {
  font-family: var(--font-mono); font-size: 12px; color: var(--faint);
  background: none; border: 1px solid var(--border); border-radius: 7px;
  width: 26px; height: 26px; cursor: pointer; flex-shrink: 0;
}
.plan-add-select {
  width: 100%; font-family: var(--font-mono); font-size: 16px; color: var(--muted);
  background: #fff; border: 1px dashed #cdcbc4; border-radius: 9px; padding: 9px; margin-top: 10px;
}
.plan-ask-chat {
  width: 100%; text-align: center; background: none; border: none;
  font-family: var(--font-mono); font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--faint); padding: 7px 0 0; cursor: pointer;
}
.plan-scope { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.plan-scope-seg { flex: 1; display: flex; gap: 3px; background: #eceae3; border-radius: 9px; padding: 3px; }
.plan-scope-seg button {
  flex: 1; font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase;
  border: none; background: transparent; color: var(--muted); padding: 6px; border-radius: 7px; cursor: pointer;
}
.plan-scope-seg button.on { background: #fdfcfa; color: var(--ink); box-shadow: 0 1px 2px rgba(60, 50, 40, 0.1); }
.plan-scope-hint { font-family: var(--font-mono); font-size: 8.5px; color: var(--faint); margin-top: 7px; line-height: 1.6; }
.plan-actions { display: flex; gap: 8px; margin-top: 12px; }
.plan-actions .btn-dark { flex: 1.6; }
.plan-cancel { flex: 1; font-size: 13px; background: transparent; color: var(--muted); border: 1px solid var(--border); border-radius: 9px; cursor: pointer; }
.plan-remove {
  width: 100%; margin-top: 10px; background: none; border: none; cursor: pointer;
  font-family: var(--font-mono); font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint);
}
.plan-remove:hover { color: var(--protein); }
.plan-add-meal {
  width: 100%; font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--muted); background: none; border: 1px dashed #cdcbc4; border-radius: 9px;
  padding: 9px; cursor: pointer; margin-top: 16px;
}
.plan-new-meal { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
```

- [ ] **Step 4: Verify end-to-end in the browser** (`rm -rf .next`, restart dev — CSS changed)

1. `/plan` shows all meals with items + totals strip.
2. Edit Breakfast → stepper a quantity → Save with **Just today** → Today screen shows the ⇄ marker on Breakfast; `/plan` still shows the template numbers with the meal's ⇄ badge.
3. Edit again → **Every day** → Save → recalc banner shows old → next kcal; profile targets on the profile card change; revert the edit the same way (banner returns to the original number).
4. Add meal "Test" → appears last; edit it, add one grocery item, save every-day; then remove meal (two-tap) → targets restored.

- [ ] **Step 5: Typecheck, suite, commit**

```bash
npx tsc --noEmit && npm test
git add app/plan/meal-plan-editor.tsx app/plan/page.tsx app/globals.css
git commit -m "feat(plan): meal-plan editor — scoped saves, steppers, add/remove meals (refs #5)"
```

---

### Task 9: MemoryList client component

**Files:**
- Create: `app/plan/memory-list.tsx`
- Modify: `app/plan/page.tsx` (mount in the Memory section)
- Modify: `app/globals.css` (append styles)

**Interfaces:**
- Consumes: `MemoryFactView` from `@/lib/memory`; Task 6 routes.
- Produces: `<MemoryList facts={MemoryFactView[]} />`.

Behavior: facts as serif sentences + mono metaline (`added {mon dd}` — provenance source isn't stored; date only), always-visible ×; delete calls `DELETE /api/memory-facts/:id` immediately and shows a 5s undo snackbar; undo re-POSTs the content (new id/timestamp — acceptable, the list is content-first); ghost add row expands to a textarea + Add button → `POST`. After any mutation `startTransition(() => router.refresh())`.

- [ ] **Step 1: Write the component**

```tsx
// app/plan/memory-list.tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { MemoryFactView } from "@/lib/memory";

function metaDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" }).format(new Date(iso));
}

export function MemoryList({ facts }: { facts: MemoryFactView[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [undoContent, setUndoContent] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showUndo(content: string) {
    setUndoContent(content);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoContent(null), 5000);
  }

  async function remove(fact: MemoryFactView) {
    const res = await fetch(`/api/memory-facts/${fact.id}`, { method: "DELETE" });
    if (res.ok) {
      showUndo(fact.content);
      startTransition(() => router.refresh());
    }
  }

  async function undo() {
    if (!undoContent) return;
    await fetch("/api/memory-facts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: undoContent }),
    });
    setUndoContent(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    startTransition(() => router.refresh());
  }

  async function add() {
    if (!draft.trim()) return;
    const res = await fetch("/api/memory-facts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: draft }),
    });
    if (res.ok) {
      setDraft("");
      setAdding(false);
      startTransition(() => router.refresh());
    }
  }

  return (
    <div>
      {!adding && (
        <button className="plan-fact-add" onClick={() => setAdding(true)}>+ tell kal something</button>
      )}
      {adding && (
        <div className="plan-fact-form">
          <textarea
            className="plan-fact-input"
            rows={2}
            placeholder="e.g. I lift Mon/Wed/Fri mornings"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="plan-actions">
            <button className="btn-dark" onClick={add}>Add fact</button>
            <button className="plan-cancel" onClick={() => { setAdding(false); setDraft(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {facts.map((f) => (
        <div className="plan-fact" key={f.id}>
          <div className="plan-fact-body">
            <div className="plan-fact-tx">{f.content}</div>
            <div className="plan-fact-meta">added {metaDate(f.createdAt)}</div>
          </div>
          <button className="plan-fact-x" onClick={() => remove(f)} aria-label={`delete fact: ${f.content}`}>×</button>
        </div>
      ))}
      {facts.length === 0 && <div className="plan-fact-empty">kal has no memories yet</div>}

      {undoContent && (
        <div className="plan-snack">
          <span>memory fact deleted</span>
          <button onClick={undo}>UNDO</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it** — in `app/plan/page.tsx`, replace the Task-9 placeholder comment with `<MemoryList facts={facts} />` and add `import { MemoryList } from "./memory-list";`.

- [ ] **Step 3: Append CSS**

```css
/* Plan — memory */
.plan-fact { display: flex; align-items: flex-start; gap: 10px; padding: 11px 0; }
.plan-fact + .plan-fact { border-top: 1px solid var(--border); }
.plan-fact-body { flex: 1; }
.plan-fact-tx { font-family: var(--font-serif); font-size: 15px; color: var(--ink); line-height: 1.45; }
.plan-fact-meta { font-family: var(--font-mono); font-size: 8px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); margin-top: 3px; }
.plan-fact-x { font-family: var(--font-mono); font-size: 13px; color: var(--faint); background: none; border: none; cursor: pointer; padding: 2px 6px; }
.plan-fact-x:hover { color: var(--protein); }
.plan-fact-add, .plan-fact-form { margin-bottom: 4px; }
.plan-fact-add {
  width: 100%; text-align: left; font-family: var(--font-mono); font-size: 9.5px;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
  background: none; border: 1px dashed #cdcbc4; border-radius: 9px; padding: 10px 12px; cursor: pointer;
}
.plan-fact-input {
  width: 100%; font-family: var(--font-serif); font-size: 15px; color: var(--ink);
  border: 1px solid var(--border); border-radius: 9px; padding: 9px 11px; resize: none; background: #fff;
}
.plan-fact-empty { font-family: var(--font-mono); font-size: 10px; color: var(--faint); padding: 10px 0; }
.plan-snack {
  position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
  background: var(--ink); color: #f2f0eb; border-radius: 10px;
  font-family: var(--font-mono); font-size: 10.5px; padding: 10px 14px;
  display: flex; align-items: center; gap: 14px; z-index: 50;
}
.plan-snack button { background: none; border: none; color: var(--accent); font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; cursor: pointer; }
```

- [ ] **Step 4: Verify in the browser** (stale-CSS ritual again)

Add a fact → appears with today's date and shows up in a NEW chat session's knowledge (ask Kal "what do you remember about me?"). Delete it → snackbar; UNDO → fact returns. Delete for real → gone from chat too.

- [ ] **Step 5: Typecheck, suite, commit**

```bash
npx tsc --noEmit && npm test
git add app/plan/memory-list.tsx app/plan/page.tsx app/globals.css
git commit -m "feat(plan): memory-facts manager with delete+undo (refs #5)"
```

---

### Task 10: Final verification + state docs

**Files:**
- Modify: `STATE.md` (Now section: Phase 1 built, pending owner review)

- [ ] **Step 1: Full verification pass**

```bash
npm test                      # all green
npx tsc --noEmit              # clean
npm run build 2>&1 | tail -20 # `/plan` row must be ƒ; no build errors
```

- [ ] **Step 2: Manual E2E on :3100** — run the four flows from Task 8 Step 4 plus: profile weight edit persists after reload AND appears in a fresh chat's `PROFILE:` line; just-today save shows ⇄ on Today and is gone tomorrow (or verify by checking `meal_overrides` has today's date only); unauthenticated `curl http://localhost:3100/api/profile -X PATCH` → 401.

- [ ] **Step 3: Update STATE.md Now section**

Replace the Plan-screen bullet with: Phase 1 (profile form, meal editor with scoped saves + target re-derivation, memory manager) built and locally verified, awaiting owner review; Phase 2 (3D figure + trend chart) next; photos staged for Phase 3.

- [ ] **Step 4: Commit**

```bash
git add STATE.md
git commit -m "docs: STATE — Plan screen Phase 1 built, pending owner review (refs #5)"
```

Do NOT close #5, update HISTORY.md, or push/deploy — that happens only after the owner accepts (and Phases 2–3 remain).
