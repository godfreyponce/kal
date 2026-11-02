import type { NextRequest } from "next/server";
import { revertWriteBatch } from "@/lib/undo";

// POST /api/undo  body: { writeBatchId }
// Reverts the rows a single write tool created (log_entries, meal_status,
// meal_overrides; restores replaced rows). 409 when a later write replaced it.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) ?? {};
  const writeBatchId = typeof body.writeBatchId === "string" ? body.writeBatchId : null;
  if (!writeBatchId) {
    return Response.json({ error: "writeBatchId is required" }, { status: 400 });
  }
  const result = await revertWriteBatch(writeBatchId);
  if (!result.reverted) {
    return Response.json(
      { error: "This change was replaced by a later one.", reason: result.reason },
      { status: 409 },
    );
  }
  return Response.json(result);
}
