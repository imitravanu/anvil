import { defineConfig } from "vitest/config";

// Coverage is opt-in (`npm run coverage`), separate from `npm test`, so a
// low-coverage area never blocks the gate. It counts production src/ only.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/__tests__/**", "**/*.test.*", "src/**/*.d.ts"],
    },
  },
});
