import type Anthropic from "@anthropic-ai/sdk";
import { describe, it, expect } from "vitest";
import { closeOrphanToolUses, INTERRUPTED_TOOL_RESULT } from "./chat-history";

type Msg = Anthropic.MessageParam;

const userText = (text: string): Msg => ({ role: "user", content: [{ type: "text", text }] });
const assistantText = (text: string): Msg => ({ role: "assistant", content: [{ type: "text", text }] });
const toolUse = (id: string): Anthropic.ToolUseBlockParam => ({
  type: "tool_use",
  id,
  name: "log_food",
  input: {},
});
const realResult = (id: string): Anthropic.ToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: id,
  content: "logged",
});
const synthetic = (id: string): Anthropic.ToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: id,
  is_error: true,
  content: INTERRUPTED_TOOL_RESULT,
});

describe("closeOrphanToolUses", () => {
  const tailOrphan = (): Msg[] => [
    userText("log 2 eggs"),
    { role: "assistant", content: [{ type: "text", text: "Logging." }, toolUse("a")] },
    userText("did it log?"),
  ];

  it("adds an interrupted result ahead of the new user text when the history ends on a tool_use", () => {
    const input = tailOrphan();
    const out = closeOrphanToolUses(input);
    expect(out).toHaveLength(3);
    expect(out[2].content).toEqual([synthetic("a"), { type: "text", text: "did it log?" }]);
    expect(out[0]).toEqual(input[0]);
    expect(out[1]).toEqual(input[1]);
  });

  it("repairs an orphan in the middle of the history", () => {
    const input: Msg[] = [
      userText("log 2 eggs"),
      { role: "assistant", content: [toolUse("a")] },
      userText("next"),
      assistantText("ok"),
      userText("now"),
    ];
    const out = closeOrphanToolUses(input);
    expect(out).toHaveLength(5);
    expect(out[2].content).toEqual([synthetic("a"), { type: "text", text: "next" }]);
    expect([out[0], out[1], out[3], out[4]]).toEqual([input[0], input[1], input[3], input[4]]);
  });

  it("adds one result per unanswered id", () => {
    const input: Msg[] = [
      userText("log eggs and toast"),
      { role: "assistant", content: [toolUse("a"), toolUse("b")] },
      userText("well?"),
    ];
    const out = closeOrphanToolUses(input);
    expect(out[2].content).toEqual([synthetic("a"), synthetic("b"), { type: "text", text: "well?" }]);
  });

  it("keeps a real result and adds only the missing one", () => {
    const input: Msg[] = [
      userText("log eggs and toast"),
      { role: "assistant", content: [toolUse("a"), toolUse("b")] },
      { role: "user", content: [realResult("a")] },
    ];
    const out = closeOrphanToolUses(input);
    expect(out[2].content).toEqual([realResult("a"), synthetic("b")]);
  });

  it("inserts a user message when nothing follows the tool_use", () => {
    const input: Msg[] = [userText("log 2 eggs"), { role: "assistant", content: [toolUse("a")] }];
    const out = closeOrphanToolUses(input);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ role: "user", content: [synthetic("a")] });
  });

  it("treats string user content as one text block", () => {
    const input: Msg[] = [
      userText("log 2 eggs"),
      { role: "assistant", content: [toolUse("a")] },
      { role: "user", content: "did it log?" },
    ];
    const out = closeOrphanToolUses(input);
    expect(out[2].content).toEqual([synthetic("a"), { type: "text", text: "did it log?" }]);
  });

  it("returns a clean history unchanged", () => {
    const input: Msg[] = [
      userText("log 2 eggs"),
      { role: "assistant", content: [toolUse("a")] },
      { role: "user", content: [realResult("a")] },
      assistantText("Logged."),
      userText("thanks"),
    ];
    expect(closeOrphanToolUses(input)).toEqual(input);
  });

  it("does not mutate its input", () => {
    const input = tailOrphan();
    const clone = structuredClone(input);
    closeOrphanToolUses(input);
    expect(input).toEqual(clone);
  });
});
