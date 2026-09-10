import type { ModelProvider, CompletionRequest, StreamEvent, ProviderId } from "../providers/types.js";
import type { TestCriterion } from "./types.js";

export interface MockCertProviderOptions {
  failCriteria?: Set<TestCriterion>;
  isConfigured?: boolean;
}

/**
 * Creates an in-memory mock provider tailored for testing the certification harness.
 * Responds deterministically to streaming, tool calling, multi-turn context, and error tests.
 */
export function createMockCertificationProvider(
  providerId: ProviderId,
  options: MockCertProviderOptions = {}
): ModelProvider {
  const failCriteria = options.failCriteria ?? new Set<TestCriterion>();
  const isConfigured = options.isConfigured ?? true;

  return {
    id: providerId,
    displayName: "Mock " + providerId.toUpperCase(),
    isConfigured: () => isConfigured,

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<StreamEvent> {
      // 1. Error path test: deterministic 404 on invalid model
      if (request.model.includes("invalid-model") || request.model.includes("404")) {
        if (failCriteria.has("errorPath")) {
          throw new Error("Simulated unhandled provider crash on 404");
        }
        yield {
          type: "error",
          message: "Model not found: 404 " + request.model + " is not a valid model ID",
        };
        return;
      }

      // Check last message
      const lastMsg = request.messages[request.messages.length - 1];
      const hasToolResult = lastMsg?.content.some((c) => c.type === "tool_result");

      // 2. Tool result round-trip (turn 2 of tool test)
      if (hasToolResult) {
        yield { type: "text_delta", text: "Tool round-trip completed successfully. Received result." };
        yield { type: "usage", inputTokens: 40, outputTokens: 12 };
        yield { type: "turn_end", stopReason: "end_turn" };
        return;
      }

      // 3. Tool call generation (turn 1 of tool test)
      const hasToolPing = request.tools.some((t) => t.name === "test_ping");
      if (hasToolPing) {
        if (failCriteria.has("toolCalls")) {
          // Failed tool call: just yields text without triggering tool
          yield { type: "text_delta", text: "I cannot call tools right now." };
          yield { type: "turn_end", stopReason: "end_turn" };
          return;
        }

        const callId = "call_cert_ping_001";
        yield { type: "tool_call_start", id: callId, name: "test_ping" };
        yield {
          type: "tool_call_delta",
          id: callId,
          cumulativeInputJson: JSON.stringify({ message: "anvil_tool_ok" }),
        };
        yield {
          type: "tool_call_end",
          id: callId,
          name: "test_ping",
          input: { message: "anvil_tool_ok" },
        };
        yield { type: "usage", inputTokens: 50, outputTokens: 25 };
        yield { type: "turn_end", stopReason: "tool_use" };
        return;
      }

      // 4. Multi-turn memory test
      const allText = request.messages
        .flatMap((m) => m.content)
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(" ");

      if (allText.includes("secret code word")) {
        if (failCriteria.has("multiTurn")) {
          yield { type: "text_delta", text: "I do not recall any secret code." };
          yield { type: "turn_end", stopReason: "end_turn" };
          return;
        }

        if (allText.includes("PHOENIX_774")) {
          yield { type: "text_delta", text: "The secret code word is PHOENIX_774." };
        } else {
          yield { type: "text_delta", text: "Code word acknowledged." };
        }
        yield { type: "usage", inputTokens: 80, outputTokens: 15 };
        yield { type: "turn_end", stopReason: "end_turn" };
        return;
      }

      // 5. Standard streaming text test
      if (failCriteria.has("streaming")) {
        yield { type: "usage", inputTokens: 20, outputTokens: 0 };
        yield { type: "turn_end", stopReason: "end_turn" };
        return;
      }

      yield { type: "text_delta", text: "ANVIL_" };
      yield { type: "text_delta", text: "STREAMING_" };
      yield { type: "text_delta", text: "CERTIFIED" };
      yield { type: "usage", inputTokens: 25, outputTokens: 10 };
      yield { type: "turn_end", stopReason: "end_turn" };
    },
  };
}
