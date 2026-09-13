import { getErrorMessage } from "../src/errors.js";
import { createProviders, syncOpenRouterModels } from "../src/providers/index.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// Live smoke test for the OpenRouter adapter — run with:
//   npx tsx packages/core/scripts/verify-openrouter.ts
// Never hardcodes or logs the key: OPENROUTER_API_KEY env first (as with the
// other verify-* scripts), then ~/.anvil/credentials.json — the same file the
// TUI reads.
function loadKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const creds = JSON.parse(readFileSync(`${homedir()}/.anvil/credentials.json`, "utf8"));
    return typeof creds.openrouterApiKey === "string" && creds.openrouterApiKey
      ? creds.openrouterApiKey
      : undefined;
  } catch {
    return undefined;
  }
}

const apiKey = loadKey();
if (!apiKey) {
  console.error("No OpenRouter key found (OPENROUTER_API_KEY or ~/.anvil/credentials.json) — aborting.");
  process.exit(1);
}

const providers = createProviders({ openrouterApiKey: apiKey });
const provider = providers.openrouter;
console.log(`provider: ${provider.displayName} | isConfigured: ${provider.isConfigured()}`);

let failed = false;

// Phase 1/3 — live free-model sync (the boot/picker path): real /models fetch,
// registry merge, cache persist. ttl 0 = explicit force refresh, like /sync.
console.log("\n[1/3] free-model sync (force refresh)");
try {
  const sync = await syncOpenRouterModels(apiKey);
  console.log(
    `  ${sync.freeCount} free models live (newlyFree: ${sync.newlyFree.length}, noLongerFree: ${sync.noLongerFree.length})`
  );
} catch (err) {
  failed = true;
  console.error(`  sync FAILED: ${getErrorMessage(err)}`);
}

// Free model ids churn and free tier rate-limits are tight — override with
// OPENROUTER_MODEL (phase 1 prints what is live) if the default 404s/429s.
const model = process.env.OPENROUTER_MODEL ?? "cohere/north-mini-code:free";

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
