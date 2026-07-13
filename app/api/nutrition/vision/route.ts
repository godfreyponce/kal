import type { NextRequest } from "next/server";
import { readLabelImage } from "@/lib/label-vision";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type Allowed = (typeof ALLOWED)[number];

// POST /api/nutrition/vision  body: { imageBase64, mediaType }
// Reads a Nutrition Facts photo with Claude vision → one serving's macros.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) ?? {};
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  const mediaType = body.mediaType as string;
  if (!imageBase64) return Response.json({ error: "imageBase64 is required" }, { status: 400 });
  if (!ALLOWED.includes(mediaType as Allowed)) {
    return Response.json({ error: "unsupported image type" }, { status: 400 });
  }
  try {
    const result = await readLabelImage(imageBase64, mediaType as Allowed);
    if (!result) return Response.json({ error: "Couldn't read the label — try a clearer photo." }, { status: 422 });
    return Response.json(result);
  } catch {
    return Response.json({ error: "Label read failed." }, { status: 500 });
  }
}
