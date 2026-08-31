import { createProviders } from "../src/providers/index.js";

const providers = createProviders({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

const provider = providers.anthropic;
const stream = provider.streamCompletion({
  model: "claude-sonnet-5",
  systemPrompt: "You are a helpful assistant. Be terse.",
  messages: [{ role: "user", content: [{ type: "text", text: "Say hello in 5 words." }] }],
  tools: [],
  maxTokens: 100,
});

for await (const event of stream) {
  console.log(event);
}
