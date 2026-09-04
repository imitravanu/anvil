import { ToolExecutionResult } from "../tools/types.js";

// The core loop never touches a terminal or a UI framework directly. It asks this interface
// whenever a mutating tool is about to run, and the TUI (Phase 4) implements it with a real
// confirmation prompt. A test harness can implement it as "always approve" or "always deny."
export interface PermissionBroker {
  requestPermission(toolName: string, summary: string): Promise<boolean>;
}

export const AUTO_APPROVE_BROKER: PermissionBroker = {
  async requestPermission() {
    return true;
  },
};

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; id: string; name: string; input: unknown }
  | { type: "tool_permission_denied"; id: string; name: string }
  | { type: "tool_finished"; id: string; name: string; result: ToolExecutionResult }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "compacted"; summary: string }
  | { type: "turn_complete" }
  | { type: "cancelled" }
  | { type: "error"; message: string }
  // Phase 8 (A.1): the truthful engine — budget, loop guard, plan scratchpad.
  | { type: "budget_exhausted" }
  | { type: "loop_detected"; tool: string }
  | { type: "plan_updated"; plan: string };

export interface AgentOptions {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  projectRoot: string;
  permissionBroker: PermissionBroker;
  /** Phase 8 (A.1.1): max tool-roundtrips per user turn. Default 20. */
  maxInnerIterations?: number;
}

/** Phase 8 (A.1.1): when maxInnerIterations is not set. */
export const DEFAULT_MAX_INNER_ITERATIONS = 20;
