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
