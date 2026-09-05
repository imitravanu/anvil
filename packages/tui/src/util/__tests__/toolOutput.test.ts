import { describe, expect, it } from "vitest";
import { formatToolOutput, MAX_OUTPUT_LINES } from "../toolOutput.js";
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
    const big = Array.from({ length: MAX_OUTPUT_LINES + 5 }, (_, i) => `line ${i}`).join("\n");
    const lines = formatToolOutput({ stdout: big, stderr: "" });
    expect(lines.length).toBe(MAX_OUTPUT_LINES + 1);
    expect(lines[lines.length - 1]).toContain("5 more line(s) omitted");
  });
});

describe("retainOutput", () => {
  it("keeps small outputs intact and truncates large ones with a marker", () => {
    const small = { a: 1 };
    expect(retainOutput(small)).toBe(small);
    const big = { blob: "x".repeat(OUTPUT_RETAIN_MAX + 100) };
    const kept = retainOutput(big) as { truncated: string; note: string };
    expect(kept.note).toContain("truncated");
    expect(kept.truncated.length).toBeLessThanOrEqual(OUTPUT_RETAIN_MAX);
  });
});
