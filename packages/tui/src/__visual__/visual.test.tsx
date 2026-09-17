import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import React from "react";
import { render as inkRender } from "ink";
import type { CheckpointMeta, SituationalContext } from "@anvil/core";
import { AgentSession } from "@anvil/core";
import { Header } from "../components/Header.js";
import { MessageList } from "../components/MessageList.js";
import { MessageView } from "../components/MessageView.js";
import { MissionDeck } from "../components/MissionDeck.js";
import { PermissionPrompt } from "../components/PermissionPrompt.js";
import { RewindModal } from "../components/RewindModal.js";
import { StatusBar } from "../components/StatusBar.js";
import { THEMES, ThemeContext } from "../theme/theme.js";
import type { DisplayMessage } from "../hooks/useAgentController.js";

// ---------------------------------------------------------------------------
// Phase 0.1 visual regression — TEXT-FRAME capture (spec:
// docs/PHASE-0-VISUAL-REGRESSION-SPEC.md, amended: text diff instead of PNG).
//
// Ink's Yoga layout is fully deterministic headlessly, so the ANSI-stripped
// frame IS the render. Text baselines (~2 KB) catch every layout regression
// the 0.6.x fixes addressed — line stacking, header collapse, mid-name
// truncation, wrapping — review inline in PR diffs, and need no PTY,
// puppeteer, or native deps. Pixel-level color diff remains a later phase.
//
// Regenerate baselines: VISUAL_UPDATE=1 npm run visual   (in packages/tui)
// ---------------------------------------------------------------------------

const BASELINE_DIR = fileURLToPath(new URL("../../__visual-baselines__/", import.meta.url));
const DEFAULT_COLUMNS = 100;
const DEFAULT_ROWS = 30;

/**
 * Parameterized fake stdout — the same shape ink-testing-library hardcodes
 * (non-TTY → chalk emits no ANSI; debug → every frame lands in write), but
 * with explicit columns/rows so width-sensitive scenarios are captured.
 */
function renderFrame(ui: React.ReactElement, columns: number, rows: number): string {
  const stdout = new EventEmitter() as unknown as Record<string, unknown> & EventEmitter;
  let last: string | undefined;
  Object.defineProperties(stdout, {
    columns: { get: () => columns },
    rows: { get: () => rows },
    write: {
      value: (frame: string) => {
        last = frame;
      },
    },
  });
  const instance = inkRender(
    <ThemeContext.Provider value={THEMES.dark}>{ui}</ThemeContext.Provider>,
    { stdout: stdout as never, debug: true, exitOnCtrlC: false, patchConsole: false }
  );
  const frame = last ?? "";
  instance.unmount();
  instance.cleanup?.();
  // Trailing whitespace is layout noise; ANSI is stripped (non-TTY chalk).
  return frame.replace(/\u001b\[[0-9;]*m/g, "").replace(/[ \t]+$/gm, "");
}

/** Baseline compare-or-update. Missing baselines are created (first run). */
function expectVisual(frame: string, name: string): void {
  const file = path.join(BASELINE_DIR, `${name}.txt`);
  const exists = fs.existsSync(file);
  if (process.env.VISUAL_UPDATE === "1" || !exists) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(file, frame);
    // eslint-disable-next-line no-console
    console.log(`[visual] baseline ${exists ? "updated" : "created"}: ${name}`);
    return;
  }
  const expected = fs.readFileSync(file, "utf8");
  expect(frame).toBe(expected);
}

// --- Fixtures (deterministic — no Date.now(), no timers, no network) ---

const MARKDOWN = `Here's what I found in \`src/index.ts\`:

## Summary
The module exports **three** functions:

1. \`boot()\` — starts the server
2. \`shutdown()\` — stops it gracefully
3. \`reload()\` — hot reloads config

\`\`\`ts
export function boot(port: number): Server {
  return createServer({ port, tls: true });
}
\`\`\`

> Note: \`reload()\` requires the config watcher to be enabled.

| Function | Async | Safe |
|---|---|---|
| boot | no | yes |
| shutdown | yes | yes |

Next I'll check the tests.`;

let fixtureSeq = 0;
function msg(over: Partial<DisplayMessage> & { role: DisplayMessage["role"]; text: string }): DisplayMessage {
  return {
    id: `fixture-${++fixtureSeq}`,
    streaming: false,
    toolCalls: [],
    subAgents: [],
    verifications: [],
    ...over,
  };
}

const CHAT_MESSAGES: DisplayMessage[] = [
  msg({ role: "user", text: "what does the module export?" }),
  msg({ role: "assistant", text: MARKDOWN }),
  msg({ role: "user", text: "check the files" }),
  msg({
    role: "assistant",
    text: "Let me look around first.",
    toolCalls: [
      { id: "t1", name: "list_files", input: { path: "." }, status: "done", summary: "Listed 10 files under ." },
      { id: "t2", name: "grep", input: { pattern: "boot", path: "src" }, status: "done", summary: 'grep "boot": 12 matches' },
    ],
  }),
  msg({ role: "system", text: "Checkpoint #1: 1 file snapshotted — /rewind 1 to undo." }),
];

