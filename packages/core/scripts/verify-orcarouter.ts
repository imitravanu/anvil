import { getErrorMessage } from "../src/errors.js";
import { createProviders } from "../src/providers/index.js";
import { fetchOrcarouterFreeModels } from "../src/providers/freeModels.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// Live smoke test for the Orcarouter free tier — run with:
//   npx tsx packages/core/scripts/verify-orcarouter.ts
// Never hardcodes or logs any key: the free catalog is PUBLIC and key-less,
// so the sync phase sends no credentials at all. The chat phases need
// ORCAROUTER_API_KEY (or ~/.anvil/credentials.json — the same file the TUI
// reads) with the target model in scope; 403 block_key_scope means the key
// needs widening at https://www.orcarouter.ai/console/token, not an Anvil bug.
//
// Free-tier lineup churns (2026-09-09: Qwen3.8 27B DELISTED, replaced by
// `z-ai/glm-5.3-flash-free` per the official OrcaRouter post) — override the
// default chat model with ORCAROUTER_MODEL if the default is retired or the
// key lacks scope for it.
function loadKey(): string | undefined {
  if (process.env.ORCAROUTER_API_KEY) return process.env.ORCAROUTER_API_KEY;
  try {
    const creds = JSON.parse(readFileSync(`${homedir()}/.anvil/credentials.json`, "utf8"));
    return typeof creds.orcarouterApiKey === "string" && creds.orcarouterApiKey
      ? creds.orcarouterApiKey
      : undefined;
  } catch {
    return undefined;
  }
}

const providers = createProviders({ orcarouterApiKey: loadKey() });
const provider = providers.orcarouter;
console.log(`provider: ${provider.displayName} | isConfigured: ${provider.isConfigured()}`);

let failed = false;

// Phase 1/3 — live free-model sync against the PUBLIC pricing catalog
// (no key sent): the boot/picker path. Expect the live free lineup.
console.log("\n[1/3] free-model sync (public catalog, key-less)");
try {
  const models = await fetchOrcarouterFreeModels();
  console.log(`  ${models.length} free models live:`);
  for (const m of models) {
    console.log(`    - ${m.id} | ctx=${m.contextWindow} | tools=${m.supportsTools} | vision=${m.supportsVision}`);
  }
  if (!models.some((m) => m.id === "z-ai/glm-5.3-flash-free")) {
    console.log("  NOTE: z-ai/glm-5.3-flash-free absent — lineup churned again; pass ORCAROUTER_MODEL explicitly.");
  }
} catch (err) {
  failed = true;
  console.error(`  sync FAILED: ${getErrorMessage(err)}`);
}

// Chat phases need a scoped key; without one, report sync-only success.
const apiKey = loadKey();
if (!apiKey) {
  console.log("\nNo Orcarouter key found (ORCAROUTER_API_KEY or ~/.anvil/credentials.json) — skipping chat phases.");
  console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: SYNC-ONLY OK (no key for chat phases)");
  process.exit(failed ? 1 : 0);
}

// Free model ids churn and keys are per-model scoped — override with
// ORCAROUTER_MODEL (phase 1 prints what is live) if the default 403s/404s.
const model = process.env.ORCAROUTER_MODEL ?? "z-ai/glm-5.3-flash-free";

// Phase 2/3 — plain streaming completion.
console.log(`\n[2/3] plain completion — model: ${model}`);
let text = "";
let stop: string | null = null;
for await (const ev of provider.streamCompletion({
  model,
  systemPrompt: "You are a helpful assistant. Be terse.",
  messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly: ANVIL-LIVE-OK" }] }],
  tools: [],
  maxTokens: 2000, // generous: free tier rejects on content filters, not size
})) {
  if (ev.type === "text_delta") text += ev.text;
  else if (ev.type === "turn_end") stop = ev.stopReason;
  else if (ev.type === "usage") console.log(`  usage: ${ev.inputTokens} in / ${ev.outputTokens} out`);
  else if (ev.type === "error") {
    failed = true;
    console.error(`  completion error: ${ev.message}`);
  }
}
console.log(`  text: ${JSON.stringify(text)} | stopReason: ${stop}`);
if (!text || stop !== "end_turn") failed = true;

// Phase 3/3 — tool-call translation (OpenAI tool_calls deltas → Anvil events).
console.log(`\n[3/3] tool-call round-trip — model: ${model}`);
let toolName: string | null = null;
let cumulative = "";
let endInput: unknown = null;
stop = null;
for await (const ev of provider.streamCompletion({
  model,
  systemPrompt: "You must call the provided tool to answer. Never answer from your own knowledge.",
  messages: [
    { role: "user", content: [{ type: "text", text: "What is the weather in Paris right now? Use the get_weather tool." }] },
  ],
  tools: [
    {
      name: "get_weather",
      description: "Get current weather for a city",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string", description: "City name" } },
        required: ["city"],
      },
      mutating: false,
    },
  ],
  maxTokens: 2000,
})) {
  if (ev.type === "tool_call_start") toolName = ev.name;
  else if (ev.type === "tool_call_delta") cumulative = ev.cumulativeInputJson;
  else if (ev.type === "tool_call_end") endInput = ev.input;
  else if (ev.type === "turn_end") stop = ev.stopReason;
  else if (ev.type === "error") {
    failed = true;
    console.error(`  tool-call error: ${ev.message}`);
  }
}
const parsed = (endInput ?? {}) as { city?: string };
console.log(`  tool: ${toolName} | args: ${cumulative} | stopReason: ${stop}`);
const toolOk =
  toolName === "get_weather" && stop === "tool_use" && cumulative.includes("Paris") && parsed.city === "Paris";
if (!toolOk) failed = true;

console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: ALL LIVE CHECKS PASSED");
process.exit(failed ? 1 : 0);
