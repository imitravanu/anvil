export type Role = "user" | "assistant";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON schema
}

export interface ToolCallRequest {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultInput {
  toolCallId: string;
  content: string; // JSON-stringified result, or plain error text
  isError?: boolean;
}

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCallRequest }
  | { type: "tool_result"; result: ToolResultInput };

export interface ConversationMessage {
  role: Role;
  content: MessageContent[];
}

// Streaming events emitted while a single provider turn is in progress.
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; partialInputJson: string }
  | { type: "tool_call_end"; id: string; name: string; input: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | {
      type: "turn_end";
      stopReason: "end_turn" | "tool_use" | "max_tokens" | "error" | "unknown";
    }
  | { type: "error"; message: string };

export type ProviderId = "anthropic" | "openai" | "gemini" | "openrouter";

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

export interface ModelInfo {
  id: string; // what you pass as `model` in CompletionRequest
  providerId: string;
  displayName: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
}
