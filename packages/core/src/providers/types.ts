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
  // Phase 38.6 — the model's private deliberation, surfaced as a FIRST-CLASS
  // event rather than discarded. OpenRouter-style wires carry it on
  // `delta.reasoning` (measured: 2,026 chars on one turn) and Anvil used to drop
  // every byte. It is deliberately NOT folded into `text_delta`: reasoning is
  // not the answer, so it must never enter the assistant's history text.
  | { type: "reasoning_delta"; text: string }
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
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      /**
       * Reasoning tokens, when the provider reports them SEPARATELY from
       * `outputTokens` (Gemini's `thoughtsTokenCount`). Providers that fold
       * reasoning into `outputTokens` (OpenAI-style `completion_tokens`)
       * leave this undefined — 0 and undefined are different claims, and only
       * the latter is honest when the number is unknown.
       */
      reasoningTokens?: number;
      /**
       * Input tokens served from the provider's prompt cache. A BREAKDOWN of
       * `inputTokens`, never an addition: providers count cached tokens inside
       * the prompt total. Undefined when the provider does not report it.
       */
      cachedInputTokens?: number;
      /** Cache creation is part of total input, with its own billing category. */
      cacheCreationInputTokens?: number;
    }
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
 * Context-window exhaustion signals. Providers surface these as HTTP 400, so
 * they must be judged by MESSAGE and before the generic 400 return — otherwise
 * the CONTEXT_OVERFLOW branch is unreachable in the common case and a caller
 * that wants to compact/truncate instead of failing can never tell the two apart.
 */
const CONTEXT_OVERFLOW_PATTERN =
  /context_length_exceeded|maximum context length|prompt is too long|context overflow|too many tokens/i;

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
    // An inferred status is trusted ONLY for the availability classes (429 and
    // 5xx). Prose carries incidental three-digit numbers — "retry after 400
    // tokens" — and trusting an inferred 400 turned a retryable rate limit into
    // a terminal INVALID_REQUEST (takeover 2026-10-10). The error classes
    // (400/401/403/404) keep their own message checks below, so every
    // message-carried verdict survives by a different route.
    if (m && (m[1] === "429" || /^5\d\d$/.test(m[1]))) status = Number(m[1]);
  }

  if (status === 429) {
    return { code: "RATE_LIMIT", isRetryable: true, httpStatus: 429 };
  }
  // 500 joins its 5xx siblings (takeover 2026-10-10): every major LLM API
  // treats it as transient upstream weather, and it previously fell through to
  // UNKNOWN — non-retryable — while 502/503/504 retried.
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { code: "SERVER_OVERLOADED", isRetryable: true, httpStatus: status };
  }
  if (status === 401 || status === 403) {
    return { code: "AUTH_FAILED", isRetryable: false, httpStatus: status };
  }
  if (status === 404) {
    return { code: "MODEL_NOT_FOUND", isRetryable: false, httpStatus: 404 };
  }
  // Judge the overflow message BEFORE the generic 400 return (see the pattern note).
  if (CONTEXT_OVERFLOW_PATTERN.test(msg)) {
    return { code: "CONTEXT_OVERFLOW", isRetryable: false, httpStatus: status ?? 400 };
  }
  if (status === 400) {
    return { code: "INVALID_REQUEST", isRetryable: false, httpStatus: 400 };
  }

  if (/rate limit|quota exceeded|\b429\b|resource exhausted|too many requests/i.test(msg)) {
    return { code: "RATE_LIMIT", isRetryable: true, httpStatus: status ?? 429 };
  }
  if (/\b50[23]\b|\b504\b|overloaded|service unavailable|bad gateway|gateway timeout/i.test(msg)) {
    return { code: "SERVER_OVERLOADED", isRetryable: true, httpStatus: status ?? 503 };
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|network timeout|fetch failed|socket hang up/i.test(msg)) {
    return { code: "NETWORK_TIMEOUT", isRetryable: true, httpStatus: status };
  }
  if (/\b40[13]\b|unauthorized|forbidden|invalid api key|authentication|credentials/i.test(msg)) {
    return { code: "AUTH_FAILED", isRetryable: false, httpStatus: status ?? 401 };
  }
  if (/\b404\b|model not found|does not exist|unknown model/i.test(msg)) {
    return { code: "MODEL_NOT_FOUND", isRetryable: false, httpStatus: status ?? 404 };
  }
  if (/\b400\b|invalid_request|invalid argument/i.test(msg)) {
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
  /** Phase 38.7 — when true, adapters annotate the static prefix
   *  (system prompt, tool schemas) with `cache_control: { type: "ephemeral" }`
   *  so the provider caches it and the 4,177-token prefix stops being paid
   *  full-price every turn. */
  cacheControl?: boolean;
}

// The one method every provider adapter must implement.
export interface ModelProvider {
  id: ProviderId;
  displayName: string;
  isConfigured(): boolean; // true if required API key is present
  streamCompletion(request: CompletionRequest): AsyncGenerator<StreamEvent>;
}

/**
 * How a model is judged to WORK — a verdict, not a provenance record.
 *  - "live"     : verified working (NOT "verified against the live API" — that
 *                 is `ModelInfo.certifiedMode`).
 *  - "broken"   : a recorded observation that the id no longer works.
 *  - "untested" : no observation at all (the default; carries no certifiedAt).
 * Read this together with `certifiedMode`; neither field alone tells the whole
 * story, which is why the registry integrity test asserts them as a pair.
 */
export type CertificationStatus = "live" | "broken" | "untested";

export interface ModelInfo {
  id: string; // what you pass as `model` in CompletionRequest
  providerId: string;
  displayName: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  isFree?: boolean;
  /** Verdict that the model works — see CertificationStatus. Provenance is
   *  `certifiedMode`, so `certified: "live"` + `certifiedMode: "mock"` is a
   *  coherent pair (a passing mock run), not a contradiction. */
  certified?: CertificationStatus;
  certifiedAt?: string; // ISO timestamp
  /**
   * How the certification was obtained: the deterministic mock suite ("mock")
   * or a real-provider probe ("live"). Absent means unrecorded — never render
   * it as "live". Kept separate from `certified` so a passing mock run cannot
   * masquerade as proof the real API works.
   */
  certifiedMode?: "mock" | "live";
  /**
   * USD price per 1,000 tokens, for cost estimation (Phase 27.5). Optional and
   * deliberately sparse: several ids here are forward-looking, and an invented
   * price is worse than no price — a wrong number in a spend report is a silent
   * lie. ABSENT MEANS UNKNOWN: consumers must render it as unavailable, never as
   * $0. A model with `isFree: true` is $0 by definition (see `pricingForModel`),
   * so free rows need no explicit entry.
   */
  costPer1kInputTokens?: number;
  costPer1kOutputTokens?: number;
  /**
   * USD per 1,000 PROMPT-CACHE READ tokens (Phase 38.7 follow-up). Same rule
   * as the two fields above: ABSENT MEANS UNKNOWN, and the estimator then
   * bills cached input at `costPer1kInputTokens` — a deliberate upper bound,
   * never an invented discount (the report labels it as one).
   */
  costPer1kCachedInputTokens?: number;
  costPer1kCacheCreationInputTokens?: number;
}

