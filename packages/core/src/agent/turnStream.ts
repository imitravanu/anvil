/**
 * One assistant turn: call the provider, accumulate text + tool calls, and
 * surface the terminal facts the turn loop needs. Extracted from
 * AgentSession.send() so the streaming contract (partial tool-call assembly,
 * rate-limit retry, usage accounting) lives on its own and can be tested
 * without a whole session.
 */

import type { ModelProvider, ConversationMessage } from "../providers/types.js";
import {
  getConsecutiveRateLimitCount,
  isRateLimitMessage,
  noteRateLimited,
  rateLimitRetrySeconds,
  recordFailure,
} from "../providers/freeModels.js";
import type { ToolDefinition } from "../tools/types.js";
import type { AgentEvent } from "./types.js";
import type { TurnState } from "./turnState.js";
import type { AccumulatedToolCall } from "./loopGuard.js";

export interface StreamTurnInput {
  provider: ModelProvider;
  model: string;
  systemPrompt: string;
  messages: ConversationMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  controller: AbortController;
  /** Carries the once-per-turn rate-limit retry flag. */
  turn: TurnState;
  /** Called for each usage event so the session can cache the latest counts. */
  onUsage: (usage: { inputTokens: number; outputTokens: number }) => void;
}

/** Everything the turn loop needs after a streamed round. */
export interface TurnStreamResult {
  textParts: string[];
  toolCalls: AccumulatedToolCall[];
  stopReason: string | undefined;
  /** Seconds to wait before retrying a rate-limited round, or null. */
  rateLimitRetry: number | null;
  /** False when the provider never reported usage (caller estimates instead). */
  sawUsage: boolean;
}

/**
 * Streams one assistant round. Returns null when the round ended in a
 * surfaced provider error; yields `error` / `usage` / `text_delta` events as
 * they arrive.
 */
export async function* streamAssistantTurn(
  input: StreamTurnInput
): AsyncGenerator<AgentEvent, TurnStreamResult | null> {
  const { provider, controller, turn } = input;
  const stream = provider.streamCompletion({
    model: input.model,
    systemPrompt: input.systemPrompt,
    messages: input.messages,
    tools: input.tools,
    maxTokens: input.maxTokens,
    signal: controller.signal,
  });

  const textParts: string[] = [];
  const toolCalls: AccumulatedToolCall[] = [];
  const openCalls = new Map<string, { name: string; inputJson: string }>();
  let stopReason: string | undefined;
  let rateLimitRetry: number | null = null;
  let sawUsage = false;

  for await (const event of stream) {
    switch (event.type) {
      case "text_delta":
        textParts.push(event.text);
        yield { type: "text_delta", text: event.text };
        break;
      case "tool_call_start":
        openCalls.set(event.id, { name: event.name, inputJson: "" });
        break;
      case "tool_call_delta": {
        const open = openCalls.get(event.id);
        if (open) open.inputJson = event.cumulativeInputJson;
        break;
      }
      case "tool_call_end": {
        const open = openCalls.get(event.id);
        let parsed: unknown;
        if (event.input !== undefined && event.input !== null) {
          parsed = event.input;
        } else {
          // Deltas accumulate as raw JSON; a malformed buffer is recorded
          // rather than thrown so the turn can report the tool's failure.
          const raw = open?.inputJson ?? "";
          if (raw.trim()) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = { __parseError: true, rawInput: raw.slice(0, 200) };
            }
          } else {
            parsed = {};
          }
        }
        openCalls.delete(event.id);
        toolCalls.push({
          id: event.id,
          name: event.name ?? open?.name ?? "",
          input: parsed,
          ...(event.providerMetadata ? { providerMetadata: event.providerMetadata } : {}),
        });
        break;
      }
      case "usage":
        sawUsage = true;
        input.onUsage({ inputTokens: event.inputTokens, outputTokens: event.outputTokens });
        yield { type: "usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        break;
      case "error": {
        if (isRateLimitMessage(event.message)) {
          noteRateLimited(provider.id, input.model);
          recordFailure(provider.id, input.model);
          if (!turn.rateLimitRetried) {
            turn.rateLimitRetried = true;
            const consecutive = getConsecutiveRateLimitCount(provider.id, input.model);
            rateLimitRetry = rateLimitRetrySeconds(event.message, consecutive);
            break;
          }
        }
        yield { type: "error", message: event.message };
        return null;
      }
      case "turn_end":
        stopReason = event.stopReason;
        break;
    }
  }

  return { textParts, toolCalls, stopReason, rateLimitRetry, sawUsage };
}
