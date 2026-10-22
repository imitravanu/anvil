import { describe, expect, it } from "vitest";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "../../../..");
const run = (json: boolean) => execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), path.join(repo, "scripts/certify-provider.ts"), "--mock", "--provider", "openai", ...(json ? ["--json"] : [])], { encoding: "utf8", env: { ...process.env }, timeout: 10000 });
describe("certification provenance", () => {
  it("labels the final matrix and summary as offline mock results", () => {
    const text = run(false);
    expect(text).toContain("providers passed offline mock certification");
    expect(text).not.toContain("✅ live");
    expect(text).not.toContain("certified live");
  });
  it("carries mock provenance in JSON", () => {
    const output = JSON.parse(run(true));
    expect(output.mode).toBe("mock");
    expect(output.results.openai.passed).toBe(true);
  });
});
