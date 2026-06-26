import { getAnthropic, CHAT_MODEL } from "./anthropic";

// Reads a Nutrition Facts photo with Claude vision and returns one serving's macros.
// This is the universal fallback for items the nutrition databases don't cover.

export type LabelNutrition = {
  name: string | null;
  servingGrams: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

const num = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
};
const round1 = (v: unknown): number => Math.round(num(v) * 10) / 10;

/** Extract + validate the model's JSON. Pure — no I/O. Returns null if unusable. */
export function parseLabelNutrition(text: string): LabelNutrition | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const servingGrams = num(obj.servingGrams);
  const kcal = num(obj.kcal);
  if (servingGrams <= 0 || kcal <= 0) return null;
  return {
    name: typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : null,
    servingGrams: Math.round(servingGrams * 100) / 100,
    kcal: Math.round(kcal),
    proteinG: round1(obj.proteinG),
    carbsG: round1(obj.carbsG),
    fatG: round1(obj.fatG),
  };
}

const PROMPT =
  "This image is a Nutrition Facts label. Return ONLY a JSON object for ONE serving, " +
  "no prose. Keys: name (the product name if visible, else null), servingGrams (the " +
  "serving size converted to grams — 1 oz = 28.35 g; use the gram weight in parentheses " +
  "if shown), kcal, proteinG, carbsG, fatG. Use numbers (grams) for the macros; if a value " +
  'is not on the label use 0. Example: {"name":"Peanuts","servingGrams":28,"kcal":180,"proteinG":8,"carbsG":4,"fatG":15}';

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** Send a base64 label image to Claude and parse the macros, or null on failure. */
export async function readLabelImage(base64: string, mediaType: ImageMediaType): Promise<LabelNutrition | null> {
  const res = await getAnthropic().messages.create({
    model: CHAT_MODEL,
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseLabelNutrition(text);
}
