# Groceries "My Serving" Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **NB (this repo):** background subagents cannot run Bash here — execute inline via superpowers:executing-plans; use subagents only for read-only review.

**Goal:** Grocery cards show macros for the owner's own serving ("6 oz (170 g) cooked" chicken → 281 kcal), with tappable cooked↔raw and 2-tbsp↔1-tbsp flips, store logos, and a `Large Eggs` rename.

**Architecture:** One new nullable `foods.display_qty` column (a multiplier of the existing serving basis, same convention as `meal_items.quantity`). A new pure helper `lib/serving-display.ts` turns `(food + displayQty)` into the card's labels/macros via the existing `resolveItem` — macros are never hand-scaled. The card + edit form + REST plumb it through. Spec: `docs/superpowers/specs/2026-07-07-groceries-serving-display-design.md`.

**Tech Stack:** Next.js 16 App Router, Drizzle + Neon (neon-http), Vitest, Tailwind v4 (hand-written classes in `app/globals.css`).

## Global Constraints

- Macros are ALWAYS computed by `resolveItem(quantity, food)` — never hand-scaled (2026-07-02 invariant).
- Weighed foods stay per-100 g basis; `display_qty` is display-only — it must never feed `computeTargets()`, plan lines, chat tools, or the system prompt.
- Groceries screen only: `app/groceries/*`, `lib/groceries.ts`, new `lib/serving-display.ts`. Do not touch Today, popup, chat, or tools.
- Integration tests hit live Neon (need `DATABASE_URL` in `.env.local`); run the dev server as `PORT=3100 npm run dev` (3000 is taken), backgrounded, never a duplicate.
- After editing `globals.css`, Turbopack serves STALE CSS: `rm -rf .next`, restart dev, hard-refresh.
- Before adding any CSS class to `globals.css`, grep it first (the `.mrow` collision lesson).
- `npm run db:seed` is a FULL WIPE — never run it. Live data changes go through the surgical script in Task 7.
- Suite baseline: 48/48 across 11 files; `npx tsc --noEmit` must stay clean at every commit.

---

### Task 1: `display_qty` column (schema + migration, applied to Neon)

**Files:**
- Modify: `db/schema.ts:55-57` (foods table)
- Create (generated): `db/migrations/0004_<generated-name>.sql`

**Interfaces:**
- Produces: `foods.displayQty` Drizzle column (`numeric(8,3)`, nullable) — read as `string | null` on selects, written as `string | null`.

- [ ] **Step 1: Add the column to the foods table**

In `db/schema.ts`, after the `rawToCookedYield` column (line 55), add:

