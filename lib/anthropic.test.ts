import { describe, it, expect } from "vitest";
import { usageCostUsd, withoutThinking } from "./anthropic";

describe("usageCostUsd", () => {
  it("prices Opus 5.5 with its 0.05x cache-read rate", () => {
    const cost = usageCostUsd("claude-opus-5-5", {
      input_tokens: 1_000_000, output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(4 + 20 + 0.2 + 5, 6);
  });
  it("prices Sonnet 5.5", () => {
    const cost = usageCostUsd("claude-sonnet-5-5", {
      input_tokens: 1_000_000, output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(2 + 10 + 0.1 + 2.5, 6);
  });
  it("keeps the 0.1x cache-read default for models without a cacheRead price", () => {
    expect(usageCostUsd("claude-haiku-4-5", { cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.1, 6);
  });
  it("returns null for an unknown model", () => {
    expect(usageCostUsd("claude-nope", { input_tokens: 10 })).toBeNull();
  });
});

describe("withoutThinking", () => {
  it("drops thinking and redacted_thinking, keeps text and tool_use in order", () => {
    const out = withoutThinking([
      { role: "user", content: [{ type: "text", text: "log 2 eggs" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: "Logging." },
          { type: "redacted_thinking", data: "x" },
          { type: "tool_use", id: "t1", name: "log_food", input: {} },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    ]);
    expect(out[1].content).toEqual([
      { type: "text", text: "Logging." },
      { type: "tool_use", id: "t1", name: "log_food", input: {} },
    ]);
    expect(out[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] });
  });
  it("drops an assistant message left empty, and one stored empty", () => {
    const out = withoutThinking([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig" }] },
      { role: "assistant", content: [] },
      { role: "user", content: "again" },
    ]);
    expect(out).toEqual([{ role: "user", content: "hi" }, { role: "user", content: "again" }]);
  });
});
