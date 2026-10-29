import type Anthropic from "@anthropic-ai/sdk";
import { MAX_TOOL_ITERATIONS } from "./anthropic";
import { TOOLS, type ToolRun } from "./tools";

// The chat tool loop, shared by /api/chat and `npm run eval` so the eval drives the same
// params and loop the owner's chat runs.

const MAX_TOKENS = 64_000;

type Msg = Anthropic.MessageParam;

/** System blocks and tools with their cache breakpoints. */
export function chatRequest(staticText: string, dynamicText: string) {
  // Cache breakpoints: (1) last tool, (2) static system block. The dynamic block
  // sits after them so per-day numbers never bust the tools+static prefix.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
  const tools: Anthropic.Tool[] = TOOLS.map((t, i) =>
    i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
  );
  return { system, tools };
}

export type TurnTokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ChatTurnHooks = {
  runTool(name: string, input: Record<string, unknown>): Promise<ToolRun>;
  onText?(text: string): void;
  /** After each finalMessage(), before it is appended. */
  onMessage?(message: Anthropic.Message): Promise<void>;
  /** Before runTool. */
  onToolUse?(toolUse: Anthropic.ToolUseBlock): void;
  onToolResult?(toolUse: Anthropic.ToolUseBlock, run: ToolRun): void;
  /** Before they are appended. */
  onToolResults?(results: Anthropic.ContentBlockParam[]): Promise<void>;
};

// Breakpoint (3): keep one rolling cache marker on the conversation's last block
// so each tool-loop iteration (which replays the whole history) reads everything
// before it from cache. Old marks are stripped first — max 4 breakpoints total.
function setRollingCacheMark(messages: Msg[]) {
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) delete (b as { cache_control?: unknown }).cache_control;
    }
  }
  const last = messages[messages.length - 1];
  if (Array.isArray(last?.content) && last.content.length > 0) {
    (last.content[last.content.length - 1] as { cache_control?: unknown }).cache_control = {
      type: "ephemeral",
    };
  }
}

/** Runs one chat turn's tool loop. Appends to `req.messages` in place. */
export async function runChatTurn(
  req: {
    client: Anthropic;
    model: string;
    system: Anthropic.TextBlockParam[];
    tools: Anthropic.Tool[];
    messages: Msg[];
  },
  hooks: ChatTurnHooks,
): Promise<{ tokens: TurnTokens; hitToolLimit: boolean }> {
  const { client, model, system, tools, messages } = req;
  const tokens: TurnTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let hitToolLimit = false;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    setRollingCacheMark(messages);
    const ms = client.messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system,
      tools,
      messages,
    });

    for await (const event of ms) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        hooks.onText?.(event.delta.text);
      }
    }

    const final = await ms.finalMessage();
    await hooks.onMessage?.(final);
    tokens.input += final.usage.input_tokens ?? 0;
    tokens.output += final.usage.output_tokens ?? 0;
    tokens.cacheRead += final.usage.cache_read_input_tokens ?? 0;
    tokens.cacheWrite += final.usage.cache_creation_input_tokens ?? 0;
    messages.push({ role: "assistant", content: final.content });

    if (final.stop_reason !== "tool_use") break;

    const toolUses = final.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const results: Anthropic.ContentBlockParam[] = [];
    for (const tu of toolUses) {
      hooks.onToolUse?.(tu);
      const run = await hooks.runTool(tu.name, tu.input as Record<string, unknown>);
      hooks.onToolResult?.(tu, run);
      results.push({ type: "tool_result", tool_use_id: tu.id, content: run.forModel });
    }

    await hooks.onToolResults?.(results);
    messages.push({ role: "user", content: results });

    if (i === MAX_TOOL_ITERATIONS - 1) hitToolLimit = true;
  }

  return { tokens, hitToolLimit };
}
