import Anthropic from "@anthropic-ai/sdk";

// Cheapest-capable principle: Haiku runs the chat tool-loop by default, overridable
// via env. Bump to a reasoning tier only if Haiku fumbles multi-step tool use.
export const CHAT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

// Hard cap on the agentic loop so a misbehaving model can't run forever.
export const MAX_TOOL_ITERATIONS = 8;

let client: Anthropic | null = null;

/** Lazily construct the client so a missing key only fails the chat route, not import. */
export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  client ??= new Anthropic();
  return client;
}
