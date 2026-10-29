import type Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import { usageCostUsd, withoutThinking } from "@/lib/anthropic";
import { getAnthropic } from "@/lib/anthropic-client";
import { chatRequest, runChatTurn } from "@/lib/chat-turn";
import { currentChatModel, recordApiCall } from "@/lib/spend";
import { assembleSystemPrompt } from "@/lib/system-prompt";
import { runTool } from "@/lib/tools";
import { todayInAppTz } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 300;

const HISTORY_CAP = 30;

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
  return withoutThinking(msgs);
}

async function persist(sessionId: string, role: "user" | "assistant", content: unknown) {
  await db.insert(chatMessages).values({ sessionId, role, content });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) ?? {};
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
  const { system, tools } = chatRequest(staticText, dynamicText);

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

  // Picked once, so a turn never switches models mid-loop even if spend crosses the threshold.
  const model = await currentChatModel();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      send({ type: "model", model });
      try {
        const { tokens: acc, hitToolLimit } = await runChatTurn(
          { client, model, system, tools, messages },
          {
            runTool,
            onText: (text) => send({ type: "text", text }),
            onMessage: async (final) => {
              await recordApiCall(model, "chat", final.usage);
              await persist(sessionId, "assistant", final.content);
            },
            onToolUse: (tu) => send({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input }),
            onToolResult: (tu, run) =>
              send({
                type: "tool_result",
                id: tu.id,
                name: tu.name,
                summary: run.summary,
                writeBatchId: run.writeBatchId,
                card: run.card ?? null,
                remaining: run.remaining ?? null,
              }),
            onToolResults: (results) => persist(sessionId, "user", results),
          },
        );
        if (hitToolLimit) send({ type: "error", message: "Reached tool-iteration limit." });
        send({
          type: "usage",
          tokens: acc,
          costUsd: usageCostUsd(model, {
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
