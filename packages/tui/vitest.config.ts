import { defineConfig } from "vitest/config";

// Phase 8 (C7): the tui build (tsc -p .) emits test files into dist/ — without
// this include, vitest counts each pure-helper test TWICE (src + dist copy).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Coverage is opt-in (`npm run coverage`), separate from `npm test`, so a
    // low-coverage area never blocks the gate. Counts production src/ only —
    // the __visual__ baseline tests are golden fixtures, not coverage surface.
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/__tests__/**", "**/*.test.*", "src/**/*.d.ts", "src/__visual__/**"],
    },
  },
});