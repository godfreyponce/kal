import type { NextRequest } from "next/server";
import { revertWriteBatch } from "@/lib/undo";

// POST /api/undo  body: { writeBatchId }
// Reverts the rows a single write tool created (log_entries + meal_status).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const writeBatchId = typeof body.writeBatchId === "string" ? body.writeBatchId : null;
  if (!writeBatchId) {
    return Response.json({ error: "writeBatchId is required" }, { status: 400 });
  }
  const result = await revertWriteBatch(writeBatchId);
  return Response.json(result);
}
