import Anthropic from "@anthropic-ai/sdk";

// Cheapest-capable principle: Haiku runs the chat tool-loop by default, overridable
// via env. Bump to a reasoning tier only if Haiku fumbles multi-step tool use.
export const CHAT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

// Hard cap on the agentic loop so a misbehaving model can't run forever.
export const MAX_TOOL_ITERATIONS = 8;

// USD per 1M tokens (input / output). Cache reads ≈ 0.1× input, writes ≈ 1.25× input.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-6": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-fable-5": { in: 10, out: 50 },
};

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** Cost in USD for a usage object, or null if the model isn't in the price table. */
export function usageCostUsd(model: string, u: Usage): number | null {
  const p = PRICING[model];
  if (!p) return null;
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return (input * p.in + output * p.out + cacheRead * p.in * 0.1 + cacheWrite * p.in * 1.25) / 1e6;
}

let client: Anthropic | null = null;

/** Lazily construct the client so a missing key only fails the chat route, not import. */
export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  client ??= new Anthropic();
  return client;
}
