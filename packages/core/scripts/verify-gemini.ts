import { createProviders } from "../src/providers/index.js";
import { readFileSync } from "node:fs";

// Key comes from the environment (loaded by the caller from ~/.anvil/credentials.json).
// Never hardcode or log it.
const creds = {
  geminiApiKey: process.env.GEMINI_API_KEY,
};

const providers = createProviders(creds);
const provider = providers.gemini;

console.log(`provider: ${provider.displayName} | isConfigured: ${provider.isConfigured()}`);
if (!provider.isConfigured()) {
  console.error("GEMINI_API_KEY not set — aborting.");
  process.exit(1);
}

const stream = provider.streamCompletion({
  model: process.env.GEMINI_MODEL ?? "gemini-3.1-pro-preview",
  systemPrompt: "You are a helpful assistant. Be terse.",
  messages: [{ role: "user", content: [{ type: "text", text: "Say hello in 5 words." }] }],
  tools: [],
  maxTokens: 500,
});

for await (const event of stream) {
  console.log(JSON.stringify(event));
}
