import type { NextRequest } from "next/server";
import { searchNutrition } from "@/lib/nutrition-lookup";

// GET /api/nutrition?q=...  — OpenFoodFacts lookup (name or barcode). Returns
// up to 8 data-bearing hits with per-100g macros to prefill the grocery form.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return Response.json(await searchNutrition(q));
}