```ts
  // Owner's own serving as a multiplier of serving_desc (1.7 × 100 g = 170 g).
  // DISPLAY-ONLY (Groceries cards): never feeds targets, plan lines, or tools.
  displayQty: numeric("display_qty", { precision: 8, scale: 3 }),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `db/migrations/0004_*.sql`. Inspect it — it must contain exactly:
`ALTER TABLE "foods" ADD COLUMN "display_qty" numeric(8, 3);`

- [ ] **Step 3: Apply to Neon**

Run: `npm run db:migrate`
Expected: exits 0. Verify: `npx tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts db/migrations/
git commit -m "feat(groceries): add foods.display_qty (owner's serving multiplier, display-only)"
```

---

### Task 2: Pure display helper `lib/serving-display.ts` (TDD, no DB)

**Files:**
- Modify: `lib/resolve-item.ts:41-44` (export `ozHint`)
- Create: `lib/serving-display.ts`
- Test: `lib/serving-display.test.ts`

**Interfaces:**
- Consumes: `parseServing`, `resolveItem`, `MacroTotals` from `lib/resolve-item.ts`.
- Produces (used by Task 5's card):

```ts
export type ServingDisplayFood = {
  name: string; servingDesc: string; displayQty: number;
  kcal: number; proteinG: number; carbsG: number; fatG: number;
  rawToCookedYield: number | null;
};
export type ServingLabel = { amount: string; suffix: "cooked" | "uncooked" | null };
export type ServingDisplay = {
  title: string;                                    // name, ", cooked" stripped
  base: ServingLabel;                               // "6 oz (170 g)" + "cooked"
  baseMacros: MacroTotals;                          // at displayQty
  flip: (ServingLabel & { macros: MacroTotals }) | null;
};
export function servingDisplay(food: ServingDisplayFood): ServingDisplay;
```

- [ ] **Step 1: Export `ozHint` from `lib/resolve-item.ts`**

Change line 41 `const ozHint = (grams: number) => {` to `export const ozHint = (grams: number) => {`. (The 0.5-oz kitchen-scale rounding must stay the single source.)

- [ ] **Step 2: Write the failing tests**

Create `lib/serving-display.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { servingDisplay, type ServingDisplayFood } from "./serving-display";

const chicken: ServingDisplayFood = {
  name: "Chicken breast, cooked", servingDesc: "100 g", displayQty: 1.7,
  kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6, rawToCookedYield: 0.75,
};
const rice: ServingDisplayFood = {
  name: "White rice, cooked", servingDesc: "100 g", displayQty: 4,
  kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, rawToCookedYield: 3.0,
};
const veg: ServingDisplayFood = {
  name: "Frozen mixed vegetables, cooked", servingDesc: "100 g", displayQty: 2.5,
  kcal: 55, proteinG: 2.5, carbsG: 11, fatG: 0.4, rawToCookedYield: null,
};
const pb: ServingDisplayFood = {
  name: "Peanut butter", servingDesc: "1 tbsp", displayQty: 2,
  kcal: 95, proteinG: 3.5, carbsG: 3.5, fatG: 8, rawToCookedYield: null,
};
const egg: ServingDisplayFood = {
  name: "Large Eggs", servingDesc: "1 egg", displayQty: 1,
  kcal: 70, proteinG: 6, carbsG: 0.5, fatG: 5, rawToCookedYield: null,
};

describe("servingDisplay", () => {
  it("weighed food with a yield: oz-first cooked label, raw flip, macros identical", () => {
    const d = servingDisplay(chicken);
    expect(d.title).toBe("Chicken breast");
    expect(d.base).toEqual({ amount: "6 oz (170 g)", suffix: "cooked" });
    expect(d.baseMacros).toEqual({ kcal: 281, proteinG: 52.7, carbsG: 0, fatG: 6.1 });
    expect(d.flip).toEqual({
      amount: "8 oz (227 g)", suffix: "uncooked",
      macros: { kcal: 281, proteinG: 52.7, carbsG: 0, fatG: 6.1 },
    });
  });

  it("rice: dry-side flip from the dry→cooked yield", () => {
    const d = servingDisplay(rice);
    expect(d.base.amount).toBe("14 oz (400 g)");
    expect(d.flip!.amount).toBe("4.5 oz (133 g)");
    expect(d.flip!.suffix).toBe("uncooked");
  });

  it("weighed food without a yield: static, no cooked suffix", () => {
    const d = servingDisplay(veg);
    expect(d.base).toEqual({ amount: "9 oz (250 g)", suffix: null });
    expect(d.flip).toBeNull();
  });

  it("count food with qty > 1: 1-unit flip whose macros scale", () => {
    const d = servingDisplay(pb);
    expect(d.base).toEqual({ amount: "2 tbsp", suffix: null });
    expect(d.baseMacros.kcal).toBe(190);
    expect(d.flip).toEqual({
      amount: "1 tbsp", suffix: null,
      macros: { kcal: 95, proteinG: 3.5, carbsG: 3.5, fatG: 8 },
    });
  });

  it("count food at qty 1: static", () => {
    const d = servingDisplay(egg);
    expect(d.title).toBe("Large Eggs");
    expect(d.base).toEqual({ amount: "1 egg", suffix: null });
    expect(d.flip).toBeNull();
  });

  it("fractional weighed qty rounds to the 0.5-oz kitchen hint", () => {
    const d = servingDisplay({ ...veg, name: "Dry-roasted peanuts, salted", displayQty: 0.4, kcal: 643, proteinG: 28.6, carbsG: 14.3, fatG: 53.6 });
    expect(d.base.amount).toBe("1.5 oz (40 g)");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/serving-display.test.ts`
Expected: FAIL — cannot resolve `./serving-display`.

- [ ] **Step 4: Implement `lib/serving-display.ts`**

```ts
// Turns a grocery + the owner's display_qty into what the card shows: an
// oz-first amount, macros AT that amount (always via resolveItem — never
// hand-scaled), and the optional tap-flip (cooked↔raw for yield foods, my
// serving↔1 unit for count foods). Pure; safe to import from client code.

import { ozHint, parseServing, resolveItem, type MacroTotals } from "./resolve-item";

export type ServingDisplayFood = {
  name: string;
  servingDesc: string;
  displayQty: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  rawToCookedYield: number | null;
};

export type ServingLabel = { amount: string; suffix: "cooked" | "uncooked" | null };

export type ServingDisplay = {
  title: string;
  base: ServingLabel;
  baseMacros: MacroTotals;
  flip: (ServingLabel & { macros: MacroTotals }) | null;
};

const trim1 = (x: number) => +x.toFixed(1);
const macrosOf = (qty: number, food: ServingDisplayFood): MacroTotals => {
  const r = resolveItem(qty, food);
  return { kcal: r.kcal, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG };
};

export function servingDisplay(food: ServingDisplayFood): ServingDisplay {
  const { perAmount, unit } = parseServing(food.servingDesc);
  const title = food.name.replace(/,\s*cooked$/i, "");
  const amount = trim1(food.displayQty * perAmount);
  const baseMacros = macrosOf(food.displayQty, food);

  if (unit === "g") {
    const yieldRatio = food.rawToCookedYield;
    if (yieldRatio == null || yieldRatio <= 0) {
      return { title, base: { amount: `${ozHint(amount)} (${amount} g)`, suffix: null }, baseMacros, flip: null };
    }
    const rawGrams = Math.round(amount / yieldRatio);
    return {
      title,
      base: { amount: `${ozHint(amount)} (${amount} g)`, suffix: "cooked" },
      baseMacros,
      flip: { amount: `${ozHint(rawGrams)} (${rawGrams} g)`, suffix: "uncooked", macros: baseMacros },
    };
  }

  const base: ServingLabel = { amount: `${amount} ${unit}`, suffix: null };
  if (food.displayQty <= 1) return { title, base, baseMacros, flip: null };
  return { title, base, baseMacros, flip: { amount: `1 ${unit}`, suffix: null, macros: macrosOf(1, food) } };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/serving-display.test.ts` → 6 passed.
Also: `npx vitest run lib/resolve-item.test.ts` (ozHint export must not break it) and `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add lib/resolve-item.ts lib/serving-display.ts lib/serving-display.test.ts
git commit -m "feat(groceries): servingDisplay() — oz-first my-serving labels + flips (TDD)"
```

---

### Task 3: Plumb `displayQty` through `lib/groceries.ts` and the REST routes (TDD)

**Files:**
- Modify: `lib/groceries.ts` (GroceryInput, GroceryView, toView, createGrocery, updateGrocery)
- Modify: `app/api/groceries/route.ts` (POST), `app/api/groceries/[id]/route.ts` (PATCH)
- Test: `lib/groceries.test.ts`

**Interfaces:**
- Produces: `GroceryView` gains `servingDesc: string`, `rawToCookedYield: number | null`, `displayQty: number` (never null — DB null maps to 1). `GroceryInput` gains `displayQty?: number | null`. REST: POST/PATCH accept `displayQty` (positive number or null; 400 otherwise); GET returns it via the view.

- [ ] **Step 1: Write the failing test**

In `lib/groceries.test.ts`, inside `describe("grocery CRUD")`, add:

```ts
  it("round-trips displayQty and defaults it to 1", async () => {
    const created = await createGrocery({
      name: `${SENTINEL}_dq`, servingGrams: 100, kcal: 100,
      proteinG: 10, carbsG: 10, fatG: 10,
    });
    expect(created.displayQty).toBe(1);          // null in DB reads as 1
    expect(created.servingDesc).toBe("100 g");   // view now exposes the basis
    expect(created.rawToCookedYield).toBeNull();

    const updated = await updateGrocery(created.id, { displayQty: 1.7 });
    expect(updated!.displayQty).toBe(1.7);

    const cleared = await updateGrocery(created.id, { displayQty: null });
    expect(cleared!.displayQty).toBe(1);

    await deleteGrocery(created.id);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/groceries.test.ts`
Expected: FAIL — `displayQty`/`servingDesc` do not exist on the types.

- [ ] **Step 3: Implement in `lib/groceries.ts`**

Add to `GroceryInput` (after `isEstimated?: boolean;`):

```ts
  displayQty?: number | null;
```

Add to `GroceryView` (after `servingGrams: number | null;`):

```ts
  servingDesc: string;
  rawToCookedYield: number | null;
  displayQty: number; // DB null = 1 (display the serving basis as-is)
```

In `toView`, after the `servingGrams` line:

```ts
    servingDesc: r.servingDesc,
    rawToCookedYield: numOrNull(r.rawToCookedYield),
    displayQty: r.displayQty === null ? 1 : Number(r.displayQty),
```

In `createGrocery` values, after `isEstimated`:

```ts
      displayQty: input.displayQty == null ? null : input.displayQty.toFixed(3),
```

In `updateGrocery`, after the `isEstimated` line:

```ts
  if (patch.displayQty !== undefined) {
    set.displayQty = patch.displayQty === null ? null : patch.displayQty.toFixed(3);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/groceries.test.ts` → all pass (previous cases + new one).

- [ ] **Step 5: Accept `displayQty` in both routes**

`app/api/groceries/route.ts` (POST) — after the `kcal` validation block, add:

```ts
  if (body.displayQty != null && (!Number.isFinite(Number(body.displayQty)) || Number(body.displayQty) <= 0)) {
    return Response.json({ error: "displayQty must be a positive number" }, { status: 400 });
  }
```

and in the `input` literal, after `fatG`:

```ts
    displayQty: body.displayQty == null ? null : Number(body.displayQty),
```

`app/api/groceries/[id]/route.ts` (PATCH) — after the nullable-numerics loop (`purchaseWeightG`/`price`), add:

```ts
  // displayQty: null clears (card falls back to 1 × basis); must be > 0 when set.
  if (body.displayQty !== undefined) {
    if (body.displayQty !== null && (!Number.isFinite(Number(body.displayQty)) || Number(body.displayQty) <= 0)) {
      return Response.json({ error: "displayQty must be a positive number" }, { status: 400 });
    }
    patch.displayQty = body.displayQty === null ? null : Number(body.displayQty);
  }
```

- [ ] **Step 6: Verify types + full suite**

Run: `npx tsc --noEmit` → clean. Run: `npm test` → 55 tests green (48 baseline + Task 2's 6 + this task's 1; no other test asserts on GroceryView shape).

- [ ] **Step 7: Commit**

```bash
git add lib/groceries.ts lib/groceries.test.ts app/api/groceries/route.ts "app/api/groceries/[id]/route.ts"
git commit -m "feat(groceries): displayQty through GroceryView/Input + REST (null = 1× basis)"
```

---

### Task 4: Store logo assets + card CSS

**Files:**
- Create: `public/stores/walmart.svg`, `public/stores/costco.svg` (copies of `design/logos/*.svg`)
- Modify: `app/globals.css` (`.gcard-src` rule ~line 1090; new rules after `.gcard-macnums` block ~line 1107)

**Interfaces:**
- Produces: `/stores/walmart.svg`, `/stores/costco.svg` URLs; CSS classes `.gcard-store`, `.gcard-store.costco`, `.gcard-srv`, `.gcard-srv.static`, `.gcard-srv .state` (consumed by Task 5).

- [ ] **Step 1: Guard against class collisions** (the `.mrow` lesson)

Run: `grep -n "gcard-srv\|gcard-store" app/globals.css app/**/*.tsx`
Expected: no matches.

- [ ] **Step 2: Copy the logos**

```bash
mkdir -p public/stores
cp design/logos/walmart.svg design/logos/costco.svg public/stores/
```

- [ ] **Step 3: CSS**

In `app/globals.css`, change the `.gcard-src` rule (line 1090) to add vertical centering (logos are taller than the 9.5px text):

```css
.gcard-src { display: flex; flex-wrap: wrap; gap: 2px 9px; font-family: var(--font-mono); font-size: 9.5px; color: var(--muted); margin-top: -4px; align-items: center; }
```

After the `.gcard-macnums` color rules (line 1107), add:

```css
/* Store logo in the meta row (falls back to plain text for unknown stores). */
.gcard-store { height: 11px; width: auto; display: block; }
.gcard-store.costco { height: 13px; }

/* The tappable "my serving" amount. Dotted underline = flippable. */
.gcard-srv {
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--muted);
  cursor: pointer;
  border-bottom: 1px dotted var(--faint);
}
.gcard-srv.static { cursor: default; border-bottom: none; }
.gcard-srv .state { color: var(--accent); }
```

- [ ] **Step 4: Commit**

```bash
git add public/stores app/globals.css
git commit -m "feat(groceries): store logo assets + serving-toggle card styles"
```

---

### Task 5: Card rendering — logo, tappable serving, scaled macros

**Files:**
- Modify: `app/groceries/groceries-list.tsx` (imports; `costPerServing`; `GroceriesList` state; `renderCard`, lines ~295-344)

**Interfaces:**
- Consumes: `servingDisplay`/`ServingDisplay` (Task 2), `GroceryView.displayQty/servingDesc/rawToCookedYield` (Task 3), CSS + assets (Task 4).

- [ ] **Step 1: Imports + logo map + cost scaling**

Add to the imports:

```ts
import { servingDisplay } from "@/lib/serving-display";
import { parseServing } from "@/lib/resolve-item";
```

(`parseServing` is used by Task 6's form; importing now keeps this task's diff self-contained if 6 lands separately — remove from this step if the linter flags it, and re-add in Task 6.)

Below `normCat`, add:

```ts
// Known store logos; anything else renders as plain text.
const STORE_LOGOS: Record<string, { src: string; cls: string }> = {
  walmart: { src: "/stores/walmart.svg", cls: "" },
  costco: { src: "/stores/costco.svg", cls: " costco" },
};
```

Change `costPerServing` to price the *displayed* serving (spec §What-changes 5):

```ts
function costPerServing(g: GroceryGroupItem): string | null {
  return g.price != null && g.purchaseWeightG != null && g.servingGrams
    ? ((g.price / (g.purchaseWeightG / g.servingGrams)) * g.displayQty).toFixed(2)
    : null;
}
```

- [ ] **Step 2: Flip state (component-level, keyed by food id)**

`renderCard` is a plain render helper, not a component — per-card hooks are impossible, so the flip set lives on `GroceriesList`. Next to the other `useState` calls add:

```ts
  const [flippedIds, setFlippedIds] = useState<Set<number>>(new Set());
  const toggleFlip = (id: number) =>
    setFlippedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
```

(A food appearing on two shelves — chicken in Lunch and Dinner — flips in both at once: same id, consistent by design.)

- [ ] **Step 3: Rewrite `renderCard`'s body top**

Replace the `meta`/`segs` lines and the name/src/kc/bar/macnums JSX (keep photo, foot, Edit/Delete untouched):

```tsx
  const renderCard = (g: GroceryGroupItem, key: string) => {
    const cat = normCat(g.category);
    const cost = costPerServing(g);
    const disp = servingDisplay(g);
    const flipped = flippedIds.has(g.id) && disp.flip !== null;
    const label = flipped ? disp.flip! : disp.base;
    const macros = flipped ? disp.flip!.macros : disp.baseMacros;
    // Only macros present (>0) get a bar segment AND a number; both use flex = grams
    // so each number sits under its own segment and tracks its width.
    const segs = ([["mp", "P", macros.proteinG], ["mc", "C", macros.carbsG], ["mf", "F", macros.fatG]] as const).filter(([, , v]) => v > 0);
```

and the JSX for name/src/kcal:

```tsx
        <div className="gcard-body">
          <div className="gcard-nm">{disp.title}</div>
          <div className="gcard-src">
            {g.brand && <span>{g.brand}</span>}
            {(() => {
              const logo = g.store ? STORE_LOGOS[g.store.toLowerCase().trim()] : undefined;
              if (logo) return <img className={`gcard-store${logo.cls}`} src={logo.src} alt={g.store!} />;
              return g.store ? <span>{g.store}</span> : null;
            })()}
            <button
              type="button"
              className={`gcard-srv${disp.flip ? "" : " static"}`}
              onClick={disp.flip ? () => toggleFlip(g.id) : undefined}
            >
              {label.amount}
              {label.suffix && <> <span className="state">{label.suffix}</span></>}
            </button>
          </div>
          <div className="gcard-kc">{macros.kcal}<span>kcal</span></div>
```

(The old `meta` array — `[g.brand, g.store, servingGrams-or-"no weight"]` — is fully replaced; delete it. The `<img>` needs the existing `eslint-disable-next-line @next/next/no-img-element` comment above it, same as the photo img.)

The bar + macnums JSX is unchanged in shape but reads the new `segs` (already wired by the code above — the `v` values are now scaled).

- [ ] **Step 4: Verify in the running app**

```bash
rm -rf .next && PORT=3100 npm run dev   # backgrounded; CSS changed in Task 4 → cold start
```

Log in at `http://localhost:3100/login` (password `[REDACTED]`), open `/groceries`. NB: the live rename/pre-fill lands in Task 7, so at this point every card shows its 1× basis (`3.5 oz (100 g) cooked` chicken with a working flip to `4.5 oz (133 g) uncooked`, `1 tbsp` PB static) — labels and flips must work; the 6-oz numbers appear after Task 7. Walmart/Costco logos must render; a food with no store shows no logo (chicken/eggs still have store="Walmart" so check against a quick browser devtools-edited card OR trust the ternary).

Run: `npx tsc --noEmit` → clean. `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add app/groceries/groceries-list.tsx
git commit -m "feat(groceries): cards show my-serving macros, store logos, tap-to-flip amounts"
```

---

### Task 6: Edit form — "My serving" input (+ make count foods saveable)

**Files:**
- Modify: `app/groceries/groceries-list.tsx` (`FormState`, `EMPTY`, `toForm`, `save`, form JSX)

**Interfaces:**
- Consumes: `parseServing` (imported in Task 5), `toGrams` (already imported), REST `displayQty` (Task 3).

**Why the count-food fix:** today `save()` requires a positive serving weight and always sends `servingGrams`, and `updateGrocery` rewrites `servingDesc` to `"<n> g"` whenever `servingGrams` arrives — so editing eggs/PB would both fail validation AND (if forced) clobber `"1 tbsp"` → `"x g"`. Editing PB's my-serving requires fixing this: count foods omit `servingGrams` from the PATCH body entirely.

- [ ] **Step 1: FormState + EMPTY + toForm**

Add to `FormState` (after `servingUnit`):

```ts
  myServing: string;       // display serving: grams/oz for weighed, count for unit foods
  myServingUnit: WeightUnit;
  basisUnit: string | null; // "tbsp"/"egg"/… for count foods; null = weighed or new
```

Add to `EMPTY`:

```ts
  myServing: "", myServingUnit: "g", basisUnit: null,
```

In `toForm`, add after `servingUnit: "g",`:

```ts
    myServing:
      g.servingGrams != null
        ? String(+(g.displayQty * g.servingGrams).toFixed(1))
        : String(g.displayQty),
    myServingUnit: "g",
    basisUnit: g.servingGrams != null ? null : parseServing(g.servingDesc).unit,
```

- [ ] **Step 2: save() — validation + body**

Replace the validation block at the top of `save()`:

```ts
    const isCount = form.basisUnit !== null;
    const serving = Number(form.serving);
    const kcal = Number(form.kcal);
    if (!form.name.trim() || !Number.isFinite(kcal) || (!isCount && (!Number.isFinite(serving) || serving <= 0))) {
      setError("Name and calories are required (plus a positive serving size for weighed foods).");
      return;
    }
    const servingGrams = isCount ? null : toGrams(serving, form.servingUnit);
    let displayQty: number | null = null;
    if (form.myServing.trim() !== "") {
      const v = Number(form.myServing);
      if (!Number.isFinite(v) || v <= 0) {
        setError("My serving must be a positive number.");
        return;
      }
      displayQty = isCount ? v : toGrams(v, form.myServingUnit) / servingGrams!;
    }
```

In the `body` literal, replace `servingGrams: toGrams(serving, form.servingUnit),` with:

```ts
      ...(servingGrams != null ? { servingGrams } : {}),
      displayQty,
```

(Empty my-serving sends `displayQty: null` → clears to 1× basis; PATCH treats null as clear, POST as absent — both defined in Task 3.)

- [ ] **Step 3: Form JSX**

After the existing serving-size `gr-row` (the one ending `per serving →`, line ~465), add:

```tsx
          <div className="gr-row">
            <input aria-label="My serving" inputMode="decimal" placeholder="My serving" value={form.myServing} onChange={(e) => set("myServing", e.target.value)} />
            {form.basisUnit === null ? (
              <select aria-label="My serving unit" value={form.myServingUnit} onChange={(e) => set("myServingUnit", e.target.value as WeightUnit)}>
                <option value="g">g</option>
                <option value="oz">oz</option>
              </select>
            ) : (
              <span className="gr-hint">{form.basisUnit}</span>
            )}
            <span className="gr-hint">shown on the card</span>
          </div>
```

- [ ] **Step 4: Verify live (dev server still running)**

On `/groceries`: Edit chicken → My serving shows `100` g (pre-Task-7 displayQty is 1) → change to `6` oz → Save → card reads `6 oz (170 g) cooked / 281 kcal`. Edit PB → My serving shows `1` with unit label `tbsp` → set `2` → Save → card `2 tbsp / 190 kcal` with a working flip. Then set chicken back: Edit → `100` g → Save (Task 7 sets the real values). Run `npx tsc --noEmit` + `npm test` → clean/green.

- [ ] **Step 5: Commit**

```bash
git add app/groceries/groceries-list.tsx
git commit -m "feat(groceries): 'My serving' form field; count foods save without clobbering their unit"
```

---

### Task 7: Seed data + live-DB apply (rename eggs, set display_qty)

**Files:**
- Modify: `db/seed-data.ts`, `db/seed.ts`, `db/apply-seed-v2.ts`, `db/seed-data.test.ts`, `lib/today.test.ts:30`
- Create: `db/apply-display-qty.ts`

**Interfaces:**
- Consumes: `foods.displayQty` column (Task 1).
- Produces: live Neon rows renamed/pre-filled; seed reset paths carry `displayQty`.

- [ ] **Step 1: Update the failing tests first**

`db/seed-data.test.ts:9` — change to:

```ts
    expect(byName.get("Large Eggs")).toMatchObject({ servingDesc: "1 egg", servingGrams: null, displayQty: null });
```

and add inside the same `it` (or a sibling) the display-qty assertions:

```ts
    expect(byName.get("Chicken breast, cooked")).toMatchObject({ displayQty: 1.7 });
    expect(byName.get("White rice, cooked")).toMatchObject({ displayQty: 4 });
    expect(byName.get("Frozen mixed vegetables, cooked")).toMatchObject({ displayQty: 2.5 });
    expect(byName.get("Dry-roasted peanuts, salted")).toMatchObject({ displayQty: 0.4 });
    expect(byName.get("Peanut butter")).toMatchObject({ displayQty: 2 });
```

`lib/today.test.ts:30` — change `"Egg, large"` to `"Large Eggs"` (this test reads the LIVE db; it goes green after Step 5 runs the apply script).

Run: `npx vitest run db/seed-data.test.ts` → FAIL (`displayQty` missing, name mismatch).

- [ ] **Step 2: `db/seed-data.ts`**

- Add to `SeedFood`: `displayQty: number | null; // owner's card serving; null = 1 × basis`
- Update `FOODS_V2` rows — rename the egg and add the new field to every row:
  - `Egg, large` → `name: "Large Eggs"`, `displayQty: null`
  - `Whole wheat bread` `displayQty: null` · `Peanut butter` `displayQty: 2` · `Banana, medium` `displayQty: null`
  - `Chicken breast, cooked` `displayQty: 1.7` · `White rice, cooked` `displayQty: 4`
  - `Canola oil` `displayQty: null` · `Frozen mixed vegetables, cooked` `displayQty: 2.5`
  - `Dry-roasted peanuts, salted` `displayQty: 0.4`
  - **Delete the `Ground beef 90/10, cooked` row** — the owner removed it from live data on 2026-07-07 ("leave beef for now and actually remove it"); keeping it in the seed would resurrect it on any re-apply (hazard already flagged in STATE.md). It's in no meal item; `computeTargets()` is unaffected.
- Update `MEAL_ITEMS_V2`: `["Breakfast", "Egg, large", 4]` → `["Breakfast", "Large Eggs", 4]`.

- [ ] **Step 3: Carry `displayQty` through both seed paths**

`db/seed.ts` — in the `FOODS_V2.map` values, after `rawToCookedYield`:

```ts
        displayQty: food.displayQty === null ? null : String(food.displayQty),
```

`db/apply-seed-v2.ts` — same line in its `values` literal, and add the rename so the apply stays idempotent against the live DB:

```ts
const RENAMES: Record<string, string> = {
  "Frozen mixed vegetables": "Frozen mixed vegetables, cooked",
  "Dry-roasted peanuts": "Dry-roasted peanuts, salted",
  "Egg, large": "Large Eggs",
};
```

- [ ] **Step 4: Run the seed-data test**

Run: `npx vitest run db/seed-data.test.ts` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: One-time live apply script**

Create `db/apply-display-qty.ts`:

```ts
import "./env";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { foods } from "./schema";

// ---------------------------------------------------------------------------
// One-time live-data apply for the "my serving" display feature (2026-07-07).
// Renames the eggs and sets display_qty on the five foods whose card serving
// differs from 1 × basis. Idempotent; touches nothing else.
// Run: npx tsx db/apply-display-qty.ts
// ---------------------------------------------------------------------------

const DISPLAY_QTY: Record<string, number> = {
  "Chicken breast, cooked": 1.7,
  "White rice, cooked": 4,
  "Frozen mixed vegetables, cooked": 2.5,
  "Dry-roasted peanuts, salted": 0.4,
  "Peanut butter": 2,
};

async function apply() {
  const renamed = await db
    .update(foods)
    .set({ name: "Large Eggs" })
    .where(eq(foods.name, "Egg, large"))
    .returning({ id: foods.id });
  for (const [name, qty] of Object.entries(DISPLAY_QTY)) {
    const rows = await db
      .update(foods)
      .set({ displayQty: String(qty) })
      .where(eq(foods.name, name))
      .returning({ id: foods.id });
    if (rows.length !== 1) throw new Error(`Expected exactly 1 live row named "${name}", got ${rows.length}`);
  }
  console.log(`Applied: eggs renamed (${renamed.length} row), display_qty set on 5 foods.`);
}

apply()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

Run: `npx tsx db/apply-display-qty.ts`
Expected: `Applied: eggs renamed (1 row), display_qty set on 5 foods.`

- [ ] **Step 6: Full suite** (today.test.ts's rename expectation now matches live)

Run: `npm test` → ALL green (55 tests: 48 baseline + 6 serving-display + 1 groceries round-trip, with seed-data assertions folded into its existing test). `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add db/seed-data.ts db/seed.ts db/apply-seed-v2.ts db/apply-display-qty.ts db/seed-data.test.ts lib/today.test.ts
git commit -m "feat(groceries): seed + live data — Large Eggs rename, display_qty pre-fill, beef seed row removed"
```

---

### Task 8: End-to-end verification (invoke the `verify` skill if available)

**Files:** none (verification only)

- [ ] **Step 1: API round-trip via curl** (dev server on :3100)

```bash
curl -s -c /tmp/kal.jar -X POST localhost:3100/api/auth/login -H 'Content-Type: application/json' -d '{"password":"[REDACTED]"}'
curl -s -b /tmp/kal.jar localhost:3100/api/groceries | python3 -m json.tool | grep -A1 '"name": "Chicken'
```
Expected: chicken row has `"displayQty": 1.7`, eggs row is named `"Large Eggs"`.

```bash
CHICKEN_ID=<id from above>
curl -s -b /tmp/kal.jar -X PATCH localhost:3100/api/groceries/$CHICKEN_ID -H 'Content-Type: application/json' -d '{"displayQty":0}'
```
Expected: 400 `displayQty must be a positive number`. Then PATCH `{"displayQty":1.7}` → 200 (restores, no-op).

- [ ] **Step 2: Screen check against the approved mockup** (`design/groceries-serving-display.html`)

On `http://localhost:3100/groceries`: chicken card = `Chicken breast · [Walmart logo] · 6 oz (170 g) cooked · 281 kcal · 52.7P 6.1F`, tap → `8 oz (227 g) uncooked`, macros unchanged; rice = Costco logo, `14 oz (400 g) cooked` ↔ `4.5 oz (133 g) uncooked`; PB `2 tbsp / 190` ↔ `1 tbsp / 95`; eggs card titled `Large Eggs`, `1 egg`, static; both group-by modes fine.

- [ ] **Step 3: Chat sanity** (display-only invariant)

`curl` a chat turn or check `lib/system-prompt.ts` renders plan lines unchanged — plan lines come from `meal_items.quantity`, not `display_qty`; eggs line now reads `Large Eggs: 4 egg`. Nothing else moved.

- [ ] **Step 4: Report** — show the owner; deploy + STATE.md update only after owner acceptance (maintenance protocol: bump *Last updated*, move backlog items — note the store-badge line in backlog #1 is absorbed — add the feature section, commit STATE.md with the deploy).
