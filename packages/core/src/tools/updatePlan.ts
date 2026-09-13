import { ToolDefinition, ToolExecutionResult, ToolSessionContext } from "./types.js";

/**
 * Plan scratchpad tool. Validates plan format and provides both standalone
 * execution and session-connected execution.
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

export async function execute(input: unknown): Promise<ToolExecutionResult> {
  const plan = (input as { plan?: unknown } | undefined)?.plan;
  if (typeof plan !== "string" || !plan.trim()) {
    return {
      output: { error: "update_plan requires a string `plan`." },
      isError: true,
      summary: "update_plan: plan must be a string.",
    };
  }
  return { output: { ok: true, plan }, isError: false, summary: "Plan recorded." };
}

export async function* executeSession(
  input: unknown,
  ctx: ToolSessionContext,
  inputKey: string
): AsyncGenerator<any, ToolExecutionResult> {
  const plan = (input as { plan?: unknown } | undefined)?.plan;
  if (typeof plan !== "string" || !plan.trim()) {
    ctx.recordLedger({
      eventType: "tool_finished",
      tool: "update_plan",
      inputHash: inputKey,
      outcome: "error",
      elapsedMs: 0,
    });
    return {
      output: { error: "update_plan requires a string `plan`." },
      isError: true,
      summary: "update_plan: plan must be a string.",
    };
  }
  ctx.setPlan?.(plan);
  ctx.recordLedger({
    eventType: "plan_updated",
    tool: "update_plan",
    inputHash: inputKey,
    outcome: "ok",
    elapsedMs: 0,
  });
  yield { type: "plan_updated", plan };
  return { output: { ok: true }, isError: false, summary: "Plan updated." };
}