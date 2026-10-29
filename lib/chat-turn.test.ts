import "../db/env"; // chat-turn imports ./tools, which loads ../db; these tests make no queries
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { MAX_TOOL_ITERATIONS } from "./anthropic";
import { chatRequest, runChatTurn } from "./chat-turn";

const usage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

function message(content: unknown[], stop_reason: "tool_use" | "end_turn") {
  return { id: "m", type: "message", role: "assistant", model: "x", content, stop_reason, usage } as unknown as Anthropic.Message;
}

const toolUseMessage = () =>
  message([{ type: "tool_use", id: "tu1", name: "get_day_summary", input: {} }], "tool_use");
const endTurnMessage = () => message([{ type: "text", text: "done" }], "end_turn");

function fakeClient(next: () => Anthropic.Message) {
  const calls: Anthropic.MessageStreamParams[] = [];
  const client = {
    messages: {
      stream(params: Anthropic.MessageStreamParams) {
        calls.push(structuredClone(params));
        return {
          async *[Symbol.asyncIterator]() {},
          finalMessage: async () => next(),
        };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const req = (client: Anthropic) => ({
  client,
  model: "claude-test",
  ...chatRequest("static", "dynamic"),
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] as Anthropic.MessageParam[],
});

const okRun = { forModel: '{"ok":1}', summary: "", writeBatchId: null };

describe("runChatTurn", () => {
  it("feeds each tool result back and stops on end_turn", async () => {
    const script = [toolUseMessage(), endTurnMessage()];
    const { client, calls } = fakeClient(() => script.shift()!);
    const runTool = vi.fn(async () => okRun);

    const out = await runChatTurn(req(client), { runTool });

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith("get_day_summary", {});
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu1", content: '{"ok":1}' }],
    });
    expect(out.hitToolLimit).toBe(false);
    expect(out.tokens).toEqual({ input: 20, output: 10, cacheRead: 0, cacheWrite: 0 });
  });

  it("sends the chat model params on every request", async () => {
    const { client, calls } = fakeClient(endTurnMessage);

    await runChatTurn(req(client), { runTool: async () => okRun });

    expect(calls[0]).toMatchObject({
      model: "claude-test",
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
  });

  it("stops at MAX_TOOL_ITERATIONS and reports the limit", async () => {
    const { client, calls } = fakeClient(toolUseMessage);

    const out = await runChatTurn(req(client), { runTool: async () => okRun });

    expect(calls).toHaveLength(MAX_TOOL_ITERATIONS);
    expect(out.hitToolLimit).toBe(true);
  });
});
