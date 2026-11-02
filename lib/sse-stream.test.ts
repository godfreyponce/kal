import { describe, it, expect } from "vitest";
import { sseStream } from "./sse-stream";

describe("sseStream", () => {
  it("streams each sent object as an SSE frame, then closes", async () => {
    const stream = sseStream(async (send) => {
      send({ type: "a" });
      send({ type: "b" });
    });
    const text = await new Response(stream).text();
    expect(text).toBe('data: {"type":"a"}\n\ndata: {"type":"b"}\n\n');
  });

  it("finishes the run after the reader cancels", async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => (openGate = resolve));
    let markFinished!: () => void;
    const finished = new Promise<void>((resolve) => (markFinished = resolve));

    const stream = sseStream(async (send) => {
      send({ type: "model" });
      await gate;
      send({ type: "late" });
      markFinished();
    });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    openGate();

    await expect(finished).resolves.toBeUndefined();
  });
});
