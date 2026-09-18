/**
 * Visual harness: renders the real <App> with a scripted FakeProvider and
 * dumps frames so the UI can be reviewed without a live API key.
 * Usage: npx tsx scripts/ui-preview.tsx [frameName]
 */
import React from "react";
import { render } from "ink-testing-library";
import { AgentSession } from "@anvil/core";
import { App } from "../src/components/App.js";
import { TuiPermissionBroker } from "../src/permission/TuiPermissionBroker.js";
import { FakeProvider } from "../../core/src/agent/__tests__/fakeProvider.js";
import type { StreamEvent, ProviderId, ModelProvider } from "@anvil/core";

const MODEL = "gemini-3.6-flash";

const md = `Here's what I found in \`src/index.ts\`:

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

Next I'll check the tests. `;

function textTurn(): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const chunk of md.match(/[\s\S]{1,24}/g) ?? []) {
    events.push({ type: "text_delta", text: chunk });
  }
  events.push({ type: "usage", inputTokens: 1234, outputTokens: 567 });
  events.push({ type: "turn_end", stopReason: "end_turn" });
  return events;
}

function toolTurn(): StreamEvent[] {
  return [
    { type: "text_delta", text: "Let me look at the files." },
    { type: "tool_call_start", id: "t1", name: "list_files" },
    { type: "tool_call_end", id: "t1", name: "list_files", input: { path: "." } },
    { type: "tool_call_start", id: "t2", name: "grep" },
    { type: "tool_call_end", id: "t2", name: "grep", input: { pattern: "boot", path: "src" } },
    { type: "usage", inputTokens: 2000, outputTokens: 300 },
    { type: "turn_end", stopReason: "tool_use" },
  ];
}

const finalTurn = (): StreamEvent[] => [
  {
    type: "text_delta",
    text: "All checks pass. The server boots cleanly with TLS enabled.",
  },
  { type: "usage", inputTokens: 1500, outputTokens: 80 },
  { type: "turn_end", stopReason: "end_turn" },
];

const provider = new FakeProvider([textTurn(), toolTurn(), finalTurn()]);

const broker = new TuiPermissionBroker();
const session = new AgentSession(provider, {
  systemPrompt: "You are Anvil, a terminal coding agent. Be concise.",
  model: MODEL,
  maxTokens: 8192,
  projectRoot: process.cwd(),
  permissionBroker: broker, // read-only tools auto-allow? No — mutating only prompts.
});

const { lastFrame, stdin, unmount } = render(
  <App
    session={session}
    broker={broker}
    providers={{ anthropic: provider } as unknown as Record<ProviderId, ModelProvider>}
    providerId="anthropic"
    model={MODEL}
    sessionOptions={{
      systemPrompt: "You are Anvil, a terminal coding agent. Be concise.",
      maxTokens: 8192,
      projectRoot: process.cwd(),
    }}
  />
);
// ink-testing-library's render takes only the tree — the old two-arg call's
// { exitOnCtrlC: false, columns: 96 } were silently ignored by the library.
// The harness controls exit via unmount() below and captures frames as-is.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const raw = process.env.ANSI_FRAMES === "1";
function dump(label: string) {
  const frame = lastFrame() ?? "";
  console.log(`\n========== FRAME: ${label} ==========`);
  console.log(raw ? frame : frame.replace(/\u001b\[[0-9;]*m/g, ""));
}

async function type(text: string) {
  for (const ch of text) {
    stdin.write(ch);
    await sleep(8); // one tick per char — coalesced writes lose keystrokes
  }
  await sleep(30);
  stdin.write("\r");
  await sleep(500);
}

async function main() {
  await sleep(150);
  dump("empty-state");
  await type("what does the module export?");
  await sleep(1500);
  dump("after-markdown-turn");
  await type("check the files");
  await sleep(400);
  dump("after-tool-turn");
  await sleep(1500);
  dump("final");
  unmount();
}

void main();
