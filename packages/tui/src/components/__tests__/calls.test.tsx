import { describe, expect, it } from "vitest";
import { ToolCallView } from "../ToolCallView.js";
import { SubAgentView } from "../SubAgentView.js";
import type { DisplayToolCall, DisplaySubAgent } from "../../hooks/useAgentController.js";
import { frameText, renderThemed } from "../../test-utils/testRender.js";

const doneCall: DisplayToolCall = {
  id: "c1",
  name: "read_file",
  input: { path: "a.txt" },
  status: "done",
  summary: "a.txt (12 bytes)",
  output: { path: "a.txt", content: "hello" },
};

describe("ToolCallView", () => {
  it("shows status symbol, name, and one-line summary", () => {
    const { lastFrame, unmount } = renderThemed(<ToolCallView call={doneCall} />);
    const out = frameText(lastFrame);
    expect(out).toContain("✓");
    expect(out).toContain("read_file");
    expect(out).toContain("a.txt (12 bytes)");
    unmount();
  });

  it("renders no raw control characters from the JSON-input fallback", () => {
    // A call with no summary renders JSON.stringify(input). Model-authored input
    // can carry \r and ANSI escapes (a bash command, a grep pattern), so this
    // pins the property that keeps the frame sane: json does the escaping, NOT
    // sanitizeTerminalText — the fallback has no sanitize call and does not need
    // one. Replacing JSON.stringify with a manual join would break this.
    const noSummary: DisplayToolCall = {
      id: "c2",
      name: "run_command",
      input: { command: "echo \u001b[31mred\u001b[0m\rprogress" },
      status: "done",
      summary: "",
    };
    const { lastFrame, unmount } = renderThemed(<ToolCallView call={noSummary} />);
    const raw = lastFrame() ?? "";
    expect(raw).not.toContain("\u001b[31m");
    expect(raw).not.toContain("\r");
    expect(frameText(lastFrame)).toContain("echo");
    unmount();
  });

  it("stays collapsed by default; expands full output on demand", () => {
    const collapsed = renderThemed(<ToolCallView call={doneCall} />);
    expect(frameText(collapsed.lastFrame)).not.toContain("hello");
    collapsed.unmount();
    const expanded = renderThemed(<ToolCallView call={doneCall} expanded />);
    expect(frameText(expanded.lastFrame)).toContain("hello");
    expanded.unmount();
  });

  it("never expands a running call", () => {
    const { lastFrame, unmount } = renderThemed(
      <ToolCallView call={{ ...doneCall, status: "running", output: { x: 1 } }} expanded />
    );
    expect(frameText(lastFrame)).not.toContain('"x"');
    unmount();
  });

  it("marks errors distinctly", () => {
    const { lastFrame, unmount } = renderThemed(
      <ToolCallView call={{ ...doneCall, status: "error", summary: "Denied" }} />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("✗");
    expect(out).toContain("Denied");
    unmount();
  });

  it("renders cancelled calls distinctly from errors", () => {
    const { lastFrame, unmount } = renderThemed(
      <ToolCallView call={{ ...doneCall, status: "cancelled", summary: "Cancelled" }} />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("○");
    expect(out).toContain("Cancelled");
    unmount();
  });
});

const doneSub: DisplaySubAgent = {
  task: "find the registry",
  status: "done",
  toolCalls: 2,
  inputTokens: 1200,
  outputTokens: 300,
  report: "Found it: providers/registry.ts",
};

describe("SubAgentView", () => {
  it("collapses to one line with counts", () => {
    const { lastFrame, unmount } = renderThemed(<SubAgentView sub={doneSub} />);
    expect(frameText(lastFrame)).toContain("◈ sub-agent: find the registry — 2 calls, 1,200 in/300 out");
    unmount();
  });

  it("shows running state and hides the report until expanded", () => {
    const running = renderThemed(
      <SubAgentView sub={{ ...doneSub, status: "running", report: "" }} expanded />
    );
    const out = frameText(running.lastFrame);
    expect(out).toContain("running…");
    expect(out).not.toContain("Found it");
    running.unmount();
  });

  it("expands the finished report", () => {
    const { lastFrame, unmount } = renderThemed(<SubAgentView sub={doneSub} expanded />);
    expect(frameText(lastFrame)).toContain("Found it: providers/registry.ts");
    unmount();
  });
});
