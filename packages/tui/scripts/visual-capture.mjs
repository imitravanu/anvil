#!/usr/bin/env node
/**
 * Visual regression frame capture engine (Phase 0 spec: docs/PHASE-0-VISUAL-REGRESSION-SPEC.md)
 * Renders scenarios across the full matrix (6 sizes x 3 themes) and rasterizes
 * deterministic PNG frames using puppeteer-core.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import os from "node:os";
import { spawnSync } from "node:child_process";
import React from "react";
import { render } from "ink";
import puppeteer from "puppeteer-core";
import AnsiToHtml from "ansi-to-html";
import { AgentSession } from "../../core/dist/index.js";
import { App } from "../dist/components/App.js";
import { FirstRunSetup } from "../dist/components/FirstRunSetup.js";
import { TuiPermissionBroker } from "../dist/permission/TuiPermissionBroker.js";

import { Header } from "../dist/components/Header.js";
import { MessageList } from "../dist/components/MessageList.js";
import { MessageView } from "../dist/components/MessageView.js";
import { MissionDeck } from "../dist/components/MissionDeck.js";
import { PermissionPrompt } from "../dist/components/PermissionPrompt.js";
import { RewindModal } from "../dist/components/RewindModal.js";
import { StatusBar } from "../dist/components/StatusBar.js";
import { THEMES, ThemeContext } from "../dist/theme/theme.js";
import { displayWidth } from "../dist/util/format.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_TUI = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT_TUI, "__visual-current__");
const BASELINE_OUT = path.join(ROOT_TUI, "__visual-baselines__");
const CAPTURE_SETTLE_MS = 40;
const CAPTURE_TURN_TIMEOUT_MS = 3000;
const CAPTURE_MATRIX_TIMEOUT_MS = 10 * 60 * 1000;
// Chalk caches support during module loading, before any script body executes.
if (process.env.FORCE_COLOR !== "3") {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    env: { ...process.env, FORCE_COLOR: "3" }, stdio: "inherit", timeout: CAPTURE_MATRIX_TIMEOUT_MS,
  });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}
process.env.ANVIL_NO_ANIM = "1";

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
  { name: "light", theme: THEMES.light, bg: "#ffffff", fg: "#24292f" },
  { name: "highContrast", theme: THEMES.highContrast, bg: "#000000", fg: "#ffffff" },
  // Phase 28.12: forge is the 6th built-in theme and the one whose "dim is
  // decoration-only" philosophy most needs a rendered baseline — the PNG
  // matrix is the only harness that captures colour, so it is the only place
  // forge's rendering can regress visibly. bg/fg are the theme's own
  // surface/textPrimary so the frame background matches the product.
  { name: "forge", theme: THEMES.forge, bg: "#2a2e33", fg: "#e4e6ea" },
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

// AUDIT-15: RewindModal renders local HH:MM via formatTime, so only the clock
// VALUE needs scrubbing (the format is already locale-stable).
const normalizeTimes = (frame) =>
  frame.replace(/\d{1,2}:\d{2}(?::\d{2})?\s*(?:[APap][Mm])?/g, "HH:MM");

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
          subAgents: [{ id: "delegate", task: "research", status: "done", toolCalls: 1, inputTokens: 10, outputTokens: 5, report: "report body" }],
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

async function renderInkFrame(element, cols, rows, theme, drive) {
  const stdout = new EventEmitter();
  stdout.columns = cols;
  stdout.rows = rows;
  let last = "";
  stdout.write = (chunk, encoding, callback) => {
    if (String(chunk).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").trim()) last = String(chunk);
    (typeof encoding === "function" ? encoding : callback)?.();
    return true;
  };
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdin.ref = () => stdin;
  stdin.unref = () => stdin;
  const app = render(
    React.createElement(ThemeContext.Provider, { value: theme }, element),
    { stdout, stdin, debug: true, interactive: true, exitOnCtrlC: false, patchConsole: false }
  );
  try {
    await app.waitUntilRenderFlush();
    await new Promise(resolve => setTimeout(resolve, CAPTURE_SETTLE_MS));
    await drive?.(stdin, () => last);
    await app.waitUntilRenderFlush();
    const raw = last.replace(/\u001b\[[0-9;?]*[A-LN-Za-ln-z]/g, "");
    if (!raw.replace(/\u001b\[[0-9;]*m/g, "").trim()) throw new Error("Blank visual capture");
    return raw.replace(/[ \t]+$/gm, "");
  } finally {
    app.unmount(); app.cleanup?.(); stdin.destroy();
  }
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
  const captureHome = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-ui-capture-"));
  process.env.ANVIL_HOME = captureHome;
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
      if (process.env.VISUAL_SIZE && size.name !== process.env.VISUAL_SIZE) continue;
      for (const th of THEME_LIST) {
        const targetDir = path.join(outDir, `${th.name}-${size.name}`);
        fs.mkdirSync(targetDir, { recursive: true });

        const scenarios = [...getScenarios(size.cols, size.rows), ...appScenarios(th.name)];
        let capturedThisConfig = 0;
        for (const sc of scenarios) {
          if (process.env.VISUAL_SCENARIO && !sc.name.includes(process.env.VISUAL_SCENARIO)) continue;
          let text = await renderInkFrame(sc.render(), size.cols, size.rows, th.theme, sc.drive);
          if (sc.postProcess) {
            text = sc.postProcess(text);
          }
          const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
          const componentRequirements = { "01-empty-state": "Terminal coding agent", "02-chat-exchange": "Checkpoint", "03-markdown-rendering": "Summary", "04-permission-prompt": "wants to edit a file", "05-mission-deck": "MISSION", "06-header-collapse": "ANVIL", "07-verification-card": "All checks pass", "08-rewind-modal": "checkpoint" };
          const required = sc.required ?? componentRequirements[sc.name];
          if (required && !plain.replace(/\s+/g, " ").toLowerCase().includes(required.toLowerCase())) throw new Error(`${sc.name}: required content missing: ${required}; frame=${JSON.stringify(plain)}`);
          if (!text.includes("\u001b[")) throw new Error(`${sc.name}: color capture produced no ANSI styling`);
          if (sc.name.startsWith("app-") && plain.trimEnd().split("\n").length > size.rows - 1) throw new Error(`${sc.name}: app exceeds terminal height`);
          if (sc.name.startsWith("app-") && plain.split("\n").some(line => displayWidth(line) > size.cols)) throw new Error(`${sc.name}: app exceeds terminal width`);
          const colored = new AnsiToHtml({ escapeXML: true, fg: th.fg, bg: th.bg }).toHtml(text);

          const viewportWidth = Math.round(size.cols * 8.5 + 32);
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
<body>${colored}</body>
</html>`;

          await page.setContent(html);
          await page.evaluateHandle("document.fonts.ready");
          const cellWidth = await page.evaluate(() => {
            const context = document.createElement("canvas").getContext("2d");
            if (!context) throw new Error("Font measurement is unavailable");
            context.font = `13px ${getComputedStyle(document.body).fontFamily}`;
            return context.measureText("M").width;
          });
          const measuredWidth = Math.ceil(cellWidth * size.cols + 32);
          await page.setViewport({ width: measuredWidth, height: viewportHeight, deviceScaleFactor: 1 });
          const buf = await page.screenshot({
            type: "png",
            clip: { x: 0, y: 0, width: measuredWidth, height: viewportHeight },
          });

          const outFile = path.join(targetDir, `${sc.name}.png`);
          fs.writeFileSync(outFile, buf);
          if (sc.name.startsWith("app-")) fs.writeFileSync(path.join(targetDir, `${sc.name}.txt`), plain);
          totalCaptured++;
          capturedThisConfig++;
        }
        console.log(`[visual:capture] Captured ${capturedThisConfig} frames for ${th.name}-${size.name}`);
      }
    }
    console.log(`[visual:capture] Successfully captured ${totalCaptured} frames total.`);
  } finally {
    await browser.close();
    fs.rmSync(captureHome, { recursive: true, force: true });
  }
}

function appScenarios(theme) {
  const make = (mode = "normal") => {
    const broker = new TuiPermissionBroker();
    const provider = { id: "ollama", displayName: "Local fixture", isConfigured: () => true,
      async *streamCompletion() {
        if (mode === "error") { yield { type: "error", code: "AUTH_FAILED", isRetryable: false, message: "Authentication failed: invalid API key" }; return; }
        yield { type: "text_delta", text: mode === "long" ? Array.from({ length: 60 }, (_, index) => `Row ${index}: retained answer`).join("\n\n") : "The module exports boot, shutdown, and reload.\n\nAll three functions preserve the server lifecycle." };
        if (mode === "stream") await new Promise(() => {});
        yield { type: "turn_end", stopReason: "end_turn" };
      } };
    const projectRoot = path.join(process.env.ANVIL_HOME, "demo-project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const options = { projectRoot, systemPrompt: "fixture", maxTokens: 1000 };
    const session = new AgentSession(provider, { ...options, model: "qwen2.5-coder:latest", permissionBroker: broker });
    if (mode === "rewind") session.getCheckpoints = () => CHECKPOINTS;
    return { broker, element: React.createElement(App, { session, broker, providers: { ollama: provider }, providerId: "ollama", model: "qwen2.5-coder:latest", sessionOptions: options, initialTheme: theme }) };
  };
  const idle = make();
  const chat = make();
  const permission = make();
  const slash = make(); const model = make(); const stream = make("stream"); const queue = make("stream"); const error = make("error"); const long = make("long");
  const help = make(); const themes = make(); const rewind = make("rewind");
  const type = async (stdin, ...chunks) => { for (const chunk of chunks) { stdin.write(chunk); await new Promise(resolve => setTimeout(resolve, CAPTURE_SETTLE_MS)); } };
  const waitForText = async (frame, text) => {
    const deadline = Date.now() + CAPTURE_TURN_TIMEOUT_MS;
    while (!frame().replace(/\u001b\[[0-9;]*m/g, "").replace(/\s+/g, " ").includes(text)) {
      if (Date.now() >= deadline) throw new Error(`Fixture did not reach expected state: ${text}`);
      await new Promise(resolve => setTimeout(resolve, CAPTURE_SETTLE_MS));
    }
  };
  return [
    { name: "app-idle", render: () => idle.element, required: "What would you like to work on?" },
    { name: "app-slash", render: () => slash.element, required: "Commands", drive: stdin => type(stdin, "/") },
    { name: "app-models", render: () => model.element, required: "Connected models", drive: stdin => type(stdin, "/model", "\r") },
    { name: "app-streaming", render: () => stream.element, required: "server lifecycle", drive: async (stdin, frame) => { await type(stdin, "Explain", "\r"); await waitForText(frame, "server lifecycle"); } },
    { name: "app-queue", render: () => queue.element, required: "Message queue", drive: stdin => type(stdin, "Explain", "\r", "Next task", "\r", "\x11") },
    { name: "app-error", render: () => error.element, required: "Authentication failed", drive: stdin => type(stdin, "Explain", "\r") },
    { name: "app-long", render: () => long.element, required: "Row 0", drive: stdin => type(stdin, "Explain", "\r", "\t", "\x1b[H") },
    { name: "app-setup", render: () => React.createElement(FirstRunSetup, { onDone: () => {}, onCancel: () => {} }), required: "choose a provider" },
    { name: "app-help", render: () => help.element, required: "Help", drive: stdin => type(stdin, "?") },
    { name: "app-themes", render: () => themes.element, required: "Themes", drive: stdin => type(stdin, "/theme", "\r") },
    { name: "app-rewind", render: () => rewind.element, required: "Restore checkpoint", postProcess: normalizeTimes, drive: stdin => type(stdin, "/rewind", "\r") },
    { name: "app-chat", render: () => chat.element, required: "server lifecycle", drive: async (stdin, frame) => {
      stdin.write("Explain the module"); await new Promise(resolve => setTimeout(resolve, CAPTURE_SETTLE_MS)); stdin.write("\r");
      const deadline = Date.now() + CAPTURE_TURN_TIMEOUT_MS;
      while (!frame().includes("server lifecycle") && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, CAPTURE_SETTLE_MS));
    } },
    { name: "app-permission", render: () => permission.element, required: "wants to edit a file", drive: async () => {
      void permission.broker.requestPermission("edit_file", DIFF);
      await new Promise(resolve => setTimeout(resolve, CAPTURE_SETTLE_MS));
    } },
  ];
}

main().catch((err) => {
  console.error("[visual:capture] Error:", err);
  process.exit(1);
});
