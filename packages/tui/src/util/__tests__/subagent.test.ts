import { describe, expect, it } from "vitest";
import {
  SUB_REPORT_RETAIN_MAX,
  capReportLines,
  formatSubAgentLine,
  retainReport,
} from "../subagent.js";

describe("formatSubAgentLine", () => {
  it("collapses running, done, and cancelled states", () => {
    expect(
      formatSubAgentLine({ task: "find x", status: "running", toolCalls: 0, inputTokens: 0, outputTokens: 0 })
    ).toBe("◈ sub-agent: find x — running…");
    expect(
      formatSubAgentLine({ task: "find x", status: "done", toolCalls: 2, inputTokens: 1200, outputTokens: 300 })
    ).toBe("◈ sub-agent: find x — 2 calls, 1,200 in/300 out");
    expect(
      formatSubAgentLine({ task: "find x", status: "cancelled", toolCalls: 1, inputTokens: 5, outputTokens: 5 })
    ).toBe("◈ sub-agent: find x — cancelled");
  });

  it("curtails long and multiline tasks", () => {
    const line = formatSubAgentLine({
      task: `${"t".repeat(100)}\nsecond line`,
      status: "done",
      toolCalls: 1,
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(line).toContain("…");
    expect(line).not.toContain("second line");
  });
});

describe("retainReport + capReportLines", () => {
  it("keeps small reports, marks truncated ones", () => {
    expect(retainReport("short")).toBe("short");
    const kept = retainReport("x".repeat(SUB_REPORT_RETAIN_MAX + 10));
    expect(kept).toContain("shortened for display");
    expect(kept.length).toBeLessThanOrEqual(SUB_REPORT_RETAIN_MAX + 100);
  });

  it("caps lines with an omission notice, handles empty", () => {
    expect(capReportLines("")).toEqual(["(empty report)"]);
    const lines = capReportLines(Array.from({ length: 35 }, (_, i) => `l${i}`).join("\n"));
    expect(lines).toHaveLength(31);
    expect(lines[30]).toContain("5 more line(s) omitted");
  });
});
