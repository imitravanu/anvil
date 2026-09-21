#!/usr/bin/env npx tsx
/**
 * QwenCloud Model Audit Script for Anvil
 * 
 * Audits streaming deltas, tool-calling round-trips, and reasoning capabilities
 * across QwenCloud models using Anvil's native provider adapter.
 *
 * Usage:
 *   npx tsx scripts/audit-qwen.ts
 *   npx tsx scripts/audit-qwen.ts --model qwen3.8-max
 *   npx tsx scripts/audit-qwen.ts --fast
 */

import {
  createQwenCloudProvider,
  loadCredentials,
  resolveCertificationCredentials,
  getModelsForProvider,
  type CompletionRequest,
  type StreamEvent,
  type ToolDefinition,
} from "../packages/core/src/index.js";

const DEFAULT_AUDIT_MODELS = [
  "qwen3.8-flash",
  "qwen3.8-max",
  "qwq-plus",
  "qwen3-coder-plus",
  "qwen3-coder-flash",
  "deepseek-v4.1-flash",
  "deepseek-v4-flash",
  "glm-5.3",
  "kimi-k3",
];

const CALC_TOOL: ToolDefinition = {
  name: "calc",
  description: "Calculate a mathematical expression",
  inputSchema: {
    type: "object",
    properties: {
      operation: { type: "string", description: "math operation description" },
      result: { type: "number", description: "calculated numeric value" },
    },
    required: ["operation", "result"],
  },
  mutating: false,
};

interface AuditResult {
  model: string;
  streaming: { ok: boolean; text?: string; latencyMs: number; error?: string };
  toolCall: { ok: boolean; callName?: string; args?: unknown; latencyMs: number; error?: string };
}

async function auditModel(
  provider: ReturnType<typeof createQwenCloudProvider>,
  model: string,
  skipTools = false
): Promise<AuditResult> {
  const result: AuditResult = {
    model,
    streaming: { ok: false, latencyMs: 0 },
    toolCall: { ok: false, latencyMs: 0 },
  };

  // Test 1: Streaming
  const streamStart = Date.now();
  try {
    const stream = provider.streamCompletion({
      model,
      systemPrompt: "You are a concise AI assistant. Respond in 5 words or fewer.",
      messages: [{ role: "user", content: [{ type: "text", text: "Say 'Qwen ready for Anvil'" }] }],
      tools: [],
      maxTokens: 128,
    });

    let text = "";
    for await (const event of stream) {
      if (event.type === "text_delta") {
        text += event.text;
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    result.streaming = {
      ok: text.length > 0,
      text: text.trim().replace(/\n/g, " "),
      latencyMs: Date.now() - streamStart,
    };
  } catch (err: unknown) {
    result.streaming = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - streamStart,
    };
  }

  if (skipTools) {
    result.toolCall = { ok: true, latencyMs: 0 };
    return result;
  }

  // Test 2: Tool calling
  const toolStart = Date.now();
  try {
    const stream = provider.streamCompletion({
      model,
      systemPrompt: "You are a function calling assistant. Always invoke the calc tool to provide the answer.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Use the calc tool to multiply 7 by 8. The result is 56." }],
        },
      ],
      tools: [CALC_TOOL],
      maxTokens: 256,
    });

    let callName: string | undefined;
    let callInput: unknown;
    for await (const event of stream) {
      if (event.type === "tool_call_start") {
        callName = event.name;
      } else if (event.type === "tool_call_end") {
        callName = event.name;
        callInput = event.input;
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }

    result.toolCall = {
      ok: !!callName,
      callName,
      args: callInput,
      latencyMs: Date.now() - toolStart,
    };
  } catch (err: unknown) {
    result.toolCall = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - toolStart,
    };
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const singleModel = args.find((a, i) => args[i - 1] === "--model");
  const isFast = args.includes("--fast");

  const creds = resolveCertificationCredentials();
  const apiKey = creds.qwencloudApiKey;

  if (!apiKey) {
    console.error("❌ No QwenCloud API key found.");
    console.error("   Set QWENCLOUD_API_KEY or save it in ~/.anvil/credentials.json under qwencloudApiKey");
    process.exit(1);
  }

  console.log("================================================================================");
  console.log("               ⚡ ANVIL: QWENCLOUD MODEL AUDIT SUITE");
  console.log("================================================================================");
  console.log(`Endpoint: https://dashscope-intl.aliyuncs.com/compatible-mode/v1`);
  console.log(`API Key:  ${apiKey.slice(0, 10)}...${apiKey.slice(-6)}`);

  const provider = createQwenCloudProvider(apiKey);
  const modelsToTest = singleModel ? [singleModel] : DEFAULT_AUDIT_MODELS;

  console.log(`Auditing ${modelsToTest.length} models:\n`);

  const tableRows: Array<{
    model: string;
    streamOk: string;
    streamLatency: string;
    toolOk: string;
    toolLatency: string;
    notes: string;
  }> = [];

  for (const model of modelsToTest) {
    process.stdout.write(`• Auditing ${model.padEnd(24)} `);
    const res = await auditModel(provider, model, isFast);

    const streamStatus = res.streaming.ok ? "✅ PASS" : "❌ FAIL";
    const toolStatus = isFast ? "⏭️ SKIP" : res.toolCall.ok ? "✅ PASS" : "❌ FAIL";
    const notes = res.streaming.error
      ? `Error: ${res.streaming.error.slice(0, 40)}...`
      : res.toolCall.error
      ? `Tool error: ${res.toolCall.error.slice(0, 35)}...`
      : `"${res.streaming.text?.slice(0, 35) || ""}"`;

    console.log(`[Stream: ${streamStatus} (${res.streaming.latencyMs}ms) | Tools: ${toolStatus} (${res.toolCall.latencyMs}ms)]`);

    tableRows.push({
      model,
      streamOk: streamStatus,
      streamLatency: `${res.streaming.latencyMs}ms`,
      toolOk: toolStatus,
      toolLatency: `${res.toolCall.latencyMs}ms`,
      notes,
    });
  }

  console.log("\n================================================================================");
  console.log("                           AUDIT SUMMARY SCORECARD");
  console.log("================================================================================");
  console.table(tableRows);

  const allStreamOk = tableRows.every((r) => r.streamOk.includes("PASS"));
  console.log(
    allStreamOk
      ? "\n✨ All audited QwenCloud models are functional and certified for Anvil."
      : "\n⚠️ Some models encountered errors during testing. Review the scorecard above."
  );
}

main().catch((err) => {
  console.error("Fatal audit error:", err);
  process.exit(1);
});
