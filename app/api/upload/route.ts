import type { NextRequest } from "next/server";
import { put } from "@vercel/blob";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// POST /api/upload  body: { imageBase64, mediaType } — stores a product photo on
// Vercel Blob and returns its public URL (saved as the food's image_url).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "";
  if (!imageBase64) return Response.json({ error: "imageBase64 is required" }, { status: 400 });
  const ext = EXT[mediaType];
  if (!ext) return Response.json({ error: "unsupported image type" }, { status: 400 });

  try {
    const blob = await put(`groceries/${crypto.randomUUID()}.${ext}`, Buffer.from(imageBase64, "base64"), {
      access: "public",
      contentType: mediaType,
    });
    return Response.json({ url: blob.url });
  } catch (err) {
    // Surface the cause (e.g. missing BLOB_READ_WRITE_TOKEN) to make setup debuggable.
    const msg = err instanceof Error ? err.message : "Upload failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
