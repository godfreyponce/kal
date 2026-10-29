// `npm run eval [-- --repeat N]`: runs every case on both chat models against the real API with
// stubbed tools, and prints pass/fail per model, a score, and the token cost. Bills real calls.
// It never calls recordApiCall, so eval spend never moves the Opus→Sonnet fallback.
import "./env";
import Anthropic from "@anthropic-ai/sdk";
import { CHAT_MODEL, FALLBACK_CHAT_MODEL, usageCostUsd, withoutThinking } from "../lib/anthropic";
import { chatRequest, runChatTurn, type TurnTokens } from "../lib/chat-turn";
import { renderSystemPrompt } from "../lib/system-prompt";
import { CASES, type EvalCase } from "./cases";
import { FIXTURE, FIXTURE_DATE } from "./fixture";
import { scoreCase, type RecordedCall } from "./score";
import { createStubTools } from "./stubs";

const MODELS = [CHAT_MODEL, FALLBACK_CHAT_MODEL];

function parseRepeat(argv: string[]): number | null {
  const i = argv.indexOf("--repeat");
  if (i === -1) return 1;
  const raw = argv[i + 1] ?? "";
  const n = Number(raw);
  return /^\d+$/.test(raw) && n > 0 ? n : null;
}

type Spend = TurnTokens & { costUsd: number; unpriced: boolean };

async function runCase(
  client: Anthropic,
  model: string,
  c: EvalCase,
  spend: Spend,
): Promise<{ pass: boolean; failures: string[] }> {
  const stubs = createStubTools(c.context?.(FIXTURE) ?? FIXTURE, FIXTURE_DATE, c.stubs);
  const calls: RecordedCall[] = [];
  let messages: Anthropic.MessageParam[] = [];
  try {
    for (const [turn, text] of c.turns.entries()) {
      messages = withoutThinking(messages);
      messages.push({ role: "user", content: [{ type: "text", text }] });
      const { staticText, dynamicText } = renderSystemPrompt(FIXTURE_DATE, stubs.promptContext());
      await runChatTurn(
        { client, model, ...chatRequest(staticText, dynamicText), messages },
        {
          runTool: (tool, input) => {
            calls.push({ turn, tool, input });
            return stubs.runTool(tool, input);
          },
          onMessage: async ({ usage }) => {
            spend.input += usage.input_tokens ?? 0;
            spend.output += usage.output_tokens ?? 0;
            spend.cacheRead += usage.cache_read_input_tokens ?? 0;
            spend.cacheWrite += usage.cache_creation_input_tokens ?? 0;
            const cost = usageCostUsd(model, usage);
            if (cost === null) spend.unpriced = true;
            else spend.costUsd += cost;
          },
        },
      );
    }
  } catch (e) {
    return scoreCase(calls, c.expect, e instanceof Error ? e.message : String(e));
  }
  return scoreCase(calls, c.expect);
}

function cell(c: EvalCase, passes: number, runs: number): string {
  if (runs === 1) {
    if (c.knownFail) return passes ? "XPASS" : "XFAIL";
    return passes ? "PASS" : "FAIL";
  }
  return `${c.knownFail ? "xfail " : ""}${passes}/${runs}`;
}

async function main(): Promise<number> {
  const repeat = parseRepeat(process.argv.slice(2));
  if (repeat === null) {
    console.log("--repeat needs a positive integer");
    return 1;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY is not set in .env.local; npm run eval bills real calls and needs it.");
    return 1;
  }
  const client = new Anthropic();

  const passes = new Map<string, number>(); // `${model} ${case}` -> passed runs
  const failureLines: string[] = [];
  const spend = new Map<string, Spend>(
    MODELS.map((m) => [m, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, unpriced: false }]),
  );

  for (const model of MODELS) {
    for (const c of CASES) {
      for (let r = 0; r < repeat; r++) {
        const out = await runCase(client, model, c, spend.get(model)!);
        const key = `${model} ${c.id}`;
        passes.set(key, (passes.get(key) ?? 0) + (out.pass ? 1 : 0));
        if (!out.pass) failureLines.push(`${key}: ${out.failures[0]}`);
      }
    }
  }

  const rows = [
    ["case", "source", ...MODELS],
    ...CASES.map((c) => [
      c.id,
      c.knownFail ? `${c.source} (known-fail)` : c.source,
      ...MODELS.map((m) => cell(c, passes.get(`${m} ${c.id}`) ?? 0, repeat)),
    ]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  for (const row of rows) console.log(row.map((v, i) => v.padEnd(widths[i])).join("  ").trimEnd());

  if (failureLines.length) {
    console.log("\nfailures (first line per failed run):");
    for (const line of failureLines) console.log(`  ${line}`);
  }

  console.log("");
  const scored = CASES.filter((c) => !c.knownFail);
  for (const m of MODELS) {
    const passed = scored.reduce((a, c) => a + (passes.get(`${m} ${c.id}`) ?? 0), 0);
    console.log(`score ${m} ${passed}/${scored.length * repeat} (known-fail cases not counted)`);
  }

  let total = 0;
  for (const m of MODELS) {
    const s = spend.get(m)!;
    total += s.costUsd;
    const price = s.unpriced ? "unpriced" : `$${s.costUsd.toFixed(2)}`;
    console.log(
      `cost ${m} ${price} (${s.input} in / ${s.output} out / ${s.cacheRead} cache read / ${s.cacheWrite} cache write tokens)`,
    );
  }
  console.log(`cost total $${total.toFixed(2)}`);
  return 0;
}

main().then((code) => process.exit(code));