const CONTEXT: SituationalContext = {
  projectRoot: "/tmp/anvil",
  projectName: "anvil-core",
  git: { branch: "feature-branch", clean: false, modifiedFiles: ["file.ts"] },
  ecosystem: { type: "node", packageManager: "pnpm", testScript: "vitest run" },
  topLevelEntries: ["src", "package.json"],
  summary: "test summary",
};

const DIFF = [
  "--- a/app.ts",
  "+++ b/app.ts",
  "@@ -3,4 +3,4 @@",
  " context",
  "-const oldName = 1;",
  "+const newName = 1;",
].join("\n");

const CHECKPOINTS: CheckpointMeta[] = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  ts: "2026-09-08T12:34:56.000Z",
  files: i + 1,
  skipped: 0,
}));

// Locale/TZ-independent: the rewind modal renders toLocaleTimeString, which
// varies by environment — normalize it so the baseline is portable.
const normalizeTimes = (frame: string): string => frame.replace(/\d{1,2}:\d{2}:\d{2}\s*(?:[APap][Mm])?/g, "HH:MM:SS PM");

// --- Scenarios ---

describe("visual regression — TUI frames", () => {
  it("empty state", () => {
    expectVisual(renderFrame(<MessageList messages={[]} model="qwen2.5-coder:latest" />, DEFAULT_COLUMNS, DEFAULT_ROWS), "empty-state");
  });

  it("chat exchange — markdown, tool cards, checkpoint", () => {
    expectVisual(
      renderFrame(<MessageList messages={CHAT_MESSAGES} model="qwen2.5-coder:latest" />, DEFAULT_COLUMNS, DEFAULT_ROWS),
      "chat-exchange"
    );
  });

  it("permission prompt with unified diff", () => {
    expectVisual(
      renderFrame(
        <PermissionPrompt
          request={{ toolName: "edit_file", summary: DIFF, resolve: () => undefined }}
          broker={{ approveAlwaysForSession: () => undefined }}
        />,
        DEFAULT_COLUMNS,
        DEFAULT_ROWS
      ),
      "permission-diff"
    );
  });

  it("mission deck — active goal with mixed milestones", () => {
    expectVisual(
      renderFrame(
        <MissionDeck
          goal={{
            title: "Build Auth Engine",
            milestones: [
              { id: "1", title: "Explore Auth Files", criteria: "Done", status: "completed" },
              { id: "2", title: "Write Middleware", criteria: "In progress", status: "in_progress", detail: "editing jwt.ts" },
              { id: "3", title: "Test Verification", criteria: "Pending", status: "pending" },
            ],
            currentTurn: 2,
            maxTurns: 10,
          }}
          isBusy={false}
        />,
        DEFAULT_COLUMNS,
        DEFAULT_ROWS
      ),
      "mission-deck-active"
    );
  });

  it("mission deck — collapsed plan fallback", () => {
    expectVisual(
      renderFrame(<MissionDeck plan={["one", "two", "three", "four"].join("\n")} />, DEFAULT_COLUMNS, DEFAULT_ROWS),
      "mission-deck-plan"
    );
  });

  it("cockpit header at 100 columns — full model tag", () => {
    expectVisual(renderFrame(<Header model="gemini-3.6-flash" isBusy={false} context={CONTEXT} />, 100, 30), "header-cockpit-100");
  });

  it("cockpit header at 130 columns — tests segment visible", () => {
    expectVisual(renderFrame(<Header model="gemini-3.6-flash" isBusy={true} context={CONTEXT} />, 130, 30), "header-cockpit-130");
  });

  it("compact header at 60 columns", () => {
    expectVisual(renderFrame(<Header model="gemini-3.6-flash" isBusy={false} />, 60, 24), "header-compact-60");
  });

  it("status bar — gauge, checkpoints, test state", () => {
    expectVisual(
      renderFrame(
        <StatusBar
          model="qwen2.5-coder:latest"
          isBusy={false}
          usage={{ inputTokens: 1842, outputTokens: 96 }}
          checkpointCount={3}
          testStatus="green"
        />,
        DEFAULT_COLUMNS,
        DEFAULT_ROWS
      ),
      "status-bar"
    );
  });

  it("assistant turn — verification card + sub-agent card", () => {
    expectVisual(
      renderFrame(
        <MessageView
          message={msg({
            role: "assistant",
            text: "All checks pass.",
            verifications: [{ id: "v1", command: "npm test", status: "passed", summary: "374 passed", repairsUsed: 1 }],
            toolCalls: [{ id: "t1", name: "verify_tests", input: {}, status: "done", summary: "All tests passed: npm test" }],
            subAgents: [{ task: "research", status: "done", toolCalls: 1, inputTokens: 10, outputTokens: 5, report: "report body" }],
          })}
        />,
        DEFAULT_COLUMNS,
        DEFAULT_ROWS
      ),
      "verification-card"
    );
  });

  it("rewind modal — 5 checkpoints (times normalized)", () => {
    const stub = { getCheckpoints: () => CHECKPOINTS } as unknown as AgentSession;
    expectVisual(
      normalizeTimes(renderFrame(<RewindModal session={stub} onSelect={() => undefined} onClose={() => undefined} />, DEFAULT_COLUMNS, DEFAULT_ROWS)),
      "rewind-modal"
    );
  });
});
