import { describe, expect, it } from "vitest";
import { formatToolOutput } from "../toolOutput.js";
import { EXPANDED_MAX_LINES } from "../displayLimits.js";
import { retainOutput, OUTPUT_RETAIN_MAX } from "../../hooks/useAgentController.js";

describe("formatToolOutput", () => {
  it("leads with run_command streams, not the envelope", () => {
    const lines = formatToolOutput({
      command: "echo hi",
      exitCode: 0,
      stdout: "hi\n",
      stderr: "",
    });
    expect(lines[0]).toBe("hi");
    expect(lines.join("\n")).toContain("exit 0");
    expect(lines.join("\n")).not.toContain("echo hi");
  });

  it("labels stderr and notes caps", () => {
    const lines = formatToolOutput({
      exitCode: 1,
      stdout: "",
      stderr: "boom",
      stdoutTruncated: true,
      timedOut: false,
    });
    expect(lines).toContain("stderr: boom");
    expect(lines.join("\n")).toContain("stream capped");
  });

  it("pretty-prints other objects and handles empty output", () => {
    expect(formatToolOutput({ path: "a.txt", content: "x" })).toContain(`  "path": "a.txt",`);
    expect(formatToolOutput(undefined)).toEqual(["(no output)"]);
    expect(formatToolOutput({ stdout: "", stderr: "" })).toEqual(["(empty output)"]);
  });

  it("caps long output with an omission notice", () => {
    const big = Array.from({ length: EXPANDED_MAX_LINES + 5 }, (_, i) => `line ${i}`).join("\n");
    const lines = formatToolOutput({ stdout: big, stderr: "" });
    expect(lines.length).toBe(EXPANDED_MAX_LINES + 1);
    expect(lines[lines.length - 1]).toContain("5 more line(s) omitted");
  });
});

describe("retainOutput", () => {
  it("keeps small outputs equal and truncates large ones with markers", () => {
    const small = { a: 1 };
    expect(retainOutput(small)).toEqual(small);
    // Single huge string: capped in place with an inner marker.
    const big = { blob: "x".repeat(OUTPUT_RETAIN_MAX + 100) };
    const kept = retainOutput(big) as { blob: string };
    expect(kept.blob).toContain("…[truncated]");
    expect(kept.blob.length).toBeLessThanOrEqual(2000 + 50);
    // Many medium strings: top-level truncation with a note.
    const wide: Record<string, string> = {};
    for (let i = 0; i < 5; i++) wide[`k${i}`] = "y".repeat(1500);
    const keptWide = retainOutput(wide) as { truncated: string; note: string };
    expect(keptWide.note).toContain("truncated");
    expect(keptWide.truncated.length).toBeLessThanOrEqual(OUTPUT_RETAIN_MAX);
  });
});
