import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent } from "../src/agent/index.js";
import { createProviders } from "../src/providers/index.js";
import { FakeProvider, type ScriptEntry } from "../src/agent/__tests__/fakeProvider.js";
import type { StreamEvent } from "../src/providers/types.js";

// ---------------------------------------------------------------- provider
// Live Anthropic when a key is available; otherwise the scripted FakeProvider,
// so the loop's mechanics are verifiable with zero credentials.
const anthropicKey = process.env.ANTHROPIC_API_KEY;

function makeProvider() {
  if (anthropicKey) {
    const providers = createProviders({ anthropicApiKey: anthropicKey });
    return { provider: providers.anthropic, model: "claude-sonnet-5", live: true };
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const providers = createProviders({ geminiApiKey: geminiKey });
    // maxTokens must budget for thinking tokens on Gemini 3.x (Phase 1 gotcha)
    return { provider: providers.gemini, model: "gemini-3.6-flash", live: true, maxTokens: 2048 };
  }
  const task =
    "Create a file called hello.txt containing the word hello, then read it back.";
  const script: ScriptEntry[] = anthropicKey
    ? []
    : [
        [
          { type: "tool_call_start", id: "c1", name: "write_file" },
          {
            type: "tool_call_end",
            id: "c1",
            name: "write_file",
            input: { path: "hello.txt", content: "hello" },
          },
          { type: "turn_end", stopReason: "tool_use" },
        ],
        [
          { type: "tool_call_start", id: "c2", name: "read_file" },
          { type: "tool_call_end", id: "c2", name: "read_file", input: { path: "hello.txt" } },
          { type: "turn_end", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "Created hello.txt and read it back: hello" },
          { type: "turn_end", stopReason: "end_turn" },
        ],
      ];
  return { provider: new FakeProvider(script) as never, model: "fake-model", live: false } as const;
}

// ------------------------------------------------------------------- main
async function main() {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-agent-verify-"));
  const { provider, model, live, maxTokens = 1024 } = makeProvider() as {
    provider: import("../src/providers/types.js").ModelProvider;
    model: string;
    live: boolean;
    maxTokens?: number;
  };
  console.log(
    live
      ? `LIVE run against ${provider.displayName} (${model}), scratch: ${scratch}`
      : `OFFLINE run with FakeProvider, scratch: ${scratch}`
  );

  const session = new AgentSession(provider, {
    systemPrompt: "You are Anvil, a coding agent. Be terse.",
    model,
    maxTokens,
    projectRoot: scratch,
    permissionBroker: {
      async requestPermission(toolName, summary) {
        console.log(`  [permission] ${toolName}: ${summary.split("\n")[0].slice(0, 100)}`);
        return true;
      },
    },
  });

  for await (const event of session.send(
    "Create a file called hello.txt containing the word hello, then read it back."
  )) {
    switch (event.type) {
      case "text_delta":
        process.stdout.write(event.text);
        break;
      case "tool_started":
        console.log(`  [tool] ${event.name} started`);
        break;
      case "tool_finished":
        console.log(`  [tool] ${event.name} finished: ${event.result.summary.split("\n")[0].slice(0, 100)}`);
        break;
      case "tool_permission_denied":
        console.log(`  [permission] DENIED ${event.name}`);
        break;
      case "usage":
        console.log(`  [usage] in=${event.inputTokens} out=${event.outputTokens}`);
        break;
      case "turn_complete":
        console.log("\n[turn_complete]");
        break;
      case "cancelled":
        console.log("\n[cancelled]");
        break;
      case "error":
        console.log(`\n[error] ${event.message}`);
        break;
    }
  }

  // Final proof: the file exists in the scratch directory with the right content
  try {
    const content = await fs.readFile(path.join(scratch, "hello.txt"), "utf8");
    console.log(`verify: hello.txt content = ${JSON.stringify(content)}`);
  } catch {
    console.log("verify: hello.txt was not created (see events above)");
  }
  await fs.rm(scratch, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
