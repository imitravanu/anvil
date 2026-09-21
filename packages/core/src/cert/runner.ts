import { getErrorMessage } from "../errors.js";
import type {
  ModelProvider,
  ProviderId,
  CompletionRequest,
  StreamEvent,
  ToolDefinition,
  ConversationMessage,
} from "../providers/types.js";
import {
  isRateLimitMessage,
  rateLimitRetrySeconds,
  noteRateLimited,
  isRateLimited,
  clearRateLimitRecord,
} from "../providers/freeModels.js";
import { setModelCertification } from "../providers/registry.js";
import { loadCredentials } from "../config/index.js";
import type { ProviderCredentials } from "../providers/index.js";
import type {
  TestCriterion,
  CriterionResult,
  ProviderCertificationResult,
  CertifyOptions,
} from "./types.js";

export const PROVIDER_CERT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-3-5-haiku-20241022",
  openai: "gpt-4o-mini",
  gemini: "gemini-3.6-flash",
  openrouter: "openrouter/free",
  orcarouter: "orcarouter/free",
  groq: "llama-3.3-70b-versatile",
  cerebras: "llama3.1-8b",
  github: "Phi-3.5-mini-instruct",
  mistral: "mistral-small-latest",
  inception: "mercury-2.5",
  ollama: "qwen2.5-coder:latest",
};

/**
 * Resolves credentials combining ~/.anvil/credentials.json with environment variables.
 */
export function resolveCertificationCredentials(): ProviderCredentials {
  const fileCreds = loadCredentials();
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || fileCreds.anthropicApiKey,
    openaiApiKey: process.env.OPENAI_API_KEY || fileCreds.openaiApiKey,
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || fileCreds.geminiApiKey,
    openrouterApiKey: process.env.OPENROUTER_API_KEY || fileCreds.openrouterApiKey,
    orcarouterApiKey: process.env.ORCAROUTER_API_KEY || fileCreds.orcarouterApiKey,
    groqApiKey: process.env.GROQ_API_KEY || fileCreds.groqApiKey,
    cerebrasApiKey: process.env.CEREBRAS_API_KEY || fileCreds.cerebrasApiKey,
    githubApiKey: process.env.GITHUB_TOKEN || process.env.GITHUB_API_KEY || fileCreds.githubApiKey,
    mistralApiKey: process.env.MISTRAL_API_KEY || fileCreds.mistralApiKey,
    inceptionApiKey: process.env.INCEPTION_API_KEY || fileCreds.inceptionApiKey,
    ollamaApiKey: process.env.OLLAMA_API_KEY || fileCreds.ollamaApiKey,
  };
}

/**
 * Criterion 1: Streaming text verification.
 */
async function testStreaming(
  provider: ModelProvider,
  model: string,
  timeoutMs: number,
  onEvent?: (e: StreamEvent) => void
): Promise<CriterionResult> {
  const start = Date.now();
  let textDeltaCount = 0;
  let fullText = "";
  let errorMsg: string | undefined;

  try {
    const stream = provider.streamCompletion({
      model,
      systemPrompt: "You are an Anvil certification test agent. Reply with the exact requested text.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Say ANVIL_STREAMING_CERTIFIED and nothing else." }],
        },
      ],
      tools: [],
      maxTokens: 50,
      signal: AbortSignal.timeout(timeoutMs),
    });

    for await (const ev of stream) {
      if (onEvent) onEvent(ev);
      if (ev.type === "text_delta") {
        textDeltaCount++;
        fullText += ev.text;
      } else if (ev.type === "error") {
        errorMsg = ev.message;
      }
    }

    const durationMs = Date.now() - start;

    if (errorMsg) {
      return { passed: false, durationMs, error: "Stream error: " + errorMsg };
    }
    if (textDeltaCount === 0 || fullText.trim().length === 0) {
      return {
        passed: false,
        durationMs,
        error: "No text_delta events received from provider",
      };
    }

    return {
      passed: true,
      durationMs,
      details: "Received " + textDeltaCount + " text deltas (" + fullText.trim().length + " chars)",
    };
  } catch (err) {
    return {
      passed: false,
      durationMs: Date.now() - start,
      error: getErrorMessage(err),
    };
  }
}

