import type Anthropic from "@anthropic-ai/sdk";

type Msg = Anthropic.MessageParam;
type Block = Anthropic.ContentBlockParam;

export const INTERRUPTED_TOOL_RESULT =
  "Interrupted before this tool's result was saved. It may have run: check the log before doing it again.";

function blocksOf(content: Msg["content"]): Block[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

// A turn that kept running after its client left can save a tool_result after the
// user's resend, where no tool_use in the message before it matches.
function dropStrayToolResults(messages: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (msg.role !== "user" || typeof msg.content === "string") {
      out.push(msg);
      continue;
    }
    const asked = new Set(
      prev?.role === "assistant"
        ? blocksOf(prev.content).flatMap((b) => (b.type === "tool_use" ? [b.id] : []))
        : [],
    );
    const kept = msg.content.filter((b) => b.type !== "tool_result" || asked.has(b.tool_use_id));
    if (kept.length === msg.content.length) out.push(msg);
    else if (kept.length) out.push({ ...msg, content: kept });
  }
  return out;
}

// A turn cut off between an assistant tool_use and its saved tool_result leaves the
// session's history invalid, and the API 400s every later request. Answer each
// orphan in memory only: the DB keeps the truth, and each load repairs it again.
export function closeOrphanToolUses(input: Msg[]): Msg[] {
  const messages = dropStrayToolResults(input);
  const out: Msg[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    out.push(msg);
    if (msg.role !== "assistant") continue;

    const next = messages[i + 1];
    const nextBlocks = next?.role === "user" ? blocksOf(next.content) : [];
    const answered = new Set(
      nextBlocks.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : [])),
    );
    const missing: Anthropic.ToolResultBlockParam[] = blocksOf(msg.content).flatMap((b) =>
      b.type === "tool_use" && !answered.has(b.id)
        ? [{ type: "tool_result", tool_use_id: b.id, is_error: true, content: INTERRUPTED_TOOL_RESULT }]
        : [],
    );
    if (!missing.length) continue;

    if (next?.role === "user") {
      const results = nextBlocks.filter((b) => b.type === "tool_result");
      const rest = nextBlocks.filter((b) => b.type !== "tool_result");
      out.push({ ...next, content: [...results, ...missing, ...rest] });
      i++;
    } else {
      out.push({ role: "user", content: missing });
    }
  }
  return out;
}
