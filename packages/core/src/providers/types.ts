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
  | { type: "error"; message: string };

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
  | "ollama";

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
}

