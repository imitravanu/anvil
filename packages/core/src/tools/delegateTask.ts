import { ToolDefinition, ToolExecutionResult } from "./types.js";

/**
 * Delegation tool. The AgentSession intercepts delegate_task before
 * the generic executor and runs a sub-agent; this executor is a defensive
 * no-op for direct executeTool calls.
 */
export const definition: ToolDefinition = {
  name: "delegate_task",
  description:
    "Delegate a self-contained sub-task to a sub-agent (same model, fresh context, its own " +
    "step budget) and receive its final report. Use for repo-wide research or multi-step " +
    "investigations whose intermediate output would clutter this conversation. The sub-agent " +
    "cannot delegate further and asks no questions — give a complete, self-sufficient task " +
    "description including any file paths or constraints you already know.",
  inputSchema: {
    type: "object",
    properties: { task: { type: "string" } },
    required: ["task"],
  },
  mutating: false,
};

export async function execute(): Promise<ToolExecutionResult> {
  return {
    output: { error: "delegate_task must be handled by the agent session." },
    isError: true,
    summary: "delegate_task outside session context.",
  };
}