/**
 * Criterion 2: Tool calling round-trip verification.
 */
async function testToolCalls(
  provider: ModelProvider,
  model: string,
  timeoutMs: number,
  onEvent?: (e: StreamEvent) => void
): Promise<CriterionResult> {
  const start = Date.now();
  const testTool: ToolDefinition = {
    name: "test_ping",
    description: "A test ping tool for certification",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
      required: ["message"],
    },
    mutating: false,
  };

  try {
    // Turn 1: Request tool call
    const stream1 = provider.streamCompletion({
      model,
      systemPrompt: "You have access to a tool named test_ping. When asked to call it, call it immediately.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Call the test_ping tool with message anvil_tool_ok." }],
        },
      ],
      tools: [testTool],
      maxTokens: 150,
      signal: AbortSignal.timeout(timeoutMs),
    });

    let toolCallEnd: Extract<StreamEvent, { type: "tool_call_end" }> | undefined;
    let turn1Error: string | undefined;

    for await (const ev of stream1) {
      if (onEvent) onEvent(ev);
      if (ev.type === "tool_call_end") {
        toolCallEnd = ev;
      } else if (ev.type === "error") {
        turn1Error = ev.message;
      }
    }

    if (turn1Error) {
      return { passed: false, durationMs: Date.now() - start, error: "Tool turn 1 error: " + turn1Error };
    }
    if (!toolCallEnd || toolCallEnd.name !== "test_ping") {
      return {
        passed: false,
        durationMs: Date.now() - start,
        error: "Provider did not call tool test_ping (received: " + (toolCallEnd?.name ?? "none") + ")",
      };
    }

    // Turn 2: Feed back tool result (Round-trip)
    const messages: ConversationMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Call the test_ping tool with message anvil_tool_ok." }],
      },
      {
        role: "assistant",
        content: [{ type: "tool_call", call: toolCallEnd }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            result: {
              toolCallId: toolCallEnd.id,
              content: JSON.stringify({ status: "success", echo: "anvil_tool_ok" }),
            },
          },
        ],
      },
    ];

    const stream2 = provider.streamCompletion({
      model,
      systemPrompt: "Acknowledge the tool result terse and brief.",
      messages,
      tools: [testTool],
      maxTokens: 100,
      signal: AbortSignal.timeout(timeoutMs),
    });

    let turn2ReceivedText = false;
    let turn2Error: string | undefined;

    for await (const ev of stream2) {
      if (onEvent) onEvent(ev);
      if (ev.type === "text_delta") turn2ReceivedText = true;
      else if (ev.type === "error") turn2Error = ev.message;
    }

    const durationMs = Date.now() - start;

    if (turn2Error) {
      return { passed: false, durationMs, error: "Tool result round-trip error: " + turn2Error };
    }

    return {
      passed: true,
      durationMs,
      details: "Tool call invoked and tool result round-trip accepted",
    };
  } catch (err) {
    return {
      passed: false,
      durationMs: Date.now() - start,
      error: getErrorMessage(err),
    };
  }
}

/**
 * Criterion 3: Multi-turn context continuity verification (3 turns).
 */
