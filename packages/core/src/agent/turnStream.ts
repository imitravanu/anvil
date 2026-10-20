/**
 * One assistant turn: call the provider, accumulate text + tool calls, and
 * surface the terminal facts the turn loop needs. Extracted from
 * AgentSession.send() so the streaming contract (partial tool-call assembly,
 * rate-limit retry, usage accounting) lives on its own and can be tested
 * without a whole session.
 */

import type {
  ModelProvider,
  ConversationMessage,
  StreamEvent,
} from "../providers/types.js";
import {
  getConsecutiveRateLimitCount,
  isQuotaExhaustedMessage,
  isRateLimitMessage,
  noteRateLimited,
  rateLimitRetrySeconds,
  recordFailure,
} from "../providers/freeModels.js";
import type { ToolDefinition } from "../tools/types.js";
import { parseToolCallJson } from "../providers/streaming.js";
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
  onUsage: (usage: UsageTotals) => void;
}

/**
 * Token accounting for one round. `outputTokens` is the number the session
 * budgets and compacts against, so it must be the provider's TOTAL output
 * including reasoning — see the Gemini adapter, where `thoughtsTokenCount` is
 * reported OUTSIDE `candidatesTokenCount` and therefore has to be added in.
 * `reasoningTokens` / `cachedInputTokens` are breakdowns of those two figures,
 * never additions, and stay undefined when the provider does not report them.
 */
export type UsageTotals = Extract<StreamEvent, { type: "usage" }>;

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
    // Phase 38.7 — the system prompt + tool schemas are byte-identical across
    // turns (the 4,177-token static prefix, Probe M). Ask the provider to cache
    // that prefix so it stops being priced as fresh input every round. Adapters
    // that cannot express a breakpoint (Gemini: below the implicit-cache floor)
    // ignore the flag; OpenAI/OpenRouter already cache automatically.
    cacheControl: true,
  });

  const textParts: string[] = [];
  const toolCalls: AccumulatedToolCall[] = [];
  const openCalls = new Map<string, { name: string; inputJson: string }>();
  let stopReason: string | undefined;
  let rateLimitRetry: number | null = null;
  let sawUsage = false;

  for await (const event of stream) {
    if (controller.signal.aborted && event.type !== "usage") {
      yield { type: "cancelled" };
      return null;
    }
    switch (event.type) {
      case "text_delta":
        textParts.push(event.text);
        yield { type: "text_delta", text: event.text };
        break;
      case "reasoning_delta":
        // Phase 38.6 — forwarded so a consumer can show it, and deliberately
        // NOT pushed into `textParts`: reasoning is not the assistant's answer,
        // and replaying it as message content would corrupt history.
        yield { type: "reasoning_delta", text: event.text };
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
          // Deltas accumulate as raw JSON; a malformed buffer is recorded as the
          // shared sentinel rather than thrown, so the turn reports the failure.
          parsed = parseToolCallJson(open?.inputJson ?? "");
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
        input.onUsage(event);
        yield event;
        break;
      case "error": {
        // A8's structured origin, carried instead of dropped: the provider
        // already classified this error (`code` on the StreamEvent); re-yielding
        // a bare message forced every consumer — the eval harness above all —
        // to guess the failure's origin from prose.
        const asAgentError = {
          type: "error" as const,
          message: event.message,
          ...(event.code !== undefined
            ? { failureKind: event.code === "NETWORK_TIMEOUT" ? ("network" as const) : ("provider" as const) }
            : {}),
        };
        // 2026-10-10: overload is availability weather — it trips the breaker
        // exactly like a rate limit (the session's thrown-error path agrees).
        if (event.code === "SERVER_OVERLOADED") recordFailure(provider.id, input.model);
        if (isRateLimitMessage(event.message)) {
          noteRateLimited(provider.id, input.model);
          recordFailure(provider.id, input.model);
          if (isQuotaExhaustedMessage(event.message)) {
            // A daily/account cap cannot be waited out — retrying in 20-120s
            // cannot succeed, and the futile wait burned whole turn budgets
            // (observed as 120s stalls with zero tool calls). Health is
            // recorded above; the provider's own message is the honest report.
            yield asAgentError;
            return null;
          }
          if (!turn.rateLimitRetried) {
            turn.rateLimitRetried = true;
            const consecutive = getConsecutiveRateLimitCount(provider.id, input.model);
            rateLimitRetry = rateLimitRetrySeconds(event.message, consecutive);
            break;
          }
        }
        yield asAgentError;
        return null;
      }
      case "turn_end":
        stopReason = event.stopReason;
        break;
    }
  }

  if (controller.signal.aborted) {
    yield { type: "cancelled" };
    return null;
  }

  // A FIRST-round empty (no text, no tool calls, no retry) would otherwise
  // close silently: pushAssistant records nothing and finishTurn still reports
  // turn_complete. Surface it as an error so the turn reads as failed, not
  // done. Scoped to the first round only — empty follow-up rounds after tool
  // calls are normal completion ("nothing further to add").
  if (
    textParts.length === 0 &&
    toolCalls.length === 0 &&
    rateLimitRetry === null &&
    turn.iterationsUsed === 0
  ) {
    stopReason = "error";
  }

  return { textParts, toolCalls, stopReason, rateLimitRetry, sawUsage };
}
