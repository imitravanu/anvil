import { ToolDefinition, ToolExecutionResult } from "./types.js";

/**
 * : the plan scratchpad tool. Defined here so models see it in
 * TOOL_DEFINITIONS and so it NEVER enters the permission path (non-mutating).
 * The AgentSession intercepts update_plan before the generic executor so it can
 * set session.plan and emit the plan_updated event; this executor is a safe
 * no-op fallback for direct executeTool calls.
 */
export const definition: ToolDefinition = {
  name: "update_plan",
  description:
    "Record your current plan and next steps. The plan is shown to the user. " +
    "Call when starting, when a step fails, or when the plan changes. Be concise.",
  inputSchema: {
    type: "object",
    properties: { plan: { type: "string" } },
    required: ["plan"],
  },
  mutating: false,
};

export async function execute(): Promise<ToolExecutionResult> {
  return { output: { ok: true }, isError: false, summary: "Plan recorded." };
}