import { defineConfig } from "vitest/config";

// Integration tests hit the LIVE Neon DB and several files touch shared
// singleton state (profile row, meals template). Run test files sequentially
// so one file's snapshot/restore window can't be observed by another.
// Per-file sentinel dates remain as defense in depth.
export default defineConfig({
  test: { fileParallelism: false },
});
