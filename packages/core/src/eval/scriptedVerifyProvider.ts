import type { CompletionRequest, ModelProvider, StreamEvent } from "../providers/types.js";

/**
 * Phase 38.8 — VERIFY-REPAIR SCRIPTED PROVIDER
 *
 * The eval lane ships `autoVerify: false` on purpose (a repair loop changes the
 * trajectory and can mask the failure a task asserts — PHASE-38-ROADMAP.md §4).
 * The cost of that choice was asserted, never measured: does the omission hide
 * failures the shipping agent would have repaired?
 *
 * This provider makes the measurement deterministic. Its script has exactly two
 * acts:
 *
 * 1. The first attempt writes a BUGGY implementation and declares done.
 * 2. The repair attempt — reachable ONLY when the session's turn verifier ran,
 *    found the failure, and pushed the automated repair prompt into history —
 *    writes the fix.
 *
 * Act 2 refuses to proceed unless the verification feedback is present in the
 * request history: a "repair" that happens without the verifier having run
 * would be magic, and a measurement built on magic is the failure mode this
 * phase exists to eliminate.
 */
export interface VerifyRepairScript {
  /** Files the FIRST attempt writes — the state a verify-off run is graded on. */
  buggyFiles: Array<{ path: string; content: string }>;
  /** Files the REPAIR attempt writes — only reachable when autoVerify runs. */
  fixedFiles: Array<{ path: string; content: string }>;
}

/** The marker turnVerifier.ts puts at the head of every automated repair prompt. */
export const VERIFY_REPAIR_FEEDBACK_MARKER = "[Automated Test Verification Failed]";

export function createVerifyRepairProvider(script: VerifyRepairScript): ModelProvider {
  let callSeq = 0;
  let buggyWritten = false;
  let fixedWritten = false;
  return {
    id: "openai",
    displayName: "Anvil Eval Scripted Verify-Repair Provider",
    isConfigured: () => true,
    async *streamCompletion(request: CompletionRequest): AsyncGenerator<StreamEvent> {
      const emitWrites = function* (files: Array<{ path: string; content: string }>) {
        for (const { path: relPath, content } of files) {
          const inputObj = { path: relPath, content };
          // Deterministic ids, same convention as the eval mock provider.
          const callId = `call_${++callSeq}`;
          yield { type: "tool_call_start", id: callId, name: "write_file" } as StreamEvent;
          yield { type: "tool_call_delta", id: callId, cumulativeInputJson: JSON.stringify(inputObj) } as StreamEvent;
          yield { type: "tool_call_end", id: callId, name: "write_file", input: inputObj } as StreamEvent;
        }
      };

      if (!buggyWritten) {
        // Act 1: write the bug. Ends tool_use so the session dispatches the
        // writes, exactly as a real model's edit turn does.
        buggyWritten = true;
        yield { type: "text_delta", text: "Writing the implementation." };
        yield* emitWrites(script.buggyFiles);
        yield { type: "usage", inputTokens: 250, outputTokens: 75 };
        yield { type: "turn_end", stopReason: "tool_use" };
        return;
      }

      const sawFeedback = request.messages.some(
        (m) =>
          m.role === "user" &&
          m.content.some(
            (c) => c.type === "text" && c.text.includes(VERIFY_REPAIR_FEEDBACK_MARKER)
          )
      );

      if (sawFeedback && !fixedWritten) {
        // Act 2: the fix is reachable ONLY through verification feedback. A
        // "repair" without the marker in history would be magic, and a
        // measurement built on magic is the failure mode this phase exists to
        // eliminate — so there is no branch that writes the fix without it.
        fixedWritten = true;
        yield { type: "text_delta", text: "Applying the fix from the test failure." };
        yield* emitWrites(script.fixedFiles);
        yield { type: "usage", inputTokens: 400, outputTokens: 75 };
        yield { type: "turn_end", stopReason: "tool_use" };
        return;
      }

      yield { type: "text_delta", text: "Done." };
      yield { type: "usage", inputTokens: 300, outputTokens: 20 };
      yield { type: "turn_end", stopReason: "end_turn" };
    },
  };
}
