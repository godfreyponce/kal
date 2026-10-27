import Anthropic from "@anthropic-ai/sdk";

// #62 Q14 moved the chat to Opus 5.5; the spend guard in lib/spend.ts falls back to Sonnet 5.5.
export const CHAT_MODEL = "claude-opus-5-5";
export const FALLBACK_CHAT_MODEL = "claude-sonnet-5-5";

// Hard cap on the agentic loop so a misbehaving model can't run forever.
export const MAX_TOOL_ITERATIONS = 8;

// USD per 1M tokens (input / output). Cache reads default to 0.1× input unless the model
// sets its own `cacheRead`; 5-minute cache writes are 1.25× input.
const PRICING: Record<string, { in: number; out: number; cacheRead?: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-6": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-fable-5": { in: 10, out: 50 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
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
  return (input * p.in + output * p.out + cacheRead * (p.cacheRead ?? p.in * 0.1) + cacheWrite * p.in * 1.25) / 1e6;
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
