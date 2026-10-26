import { describe, it, expect } from "vitest";
import { usageCostUsd } from "./anthropic";

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
