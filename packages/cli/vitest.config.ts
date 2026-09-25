import { defineConfig } from "vitest/config";

// Coverage is opt-in (`npm run coverage`), separate from `npm test`, so a
// low-coverage area never blocks the gate. It counts production src/ only.
export default defineConfig({
  test: {
    // The entry-point harnesses (entry/boot/bootFailures) re-evaluate the whole
    // CLI + Ink module graph for EVERY test (vi.resetModules + a fresh import),
    // which costs seconds per test. The 5s default cap is a product-speed
    // assumption that does not hold for import-bound suites, and crossing it
    // made the gate flaky: the timeout also leaves the previous test's dispatch
    // running, which then pushes into the NEXT test's counters.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/__tests__/**", "**/*.test.*", "src/**/*.d.ts"],
    },
  },
});
