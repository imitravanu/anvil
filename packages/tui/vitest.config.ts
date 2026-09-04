import { defineConfig } from "vitest/config";

// Phase 8 (C7): the tui build (tsc -p .) emits test files into dist/ — without
// this include, vitest counts each pure-helper test TWICE (src + dist copy).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});