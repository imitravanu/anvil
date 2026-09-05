import { describe, expect, it } from "vitest";
import { ColorizedDiff } from "../../diff/colorizeDiff.js";
import { Header } from "../Header.js";
import { PlanLine } from "../PlanLine.js";
import { StatusBar } from "../StatusBar.js";
import { MessageView } from "../MessageView.js";
import type { DisplayMessage } from "../../hooks/useAgentController.js";
import { frameText, renderThemed } from "../../test-utils/testRender.js";

const DIFF = [
  "--- a/app.ts",
  "+++ b/app.ts",
  "@@ -3,4 +3,4 @@",
  " context",
  "-const oldName = 1;",
  "+const newName = 1;",
].join("\n");

describe("ColorizedDiff", () => {
  it("renders gutters, signs, headers, and hunk context", () => {
    const { lastFrame, unmount } = renderThemed(<ColorizedDiff diff={DIFF} />);
    const out = frameText(lastFrame);
    expect(out).toContain("--- a/app.ts");
    expect(out).toContain("@@ -3,4 +3,4 @@");
    expect(out).toContain("oldName");
    expect(out).toContain("newName");
    // gutter line numbers for the changed lines
    expect(out).toMatch(/4/);
    unmount();
  });

  it("caps long diffs with an omission notice", () => {
    const big = `@@ -1,60 +1,60 @@\n${Array.from({ length: 60 }, (_, i) => ` ctx ${i}`).join("\n")}`;
    const { lastFrame, unmount } = renderThemed(<ColorizedDiff diff={big} />);
    expect(frameText(lastFrame)).toContain("omitted");
    unmount();
  });
});

describe("Header", () => {
  it("shows brand, provider/model labels, and busy state", () => {
    const idle = renderThemed(<Header model="gemini-3.6-flash" isBusy={false} />);
    const idleOut = frameText(idle.lastFrame);
    expect(idleOut).toContain("▲ ANVIL");
    expect(idleOut).toContain("idle");
    expect(idleOut).not.toContain("gemini-3.6-flash"); // displayName, never raw id
    idle.unmount();
    const busy = renderThemed(<Header model="gemini-3.6-flash" isBusy />);
    expect(frameText(busy.lastFrame)).toContain("busy");
    busy.unmount();
  });
});

describe("PlanLine", () => {
  it("renders the plan label and hides overflow with a count", () => {
    const plan = ["one", "two", "three", "four"].join("\n");
    const { lastFrame, unmount } = renderThemed(<PlanLine plan={plan} />);
    const out = frameText(lastFrame);
    expect(out).toContain("plan ▸");
    expect(out).toContain("one");
    expect(out).toContain("+2 more lines");
    unmount();
  });

  it("renders nothing for a blank plan", () => {
    const { lastFrame, unmount } = renderThemed(<PlanLine plan={"  \n "} />);
    expect(frameText(lastFrame).trim()).toBe("");
    unmount();
  });
});

describe("StatusBar", () => {
  it("shows model, state, and token totals", () => {
    const { lastFrame, unmount } = renderThemed(
      <StatusBar model="gemini-3.6-flash" isBusy={false} usage={{ inputTokens: 1500, outputTokens: 40 }} />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("○ idle");
    expect(out).toContain("1,500 in");
    expect(out).toContain("40 out");
    unmount();
  });
});

function assistant(over: Partial<DisplayMessage> = {}): DisplayMessage {
  return {
    id: "m1",
    role: "assistant",
    text: "done **bold**",
    streaming: false,
    toolCalls: [],
    subAgents: [],
    ...over,
  };
}

describe("MessageView", () => {
  it("renders markdown text plus tool and sub-agent cards", () => {
    const { lastFrame, unmount } = renderThemed(
      <MessageView
        message={assistant({
          toolCalls: [{ id: "c1", name: "read_file", input: {}, status: "done", summary: "ok" }],
          subAgents: [
            { task: "research", status: "done", toolCalls: 1, inputTokens: 10, outputTokens: 5, report: "r" },
          ],
        })}
        expandTools
      />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("bold");
    expect(out).toContain("read_file");
    expect(out).toContain("◈ sub-agent: research");
    unmount();
  });

  it("renders user and system roles distinctly", () => {
    const user = renderThemed(
      <MessageView message={{ id: "u", role: "user", text: "hi", streaming: false, toolCalls: [], subAgents: [] }} />
    );
    expect(frameText(user.lastFrame)).toContain("❯ you");
    user.unmount();
    const sys = renderThemed(
      <MessageView message={{ id: "s", role: "system", text: "note", streaming: false, toolCalls: [], subAgents: [] }} />
    );
    expect(frameText(sys.lastFrame)).toContain("note");
    sys.unmount();
  });
});
