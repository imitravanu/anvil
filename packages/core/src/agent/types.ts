import { ToolExecutionResult } from "../tools/types.js";
import type { ToolDefinition } from "../tools/types.js";

// The core loop never touches a terminal or a UI framework directly. It asks this interface
// whenever a mutating tool is about to run, and the TUI implements it with a real
// confirmation prompt. A test harness can implement it as "always approve" or "always deny."
export interface PermissionBroker {
  requestPermission(toolName: string, summary: string): Promise<boolean>;
  /** Optional: attach an AbortSignal to cancel pending permission prompts on abort. */
  attachAbortSignal?(signal: AbortSignal): void;
  /** Optional: release a signal attached above. Called when the batch settles. */
  detachAbortSignal?(signal: AbortSignal): void;
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
  // Rate limit hit mid-turn: the session waits out the retry window (once
  // per turn) and re-issues the request automatically.
  | { type: "rate_limit_wait"; seconds: number }
  // the truthful engine — budget, loop guard, plan scratchpad.
  | { type: "budget_exhausted" }
  | { type: "loop_detected"; tool: string }
  | { type: "plan_updated"; plan: string }
  // sub-agent delegation (finished carries the capped report).
  | { type: "subagent_started"; task: string }
  | { type: "subagent_finished"; toolCalls: number; inputTokens: number; outputTokens: number; report: string }
  // live delegation progress: the tool the sub-agent is using right now
  | { type: "subagent_progress"; tool: string; detail: string }
  // Rewind: pre-mutation file snapshot taken this turn.
  | { type: "checkpoint"; id: number; files: number }
  // Closed-loop TDD auto-verification
  | { type: "verification_started"; command: string }
  | { type: "verification_result"; passed: boolean; summary: string }
  // Verification skipped because the per-turn repair budget is exhausted —
  // tests may STILL be failing. Honest signaling: consumers must not claim
  // pass/fail, they report "verification stopped repairing".
  | { type: "verification_gave_up"; command: string };

export interface AgentOptions {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  projectRoot: string;
  permissionBroker: PermissionBroker;
  /** max tool-roundtrips per user turn. Default 20. */
  maxInnerIterations?: number;
  /**
   * Tool-list override. Sub-agents exclude delegate_task (depth
   * limit); MCP will inject external tools through this seam.
   * Defaults to the full global TOOL_DEFINITIONS.
   */
  tools?: ToolDefinition[];
  /**
   * Delegation depth guard. False inside sub-agents — a misbehaving
   * model's delegate_task call is refused instead of nesting. Default true.
   */
  allowDelegation?: boolean;
  /**
   * Closed-loop verification command (e.g. "npm test") or true to auto-detect.
   * When enabled, mutations trigger automated test verification with self-repair before turn completion.
   */
  autoVerify?: boolean | string;
  /** Optional designated summarizer model for compaction. */
  compactionModel?: string;
}

/** Default inner iteration budget applied when maxInnerIterations is not set. */
export { DEFAULT_MAX_INNER_ITERATIONS } from "../config/constants.js";
