import type { ToolDefinition } from "../tools/types.js";
import { canonicalInputHash } from "./canonical.js";
import type { TurnState } from "./turnState.js";

export interface AccumulatedToolCall {
  id: string;
  name: string;
  input: unknown;
  providerMetadata?: Record<string, unknown>;
}

export interface PreparedCall {
  call: AccumulatedToolCall;
  def: ToolDefinition | undefined;
  key: string;
  refused: boolean;
  loopWarn: boolean;
  repeatWarn: boolean;
}

/**
 * Loop-guard classification. Stateless — all mutation goes through TurnState
 * in DECLARED call order (sorting/deduping here would break F5 replay and
 * the consecutive-streak semantics the A4 tests pin).
 */
export class LoopGuard {
  static classify(
    calls: AccumulatedToolCall[],
    toolDefs: ToolDefinition[],
    turn: TurnState
  ): PreparedCall[] {
    return calls.map((call) => {
      const def = toolDefs.find((d) => d.name === call.name);
      const key = `${call.name}:${canonicalInputHash(call.input)}`;
      const verdict = turn.observeKey(key);
      return { call, def, key, ...verdict };
    });
  }

  static warnText(toolName: string, kind: "consecutive" | "non-consecutive"): string {
    return kind === "consecutive"
      ? `[Loop guard] ${toolName} was repeated 3 times without progress. Stop repeating it and try a different approach.`
      : `[Loop guard] ${toolName} was repeated 3 times this turn (with other calls in between) without progress. Stop repeating it and try a different approach.`;
  }

  static refusedResult(): { output: { error: string }; isError: true; summary: string } {
    return {
      output: { error: "Repeated identical call blocked by loop guard." },
      isError: true,
      summary: "Repeated identical call blocked by loop guard.",
    };
  }
}
