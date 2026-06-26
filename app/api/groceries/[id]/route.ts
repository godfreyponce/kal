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

  // name is required (non-null); the rest may be set to null to clear them.
  if (body.name !== undefined && body.name !== null) patch.name = body.name;
  for (const k of ["brand", "store", "link", "category"] as const) {
    if (body[k] !== undefined) patch[k] = body[k] || null;
  }
  // Photo is the pasted image address: "" clears it, a value sets it directly.
  if (body.imageUrl !== undefined) {
    patch.imageUrl = body.imageUrl ? String(body.imageUrl).trim() : null;
  }
  // Non-nullable numerics: skip null/undefined.
  for (const k of ["servingGrams", "kcal", "proteinG", "carbsG", "fatG"] as const) {
    if (body[k] !== undefined && body[k] !== null) patch[k] = Number(body[k]);
  }
  // Nullable numerics: null clears the value.
  for (const k of ["purchaseWeightG", "price"] as const) {
    if (body[k] !== undefined) patch[k] = body[k] === null ? null : Number(body[k]);
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
  } catch (err) {
    // Only an FK-restrict violation (food still referenced) is an expected 409;
    // anything else is a real failure and should surface as a 500. Drizzle wraps
    // the neon/Postgres error, so the "23503" code lives on err.cause.
    const e = err as { code?: string; cause?: { code?: string } };
    const isForeignKey = e?.code === "23503" || e?.cause?.code === "23503";
    if (isForeignKey) {
      return Response.json(
        { error: "This food is used by your meal plan or past logs and can't be deleted." },
        { status: 409 },
      );
    }
    throw err;
  }
}
