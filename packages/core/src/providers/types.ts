export type Role = "user" | "assistant";

// Single ToolDefinition for the whole core (tools flavor, with `mutating`).
// Providers only read name/description/inputSchema; the extra flag flows
// through structurally.
import type { ToolDefinition } from "../tools/types.js";
export type { ToolDefinition };

export interface ToolCallRequest {
  id: string;
  name: string;
  input: unknown;
  /**
   * Provider-specific data that MUST round-trip with the conversation history
   * (keyed opaquely by each adapter). E.g. Gemini 3.x returns
   * thoughtSignature values on function-call parts and rejects the next
   * request if they are missing from the replayed history. Adapters that don't
   * need this simply never read or write it.
   */
  providerMetadata?: Record<string, unknown>;
}

export interface ToolResultInput {
  toolCallId: string;
  content: string; // JSON-stringified result, or plain error text
  isError?: boolean;
}

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCallRequest }
  | { type: "tool_result"; result: ToolResultInput }
  /** Inline base64 image attached by the user (/image). Data is raw base64, no data: URL. */
  | { type: "image"; mediaType: string; data: string };

export interface ConversationMessage {
  role: Role;
  content: MessageContent[];
}

export type ProviderErrorCode =
  | "RATE_LIMIT"
  | "AUTH_FAILED"
  | "MODEL_NOT_FOUND"
  | "CONTEXT_OVERFLOW"
  | "NETWORK_TIMEOUT"
  | "SERVER_OVERLOADED"
  | "INVALID_REQUEST"
  | "UNKNOWN";

// Streaming events emitted while a single provider turn is in progress.
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  // Deltas carry the CUMULATIVE argument buffer (adapters append fragments
  // before emitting) — consumers overwrite, never concatenate.
  | { type: "tool_call_delta"; id: string; cumulativeInputJson: string }
  | {
      type: "tool_call_end";
      id: string;
      name: string;
      input: unknown;
      providerMetadata?: Record<string, unknown>;
    }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | {
      type: "turn_end";
      stopReason: "end_turn" | "tool_use" | "max_tokens" | "error" | "unknown";
    }
  | {
      type: "error";
      message: string;
      code?: ProviderErrorCode;
      httpStatus?: number;
      isRetryable?: boolean;
    };

/**
 * Classifies vendor errors into a shared taxonomy for backoff and retry systems.
 */
export function classifyProviderError(err: unknown): {
  code: ProviderErrorCode;
  isRetryable: boolean;
  httpStatus?: number;
} {
  let status: number | undefined;
  if (typeof err === "object" && err !== null) {
    const s =
      (err as { status?: unknown; statusCode?: unknown }).status ??
      (err as { statusCode?: unknown }).statusCode;
    if (typeof s === "number") status = s;
  }
  const msg = typeof err === "string" ? err : typeof err === "object" && err !== null && "message" in err && typeof (err as { message: unknown }).message === "string" ? (err as { message: string }).message : String(err);
  if (!status) {
    const m = msg.match(/\b(?:HTTP\s+)?([45]\d{2})\b/);
    if (m) status = Number(m[1]);
  }

  if (status === 429) {
    return { code: "RATE_LIMIT", isRetryable: true, httpStatus: 429 };
  }
  if (status === 502 || status === 503 || status === 504) {
    return { code: "SERVER_OVERLOADED", isRetryable: true, httpStatus: status };
  }
  if (status === 401 || status === 403) {
    return { code: "AUTH_FAILED", isRetryable: false, httpStatus: status };
  }
  if (status === 404) {
    return { code: "MODEL_NOT_FOUND", isRetryable: false, httpStatus: 404 };
  }
  if (status === 400) {
    return { code: "INVALID_REQUEST", isRetryable: false, httpStatus: 400 };
  }

  if (/rate limit|quota exceeded|429|resource exhausted|too many requests/i.test(msg)) {
    return { code: "RATE_LIMIT", isRetryable: true, httpStatus: status ?? 429 };
  }
  if (/503|502|504|overloaded|service unavailable|bad gateway|gateway timeout/i.test(msg)) {
    return { code: "SERVER_OVERLOADED", isRetryable: true, httpStatus: status ?? 503 };
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|network timeout|fetch failed|socket hang up/i.test(msg)) {
    return { code: "NETWORK_TIMEOUT", isRetryable: true, httpStatus: status };
  }
  if (/401|403|unauthorized|forbidden|invalid api key|authentication|credentials/i.test(msg)) {
    return { code: "AUTH_FAILED", isRetryable: false, httpStatus: status ?? 401 };
  }
  if (/404|model not found|does not exist|unknown model/i.test(msg)) {
    return { code: "MODEL_NOT_FOUND", isRetryable: false, httpStatus: status ?? 404 };
  }
  if (/context_length_exceeded|maximum context length|prompt is too long|context overflow|too many tokens/i.test(msg)) {
    return { code: "CONTEXT_OVERFLOW", isRetryable: false, httpStatus: status ?? 400 };
  }
  if (/400|invalid_request|invalid argument/i.test(msg)) {
    return { code: "INVALID_REQUEST", isRetryable: false, httpStatus: status ?? 400 };
  }
  return { code: "UNKNOWN", isRetryable: false, httpStatus: status };
}

export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openrouter"
  | "orcarouter"
  | "groq"
  | "cerebras"
  | "github"
  | "mistral"
  | "inception"
  | "ollama"
  | "qwencloud";

export interface CompletionRequest {
  model: string; // provider-specific model id, e.g. "claude-sonnet-5"
  systemPrompt: string;
  messages: ConversationMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  signal?: AbortSignal; // pass through to the underlying HTTP request for cancellation
}

// The one method every provider adapter must implement.
export interface ModelProvider {
  id: ProviderId;
  displayName: string;
  isConfigured(): boolean; // true if required API key is present
  streamCompletion(request: CompletionRequest): AsyncGenerator<StreamEvent>;
}

export type CertificationStatus = "live" | "broken" | "untested";

export interface ModelInfo {
  id: string; // what you pass as `model` in CompletionRequest
  providerId: string;
  displayName: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  isFree?: boolean;
  certified?: CertificationStatus;
  certifiedAt?: string; // ISO timestamp
  /**
   * How the certification was obtained: the deterministic mock suite ("mock")
   * or a real-provider probe ("live"). Absent means unrecorded — never render
   * it as "live". Kept separate from `certified` so a passing mock run cannot
   * masquerade as proof the real API works.
   */
  certifiedMode?: "mock" | "live";
}

