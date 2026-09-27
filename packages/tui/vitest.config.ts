import { defineConfig } from "vitest/config";

// Phase 8 (C7): the tui build (tsc -p .) emits test files into dist/ — without
// this include, vitest counts each pure-helper test TWICE (src + dist copy).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The thinking-timer property wait can need ~10s of real time under gate
    // load before its 1s tick lands; vitest's 5s default killed the test
    // mid-wait, so the ceiling could never be reached and the gate went red on
    // machine load. The CLI suite set 20_000 for this same flake class.
    testTimeout: 20_000,
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