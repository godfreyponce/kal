import type Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import { CHAT_MODEL, MAX_TOOL_ITERATIONS, getAnthropic, usageCostUsd } from "@/lib/anthropic";
import { assembleSystemPrompt } from "@/lib/system-prompt";
import { TOOLS, runTool } from "@/lib/tools";
import { todayInAppTz } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 60;

const HISTORY_CAP = 30;
const MAX_TOKENS = 2048;

const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

type Msg = Anthropic.MessageParam;

// A stored user/tool-result turn that has no preceding assistant tool_use in the
// kept window would 400 — so trim the head to start on a "clean" user message.
function isToolResultTurn(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((b) => (b as { type?: string }).type === "tool_result")
  );
}

async function loadHistory(sessionId: string): Promise<Msg[]> {
  const rows = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));

  let msgs = rows.map((r) => ({ role: r.role as "user" | "assistant", content: r.content as Anthropic.ContentBlockParam[] }));
  if (msgs.length > HISTORY_CAP) msgs = msgs.slice(-HISTORY_CAP);
  while (msgs.length && (msgs[0].role === "assistant" || isToolResultTurn(msgs[0].content))) {
    msgs.shift();
  }
  return msgs;
}

async function persist(sessionId: string, role: "user" | "assistant", content: unknown) {
  await db.insert(chatMessages).values({ sessionId, role, content });
}

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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : null;
  const mediaType = IMAGE_MEDIA_TYPES.includes(body.mediaType) ? (body.mediaType as ImageMediaType) : null;
  if (!sessionId || (!message && !(imageBase64 && mediaType))) {
    return Response.json({ error: "sessionId and a message or image are required" }, { status: 400 });
  }
  if (imageBase64 && imageBase64.length > 6_000_000) {
    return Response.json({ error: "image too large" }, { status: 400 });
  }

  let client;
  try {
    client = getAnthropic();
  } catch {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });
  }

  const date = todayInAppTz();
  const { staticText, dynamicText } = await assembleSystemPrompt(date);
  // Cache breakpoints: (1) last tool, (2) static system block. The dynamic block
  // sits after them so per-day numbers never bust the tools+static prefix.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
  const tools: Anthropic.Tool[] = TOOLS.map((t, i) =>
    i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
  );

  const history = await loadHistory(sessionId);
  const userBlocks: Anthropic.ContentBlockParam[] = [];
  if (imageBase64 && mediaType) {
    userBlocks.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: imageBase64 },
    });
  }
  if (message) userBlocks.push({ type: "text", text: message });
  await persist(sessionId, "user", userBlocks);
  const messages: Msg[] = [...history, { role: "user", content: userBlocks }];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      const acc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      try {
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          setRollingCacheMark(messages);
          const ms = client.messages.stream({
            model: CHAT_MODEL,
            max_tokens: MAX_TOKENS,
            system,
            tools,
            messages,
          });

          for await (const event of ms) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send({ type: "text", text: event.delta.text });
            }
          }

          const final = await ms.finalMessage();
          acc.input += final.usage.input_tokens ?? 0;
          acc.output += final.usage.output_tokens ?? 0;
          acc.cacheRead += final.usage.cache_read_input_tokens ?? 0;
          acc.cacheWrite += final.usage.cache_creation_input_tokens ?? 0;
          await persist(sessionId, "assistant", final.content);
          messages.push({ role: "assistant", content: final.content });

          if (final.stop_reason !== "tool_use") break;

          const toolUses = final.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          const results: Anthropic.ContentBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
            const run = await runTool(tu.name, tu.input as Record<string, unknown>);
            send({
              type: "tool_result",
              id: tu.id,
              name: tu.name,
              summary: run.summary,
              writeBatchId: run.writeBatchId,
              card: run.card ?? null,
              remaining: run.remaining ?? null,
            });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: run.forModel });
          }

          await persist(sessionId, "user", results);
          messages.push({ role: "user", content: results });

          if (i === MAX_TOOL_ITERATIONS - 1) {
            send({ type: "error", message: "Reached tool-iteration limit." });
          }
        }
        send({
          type: "usage",
          tokens: acc,
          costUsd: usageCostUsd(CHAT_MODEL, {
            input_tokens: acc.input,
            output_tokens: acc.output,
            cache_read_input_tokens: acc.cacheRead,
            cache_creation_input_tokens: acc.cacheWrite,
          }),
        });
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "chat failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
