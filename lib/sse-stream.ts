// After the reader cancels, enqueue and close both throw. A throwing send would end
// the run before its tool results are saved, so sends become no-ops and the run
// finishes on its own.
export function sseStream(run: (send: (obj: unknown) => void) => Promise<void>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cancelled = false;
  return new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        await run(send);
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}
