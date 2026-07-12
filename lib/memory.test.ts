import "../db/env";
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "../db";
import { memoryFacts } from "../db/schema";
import { addMemoryFact, deleteMemoryFact, listMemoryFacts, updateMemoryFact } from "./memory";

// Sentinel content prefix for this FILE (parallel-safe cleanup by prefix).
const P = "zz-test-memory-2099:";

async function cleanup() {
  await db.delete(memoryFacts).where(like(memoryFacts.content, `${P}%`));
}
afterEach(cleanup);
afterAll(cleanup);

describe("memory facts", () => {
  it("add → list (oldest first) → update → delete round-trip", async () => {
    const a = await addMemoryFact(`${P} first`);
    const b = await addMemoryFact(`${P} second`);
    const mine = (await listMemoryFacts()).filter((f) => f.content.startsWith(P));
    expect(mine.map((f) => f.id)).toEqual([a.id, b.id]);

    const upd = await updateMemoryFact(a.id, `${P} first edited`);
    expect(upd?.content).toBe(`${P} first edited`);
    expect(await updateMemoryFact(999999, `${P} nope`)).toBeNull();

    expect(await deleteMemoryFact(a.id)).toBe(true);
    expect(await deleteMemoryFact(a.id)).toBe(false);
    const left = (await listMemoryFacts()).filter((f) => f.content.startsWith(P));
    expect(left.map((f) => f.id)).toEqual([b.id]);
  });

  it("rejects empty content", async () => {
    await expect(addMemoryFact("   ")).rejects.toThrow(/required/);
    const a = await addMemoryFact(`${P} keep`);
    await expect(updateMemoryFact(a.id, "")).rejects.toThrow(/required/);
  });
});
