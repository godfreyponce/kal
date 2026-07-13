import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests hit the LIVE Neon DB and several files touch shared
// singleton state (profile row, meals template). Run test files sequentially
// so one file's snapshot/restore window can't be observed by another.
// Per-file sentinel dates remain as defense in depth.
export default defineConfig({
  // Mirrors tsconfig's "@/*" -> "./*" so tests can import app/api route handlers directly.
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { fileParallelism: false },
});
