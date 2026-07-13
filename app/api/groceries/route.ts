import type { NextRequest } from "next/server";
import { listGroceries, createGrocery, type GroceryInput } from "@/lib/groceries";

// GET /api/groceries — list all grocery items.
export async function GET() {
  return Response.json(await listGroceries());
}

// POST /api/groceries — create. body: GroceryInput (servingGrams + kcal required).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) ?? {};
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
  if (body.displayQty != null && (!Number.isFinite(Number(body.displayQty)) || Number(body.displayQty) <= 0)) {
    return Response.json({ error: "displayQty must be a positive number" }, { status: 400 });
  }

  // Photo is the pasted image address (reliable); the link is just a rebuy reference.
  const imageUrl =
    typeof body.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : null;
  const input: GroceryInput = {
    name,
    brand: body.brand ?? null,
    store: body.store ?? null,
    link: body.link || null,
    imageUrl,
    category: body.category ?? null,
    servingGrams,
    kcal,
    proteinG: Number(body.proteinG) || 0,
    carbsG: Number(body.carbsG) || 0,
    fatG: Number(body.fatG) || 0,
    displayQty: body.displayQty == null ? null : Number(body.displayQty),
    purchaseWeightG: body.purchaseWeightG == null ? null : Number(body.purchaseWeightG),
    price: body.price == null ? null : Number(body.price),
  };
  return Response.json(await createGrocery(input), { status: 201 });
}
