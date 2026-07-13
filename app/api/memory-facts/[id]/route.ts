import type { NextRequest } from "next/server";
import { deleteMemoryFact, updateMemoryFact } from "@/lib/memory";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const factId = Number(id);
  if (!Number.isInteger(factId)) return Response.json({ error: "invalid id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) ?? {};
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
