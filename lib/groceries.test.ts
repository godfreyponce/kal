import "../db/env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db";
import { foods } from "../db/schema";
import { listGroceries, createGrocery, updateGrocery, deleteGrocery } from "./groceries";

const SENTINEL = "ZZTEST_GROCERY";

async function clear() {
  await db.delete(foods).where(like(foods.name, "ZZTEST_%"));
}
beforeAll(clear);
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
