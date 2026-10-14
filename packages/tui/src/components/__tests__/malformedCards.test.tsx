import { describe, expect, it } from "vitest";
import { renderThemed, tick } from "../../test-utils/testRender.js";
import { GuardianReportCard } from "../GuardianReportCard.js";
import { ToolCallView } from "../ToolCallView.js";
import type { DisplayGuardianReport, DisplayToolCall } from "../../hooks/eventReducer.js";
import { TranscriptBoundary } from "../TranscriptBoundary.js";

// 2026-10-14 fuzz: these shapes made the card or view throw during render, and
// the transcript boundary then replaced the whole transcript with an error.
// A malformed piece of data must degrade that one row, never the transcript.
const FAILURE = "could not be rendered";

describe("malformed card data degrades instead of throwing (2026-10-14)", () => {
  it("GuardianReportCard renders a violation whose file is missing", async () => {
    const report = {
      blocked: 1,
      fixed: 0,
      violations: [null, { file: "a.ts", line: 3, rule: "r", family: "rule", detail: "d" }],
    } as unknown as DisplayGuardianReport;
    const r = renderThemed(
      <TranscriptBoundary>
        <GuardianReportCard report={report} />
      </TranscriptBoundary>
    );
    await tick();
    const frame = r.lastFrame() ?? "";
    r.unmount();
    expect(frame).not.toContain(FAILURE);
    expect(frame).toContain("a.ts:3");
  });

  it("GuardianReportCard tolerates a non-array violations field", async () => {
    const report = { blocked: 2, fixed: 0, violations: null } as unknown as DisplayGuardianReport;
    const r = renderThemed(
      <TranscriptBoundary>
        <GuardianReportCard report={report} />
      </TranscriptBoundary>
    );
    await tick();
    const frame = r.lastFrame() ?? "";
    r.unmount();
    expect(frame).not.toContain(FAILURE);
    expect(frame).toContain("2 blocked");
  });

  it("ToolCallView renders a call whose status is unknown and whose output is not an object", async () => {
    const call = { id: "a", name: "b", status: "weird", output: 7 } as unknown as DisplayToolCall;
    const r = renderThemed(
      <TranscriptBoundary>
        <ToolCallView call={call} />
      </TranscriptBoundary>
    );
    await tick();
    const frame = r.lastFrame() ?? "";
    r.unmount();
    expect(frame).not.toContain(FAILURE);
    expect(frame).toContain("b");
  });
});

describe("malformed violation FIELDS degrade one row (2026-10-14)", () => {
  it("renders a violation whose detail is missing without blanking the transcript", async () => {
    const report = {
      blocked: 1,
      fixed: 0,
      violations: [{ file: "a.ts", line: 3, rule: "r", family: "rule" }],
    } as unknown as DisplayGuardianReport;
    const r = renderThemed(
      <TranscriptBoundary>
        <GuardianReportCard report={report} />
      </TranscriptBoundary>
    );
    await tick();
    const frame = r.lastFrame() ?? "";
    r.unmount();
    expect(frame).not.toContain(FAILURE);
    expect(frame).toContain("a.ts:3");
  });

  it("coerces a wrong-typed field instead of throwing through the boundary", async () => {
    const report = {
      blocked: "many",
      fixed: 0,
      violations: [{ file: 42, line: "x", rule: "r", family: null, detail: { nested: true } }],
    } as unknown as DisplayGuardianReport;
    const r = renderThemed(
      <TranscriptBoundary>
        <GuardianReportCard report={report} />
      </TranscriptBoundary>
    );
    await tick();
    const frame = r.lastFrame() ?? "";
    r.unmount();
    expect(frame).not.toContain(FAILURE);
    expect(frame).toContain("(unknown file)");
    expect(frame).toContain("(no detail)");
  });
});
