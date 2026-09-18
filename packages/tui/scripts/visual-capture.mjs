#!/usr/bin/env node
/**
 * Visual regression frame capture engine (Phase 0 spec: docs/PHASE-0-VISUAL-REGRESSION-SPEC.md)
 * Renders scenarios across the full matrix (3 sizes x 2 themes) and rasterizes
 * deterministic PNG frames using puppeteer-core.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import React from "react";
import { render } from "ink";
import puppeteer from "puppeteer-core";

import { Header } from "../dist/components/Header.js";
import { MessageList } from "../dist/components/MessageList.js";
import { MessageView } from "../dist/components/MessageView.js";
import { MissionDeck } from "../dist/components/MissionDeck.js";
import { PermissionPrompt } from "../dist/components/PermissionPrompt.js";
import { RewindModal } from "../dist/components/RewindModal.js";
import { StatusBar } from "../dist/components/StatusBar.js";
import { THEMES, ThemeContext } from "../dist/theme/theme.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_TUI = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT_TUI, "__visual-current__");
const BASELINE_OUT = path.join(ROOT_TUI, "__visual-baselines__");

const FONT_FILE = path.join(__dirname, "LiberationMono-Regular.ttf");
const SYSTEM_FONT = "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf";
const resolvedFont = fs.existsSync(FONT_FILE) ? FONT_FILE : (fs.existsSync(SYSTEM_FONT) ? SYSTEM_FONT : null);
const FONT_BASE64 = resolvedFont ? fs.readFileSync(resolvedFont).toString("base64") : "";

const outDir = process.argv.includes("--approve")
  ? BASELINE_OUT
  : (process.env.VISUAL_OUT || DEFAULT_OUT);

// --- Matrix Definitions ---

const SIZES = [
  { name: "40x20", cols: 40, rows: 20 },
  { name: "80x24", cols: 80, rows: 24 },
  { name: "100x30", cols: 100, rows: 30 },
  { name: "120x40", cols: 120, rows: 40 },
  { name: "160x50", cols: 160, rows: 50 },
  { name: "200x60", cols: 200, rows: 60 },
];

const THEME_LIST = [
  { name: "dark", theme: THEMES.dark, bg: "#0d1117", fg: "#c9d1d9" },
  { name: "highContrast", theme: THEMES.highContrast, bg: "#000000", fg: "#ffffff" },
];

// --- Deterministic Fixtures ---

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

const CHAT_MESSAGES = [
  { id: "fix-1", role: "user", text: "what does the module export?", streaming: false, toolCalls: [], subAgents: [], verifications: [] },
  { id: "fix-2", role: "assistant", text: MARKDOWN, streaming: false, toolCalls: [], subAgents: [], verifications: [] },
  { id: "fix-3", role: "user", text: "check the files", streaming: false, toolCalls: [], subAgents: [], verifications: [] },
  {
    id: "fix-4",
    role: "assistant",
    text: "Let me look around first.",
    streaming: false,
    toolCalls: [
      { id: "t1", name: "list_files", input: { path: "." }, status: "done", summary: "Listed 10 files under ." },
      { id: "t2", name: "grep", input: { pattern: "boot", path: "src" }, status: "done", summary: 'grep "boot": 12 matches' },
    ],
    subAgents: [],
    verifications: [],
  },
  { id: "fix-5", role: "system", text: "Checkpoint #1: 1 file snapshotted — /rewind 1 to undo.", streaming: false, toolCalls: [], subAgents: [], verifications: [] },
];

const CONTEXT = {
  projectRoot: "/tmp/anvil",
  projectName: "anvil-core",
  git: { branch: "master", clean: false, modifiedFiles: ["file.ts"] },
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

const CHECKPOINTS = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  ts: "2026-09-08T12:34:56.000Z",
  files: i + 1,
  skipped: 0,
}));

const STUB_SESSION = {
  getCheckpoints: () => CHECKPOINTS,
};

const normalizeTimes = (frame) => frame.replace(/\d{1,2}:\d{2}:\d{2}/g, "HH:MM:SS");

// --- Scenarios Factory ---

function getScenarios(cols, rows) {
  return [
    {
      name: "01-empty-state",
      render: () => React.createElement(MessageList, { messages: [], model: "qwen2.5-coder:latest" }),
    },
    {
      name: "02-chat-exchange",
      render: () => React.createElement(MessageList, { messages: CHAT_MESSAGES, model: "qwen2.5-coder:latest" }),
    },
    {
      name: "03-markdown-rendering",
      render: () => React.createElement(MessageView, {
        message: {
          id: "md-1",
          role: "assistant",
          text: MARKDOWN,
          streaming: false,
          toolCalls: [],
          subAgents: [],
          verifications: [],
        },
      }),
    },
    {
      name: "04-permission-prompt",
      render: () => React.createElement(PermissionPrompt, {
        request: { toolName: "edit_file", summary: DIFF, resolve: () => undefined },
        broker: { approveAlwaysForSession: () => undefined },
      }),
    },
    {
      name: "05-mission-deck",
      render: () => React.createElement(MissionDeck, {
        goal: {
          title: "Build Auth Engine",
          milestones: [
            { id: "1", title: "Explore Auth Files", criteria: "Done", status: "completed" },
            { id: "2", title: "Write Middleware", criteria: "In progress", status: "in_progress", detail: "editing jwt.ts" },
            { id: "3", title: "Test Verification", criteria: "Pending", status: "pending" },
          ],
          currentTurn: 2,
          maxTurns: 10,
        },
        isBusy: false,
      }),
    },
    {
      name: "06-header-collapse",
      render: () => React.createElement(Header, {
        model: "gemini-3.6-flash",
        isBusy: true,
        context: CONTEXT,
      }),
    },
    {
      name: "07-verification-card",
      render: () => React.createElement(MessageView, {
        message: {
          id: "v-1",
          role: "assistant",
          text: "All checks pass.",
          streaming: false,
          verifications: [{ id: "v1", command: "npm test", status: "passed", summary: "437 passed", repairsUsed: 1 }],
          toolCalls: [{ id: "t1", name: "verify_tests", input: {}, status: "done", summary: "All tests passed: npm test" }],
          subAgents: [{ task: "research", status: "done", toolCalls: 1, inputTokens: 10, outputTokens: 5, report: "report body" }],
        },
      }),
    },
    {
      name: "08-rewind-modal",
      render: () => React.createElement(RewindModal, {
        session: STUB_SESSION,
        onSelect: () => undefined,
        onClose: () => undefined,
      }),
      postProcess: normalizeTimes,
    },
  ];
}

function renderInkFrame(element, cols, rows, theme) {
  const stdout = new EventEmitter();
  stdout.columns = cols;
  stdout.rows = rows;
  let last = "";
  stdout.write = (chunk) => {
    last = chunk;
  };
  const origTime = Date.prototype.toLocaleTimeString;
  Date.prototype.toLocaleTimeString = () => "12:34:56 PM";
  let app;
  try {
    app = render(
      React.createElement(ThemeContext.Provider, { value: theme }, element),
      { stdout, debug: true, exitOnCtrlC: false, patchConsole: false }
    );
  } finally {
    Date.prototype.toLocaleTimeString = origTime;
  }
  const raw = last || "";
  app.unmount();
  app.cleanup?.();
  return raw.replace(/\u001b\[[0-9;]*m/g, "").replace(/[ \t]+$/gm, "");
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("No Chrome/Chromium binary found. Please set CHROME_PATH.");
}

async function main() {
  console.log(`[visual:capture] Output directory: ${outDir}`);
  const chromePath = findChrome();
  console.log(`[visual:capture] Launching headless browser (${chromePath})...`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--headless=new",
      "--font-render-hinting=none",
      "--hide-scrollbars",
    ],
  });

  const page = await browser.newPage();
  let totalCaptured = 0;

  try {
    for (const size of SIZES) {
      for (const th of THEME_LIST) {
        const targetDir = path.join(outDir, `${th.name}-${size.name}`);
        fs.mkdirSync(targetDir, { recursive: true });

        const scenarios = getScenarios(size.cols, size.rows);
        for (const sc of scenarios) {
          let text = renderInkFrame(sc.render(), size.cols, size.rows, th.theme);
          if (sc.postProcess) {
            text = sc.postProcess(text);
          }

          const viewportWidth = Math.max(680, Math.round(size.cols * 8.5 + 32));
          const viewportHeight = Math.max(360, Math.round(size.rows * 18 + 32));
          await page.setViewport({ width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1 });

          const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  ${FONT_BASE64 ? `@font-face {
    font-family: 'AnvilMono';
    src: url(data:font/truetype;charset=utf-8;base64,${FONT_BASE64}) format('truetype');
  }` : ""}
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    background: ${th.bg};
    color: ${th.fg};
    font-family: ${FONT_BASE64 ? "'AnvilMono', " : ""}'Liberation Mono', monospace;
    font-size: 13px;
    line-height: 18px;
    letter-spacing: 0px;
    white-space: pre;
  }
</style>
</head>
<body>${escapeHtml(text)}</body>
</html>`;

          await page.setContent(html);
          await page.evaluateHandle("document.fonts.ready");
          const buf = await page.screenshot({
            type: "png",
            clip: { x: 0, y: 0, width: viewportWidth, height: viewportHeight },
          });

          const outFile = path.join(targetDir, `${sc.name}.png`);
          fs.writeFileSync(outFile, buf);
          totalCaptured++;
        }
        console.log(`[visual:capture] Captured ${scenarios.length} frames for ${th.name}-${size.name}`);
      }
    }
    console.log(`[visual:capture] Successfully captured ${totalCaptured} frames total.`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[visual:capture] Error:", err);
  process.exit(1);
});