async function testMultiTurn(
  provider: ModelProvider,
  model: string,
  timeoutMs: number,
  onEvent?: (e: StreamEvent) => void
): Promise<CriterionResult> {
  const start = Date.now();
  const secret = "PHOENIX_774";
  const messages: ConversationMessage[] = [];

  try {
    // Turn 1: Introduce secret keyword
    messages.push({
      role: "user",
      content: [{ type: "text", text: "Remember this exact secret code word: " + secret + ". What is 5 + 5?" }],
    });

    let turn1Text = "";
    for await (const ev of provider.streamCompletion({
      model,
      systemPrompt: "Be terse.",
      messages,
      tools: [],
      maxTokens: 80,
      signal: AbortSignal.timeout(timeoutMs),
    })) {
      if (onEvent) onEvent(ev);
      if (ev.type === "text_delta") turn1Text += ev.text;
    }
    messages.push({ role: "assistant", content: [{ type: "text", text: turn1Text }] });

    // Turn 2: Intermediate question
    messages.push({
      role: "user",
      content: [{ type: "text", text: "What is 10 + 10?" }],
    });

    let turn2Text = "";
    for await (const ev of provider.streamCompletion({
      model,
      systemPrompt: "Be terse.",
      messages,
      tools: [],
      maxTokens: 80,
      signal: AbortSignal.timeout(timeoutMs),
    })) {
      if (onEvent) onEvent(ev);
      if (ev.type === "text_delta") turn2Text += ev.text;
    }
    messages.push({ role: "assistant", content: [{ type: "text", text: turn2Text }] });

    // Turn 3: Query earlier secret keyword
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: "What was the secret code word I asked you to remember in my very first message? Reply with only the code word.",
        },
      ],
    });

    let turn3Text = "";
    for await (const ev of provider.streamCompletion({
      model,
      systemPrompt: "Be terse.",
      messages,
      tools: [],
      maxTokens: 80,
      signal: AbortSignal.timeout(timeoutMs),
    })) {
      if (onEvent) onEvent(ev);
      if (ev.type === "text_delta") turn3Text += ev.text;
    }

    const durationMs = Date.now() - start;
    if (!turn3Text.includes(secret)) {
      return {
        passed: false,
        durationMs,
        error: `Model failed to recall secret code word in turn 3 (received: "${turn3Text.trim()}")`,
      };
    }

    return {
      passed: true,
      durationMs,
      details: "3-turn context dialogue maintained memory of initial turn (" + secret + ")",
    };
  } catch (err) {
    return {
      passed: false,
      durationMs: Date.now() - start,
      error: getErrorMessage(err),
    };
  }
}

/**
 * Criterion 4: Deterministic 404 / Error path verification (clean error, no process crash).
 */
async function testErrorPath(
  provider: ModelProvider,
  timeoutMs: number,
  onEvent?: (e: StreamEvent) => void
): Promise<CriterionResult> {
  const start = Date.now();
  const invalidModel = "anvil-invalid-model-for-certification-404";
  let receivedErrorEvent = false;
  let errorMessage: string | undefined;

  try {
    const stream = provider.streamCompletion({
      model: invalidModel,
      systemPrompt: "test",
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      tools: [],
      maxTokens: 50,
      signal: AbortSignal.timeout(timeoutMs),
    });

    for await (const ev of stream) {
      if (onEvent) onEvent(ev);
      if (ev.type === "error") {
        receivedErrorEvent = true;
        errorMessage = ev.message;
      } else if (ev.type === "turn_end" && ev.stopReason === "error") {
        receivedErrorEvent = true;
      }
    }

    const durationMs = Date.now() - start;
    if (!receivedErrorEvent && !errorMessage) {
      return {
        passed: false,
        durationMs,
        error: "Provider did not yield an error event for invalid model " + invalidModel,
      };
    }

    return {
      passed: true,
      durationMs,
      details: `Clean error event emitted: "${(errorMessage?.slice(0, 60) ?? "stopReason: error")}..."`,
    };
  } catch (err) {
    // A caught error is also an acceptable error containment path if clean
    const durationMs = Date.now() - start;
    const msg = getErrorMessage(err);
    return {
      passed: true,
      durationMs,
      details: `Clean error caught and contained: "${msg.slice(0, 60)}..."`,
    };
  }

}

/**
 * Criterion 5: Rate limit detection and circuit-breaker handling.
 */
