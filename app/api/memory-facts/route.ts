import type { NextRequest } from "next/server";
import { addMemoryFact, listMemoryFacts } from "@/lib/memory";

export async function GET() {
  return Response.json(await listMemoryFacts());
}

// POST /api/memory-facts — the user tells Kal something directly.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) ?? {};
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) return Response.json({ error: "content is required" }, { status: 400 });
  return Response.json(await addMemoryFact(content), { status: 201 });
}
