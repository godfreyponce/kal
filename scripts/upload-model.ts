import "../db/env";
import { createReadStream, existsSync, statSync } from "node:fs";
import { put } from "@vercel/blob";

// Uploads a GLB file to private Vercel Blob storage at model/figure.glb, where
// GET /api/model streams it from. Overwrites any existing upload.
// Run: npx tsx scripts/upload-model.ts <path-to-glb>
const PATHNAME = "model/figure.glb";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/upload-model.ts <path-to-glb>");
    process.exit(1);
  }
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  if (!process.env.MODEL_BLOB_READ_WRITE_TOKEN) {
    console.error("MODEL_BLOB_READ_WRITE_TOKEN is not set (check .env.local).");
    process.exit(1);
  }

  const size = statSync(filePath).size;
  const blob = await put(PATHNAME, createReadStream(filePath), {
    access: "private",
    allowOverwrite: true,
    contentType: "model/gltf-binary",
    token: process.env.MODEL_BLOB_READ_WRITE_TOKEN,
  });

  console.log(`Uploaded ${blob.pathname} (${size} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