async function testRateLimit(
  provider: ModelProvider,
  model: string
): Promise<CriterionResult> {
  const start = Date.now();

  try {
    // 1. Verify rate-limit message detection
    const sample429 = "429 Too Many Requests: Resource has been exhausted (e.g. check quota)";
    if (!isRateLimitMessage(sample429)) {
      return {
        passed: false,
        durationMs: Date.now() - start,
        error: "isRateLimitMessage failed to detect standard 429 quota string",
      };
    }

    const nonRateLimit = "404 Model Not Found";
    if (isRateLimitMessage(nonRateLimit)) {
      return {
        passed: false,
        durationMs: Date.now() - start,
        error: "isRateLimitMessage falsely flagged a 404 error",
      };
    }

    // 2. Verify backoff calculation
    const retryWait = rateLimitRetrySeconds("Please retry in 15s");
    if (retryWait !== 15) {
      return {
        passed: false,
        durationMs: Date.now() - start,
        error: "rateLimitRetrySeconds failed to parse 15s wait window (got: " + retryWait + ")",
      };
    }

    // 3. Verify circuit breaker recording & state query
    noteRateLimited(provider.id, model);
    if (!isRateLimited(provider.id, model)) {
      return {
        passed: false,
        durationMs: Date.now() - start,
        error: "noteRateLimited did not record rate limit state for " + provider.id + ":" + model,
      };
    }

    // Clean up record to avoid test pollution
    clearRateLimitRecord(provider.id, model);
    if (isRateLimited(provider.id, model)) {
      return {
        passed: false,
        durationMs: Date.now() - start,
        error: "clearRateLimitRecord did not reset rate limit state",
      };
    }

    return {
      passed: true,
      durationMs: Date.now() - start,
      details: "Rate-limit detection, backoff parsing, and circuit-breaker state verified",
    };
  } catch (err) {
    return {
      passed: false,
      durationMs: Date.now() - start,
      error: getErrorMessage(err),
    };
  }
}

/**
 * Certify a single provider across all 5 criteria.
 */
export async function certifyProvider(
  provider: ModelProvider,
  options: CertifyOptions = {}
): Promise<ProviderCertificationResult> {
  const model = options.model ?? PROVIDER_CERT_MODELS[provider.id] ?? "default-model";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const startTime = Date.now();

  const criteria: Record<TestCriterion, CriterionResult> = {
    streaming: { passed: false, durationMs: 0 },
    toolCalls: { passed: false, durationMs: 0 },
    multiTurn: { passed: false, durationMs: 0 },
    errorPath: { passed: false, durationMs: 0 },
    rateLimit: { passed: false, durationMs: 0 },
  };

  if (!provider.isConfigured()) {
    return {
      providerId: provider.id,
      model,
      status: "untested",
      passed: false,
      totalDurationMs: 0,
      criteria,
      error: "Provider " + provider.id + " is not configured (missing credentials)",
    };
  }

  const runStep = async (
    criterion: TestCriterion,
    fn: () => Promise<CriterionResult>
  ) => {
    options.onCriterionStart?.(criterion);
    const res = await fn();
    criteria[criterion] = res;
    options.onCriterionComplete?.(criterion, res);
  };

  await runStep("streaming", () => testStreaming(provider, model, timeoutMs));
  await runStep("toolCalls", () => testToolCalls(provider, model, timeoutMs));
  await runStep("multiTurn", () => testMultiTurn(provider, model, timeoutMs));
  await runStep("errorPath", () => testErrorPath(provider, timeoutMs));
  await runStep("rateLimit", () => testRateLimit(provider, model));

  const totalDurationMs = Date.now() - startTime;
  const allPassed = Object.values(criteria).every((c) => c.passed);
  const status = allPassed ? "live" : "broken";

  // Update in-memory registry status, recording HOW it was obtained so a mock
  // pass is never badged as a live probe.
  setModelCertification(model, provider.id, status, undefined, options.mock ? "mock" : "live");

  return {
    providerId: provider.id,
    model,
    status,
    passed: allPassed,
    totalDurationMs,
    criteria,
  };
}

/**
 * Certify multiple providers.
 */
export async function certifyAllProviders(
  providers: Record<ProviderId, ModelProvider>,
  options: CertifyOptions = {}
): Promise<Record<ProviderId, ProviderCertificationResult>> {
  const results = {} as Record<ProviderId, ProviderCertificationResult>;
  for (const [id, provider] of Object.entries(providers) as [ProviderId, ModelProvider][]) {
    results[id] = await certifyProvider(provider, options);
  }
  return results;
}
