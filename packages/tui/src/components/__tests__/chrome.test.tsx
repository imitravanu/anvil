import { describe, expect, it } from "vitest";
import { ColorizedDiff } from "../../diff/colorizeDiff.js";
import { Header } from "../Header.js";
import { MissionDeck } from "../MissionDeck.js";
import { VerificationCard } from "../VerificationCard.js";
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

  it("renders multi-segment situational cockpit header when context is present", () => {
    const context = {
      projectRoot: "/tmp/anvil",
      projectName: "anvil-core",
      git: { branch: "feature-branch", clean: false, modifiedFiles: ["file.ts"] },
      ecosystem: { type: "node" as const, packageManager: "pnpm", testScript: "vitest run" },
      topLevelEntries: ["src", "package.json"],
      summary: "test summary",
    };
    const { lastFrame, unmount } = renderThemed(
      <Header model="gemini-3.6-flash" isBusy={false} context={context} />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("▲ ANVIL");
    expect(out).toContain("repo: anvil-core");
    expect(out).toContain("node");
    expect(out).toContain("(pnpm)");
    unmount();
  });
});

describe("MissionDeck plan fallback", () => {
  it("renders the plan label and hides overflow with a count", () => {
    const plan = ["one", "two", "three", "four"].join("\n");
    const { lastFrame, unmount } = renderThemed(<MissionDeck plan={plan} />);
    const out = frameText(lastFrame);
    expect(out).toContain("plan ▸");
    expect(out).toContain("one");
    expect(out).toContain("+2 more lines");
    unmount();
  });

  it("renders nothing for a blank plan", () => {
    const { lastFrame, unmount } = renderThemed(<MissionDeck plan={"  \n "} />);
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

  it("displays checkpoint count and test health status when available", () => {
    const { lastFrame, unmount } = renderThemed(
      <StatusBar
        model="gemini-3.6-flash"
        isBusy={false}
        usage={{ inputTokens: 100, outputTokens: 50 }}
        checkpointCount={3}
        testStatus="green"
      />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("⎌ 3");
    expect(out).toContain("🧪 green");
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

  it("renders closed-loop TDD verification card and self-repair attempts", () => {
    const { lastFrame, unmount } = renderThemed(
      <MessageView
        message={assistant({
          verifications: [
            {
              id: "v1",
              command: "npm test",
              status: "passed",
              summary: "374 passed",
              repairsUsed: 1,
            },
          ],
        })}
      />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("Test Suite Verified Green");
    expect(out).toContain("cmd: npm test");
    expect(out).toContain("Auto-Repair Attempt 1/2");
    unmount();
  });
});

describe("MissionDeck Component", () => {
  it("renders active mission with milestone progression and turn counter", () => {
    const goal = {
      title: "Build Auth Engine",
      milestones: [
        { id: "1", title: "Explore Auth Files", criteria: "Done", status: "completed" as const },
        { id: "2", title: "Write Middleware", criteria: "In progress", status: "in_progress" as const, detail: "editing jwt.ts" },
        { id: "3", title: "Test Verification", criteria: "Pending", status: "pending" as const },
      ],
      currentTurn: 2,
      maxTurns: 10,
    };
    const { lastFrame, unmount } = renderThemed(<MissionDeck goal={goal} isBusy={true} />);
    const out = frameText(lastFrame);
    expect(out).toContain("MISSION: Build Auth Engine");
    expect(out).toContain("[1/3] · Turn 2/10");
    expect(out).toContain("1. Explore Auth Files");
    expect(out).toContain("2. Write Middleware");
    expect(out).toContain("3. Test Verification");
    expect(out).toContain("(editing jwt.ts)");
    unmount();
  });
});
