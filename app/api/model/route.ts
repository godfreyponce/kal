import { get } from "@vercel/blob";

const PATHNAME = "model/figure.glb";

// GET /api/model — streams the owner's 3D model GLB from the private Blob store
// (kal-private — its own token, separate from the public grocery-photo store).
export async function GET() {
  const result = await get(PATHNAME, {
    access: "private",
    token: process.env.MODEL_BLOB_READ_WRITE_TOKEN,
  });
  if (!result || result.statusCode !== 200) {
    return Response.json({ error: "no model uploaded" }, { status: 404 });
  }

  const headers = new Headers({
    "content-type": "model/gltf-binary",
    "cache-control": "private, max-age=3600",
  });
  // The store often serves compressed/chunked (no content-length upstream), in
  // which case the SDK reports size 0 — only forward a length when it's real.
  if (result.blob.size > 0) headers.set("content-length", String(result.blob.size));

  return new Response(result.stream, { headers });
}
