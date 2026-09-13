import { ToolDefinition, ToolExecutionResult, ToolSessionContext } from "./types.js";
import { runSubAgentLive, MAX_DELEGATIONS_PER_TURN } from "../agent/subagent.js";
import type { ModelProvider } from "../providers/types.js";
import type { PermissionBroker } from "../agent/types.js";

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

export async function execute(input: unknown): Promise<ToolExecutionResult> {
  const task = (input as { task?: unknown } | undefined)?.task;
  if (typeof task !== "string" || !task.trim()) {
    return {
      output: { error: "delegate_task requires a string `task`." },
      isError: true,
      summary: "delegate_task: task must be a string.",
    };
  }
  return {
    output: { error: "delegate_task requires an active AgentSession execution context." },
    isError: true,
    summary: "delegate_task outside session context.",
  };
}

export async function* executeSession(
  input: unknown,
  ctx: ToolSessionContext,
  inputKey: string
): AsyncGenerator<any, ToolExecutionResult> {
  const task = (input as { task?: unknown } | undefined)?.task;
  if (ctx.allowDelegation === false) {
    ctx.recordLedger({
      eventType: "tool_finished",
      tool: "delegate_task",
      inputHash: inputKey,
      outcome: "error",
      elapsedMs: 0,
    });
    return {
      output: { error: "delegate_task is not available to sub-agents (depth limit)." },
      isError: true,
      summary: "Delegation not allowed at this depth.",
    };
  }
  if (typeof task !== "string" || !task.trim()) {
    ctx.recordLedger({
      eventType: "tool_finished",
      tool: "delegate_task",
      inputHash: inputKey,
      outcome: "error",
      elapsedMs: 0,
    });
    return {
      output: { error: "delegate_task requires a string `task`." },
      isError: true,
      summary: "delegate_task: task must be a string.",
    };
  }
  if (!ctx.tryConsumeDelegation(MAX_DELEGATIONS_PER_TURN)) {
    ctx.recordLedger({
      eventType: "tool_finished",
      tool: "delegate_task",
      inputHash: inputKey,
      outcome: "error",
      elapsedMs: 0,
    });
    return {
      output: { error: `Delegation limit reached (${MAX_DELEGATIONS_PER_TURN} per turn).` },
      isError: true,
      summary: "Delegation limit reached.",
    };
  }
  ctx.recordLedger({
    eventType: "subagent_started",
    tool: "delegate_task",
    inputHash: inputKey,
    outcome: "ok",
    elapsedMs: 0,
  });
  yield { type: "subagent_started", task };
  const subStartedAt = Date.now();
  const subGen = runSubAgentLive({
    provider: ctx.provider as ModelProvider,
    model: ctx.model,
    projectRoot: ctx.projectRoot,
    permissionBroker: ctx.permissionBroker as PermissionBroker,
    task,
    signal: ctx.signal,
    tools: ctx.tools as ToolDefinition[],
  });
  let subStep = await subGen.next();
  while (!subStep.done) {
    yield subStep.value;
    subStep = await subGen.next();
  }
  const run = subStep.value;
  if (run.aborted) {
    if (ctx.mergeSubCheckpoints) {
      await ctx.mergeSubCheckpoints(run.checkpoints);
    }
    ctx.recordLedger({
      eventType: "cancelled",
      tool: "delegate_task",
      inputHash: inputKey,
      outcome: "aborted",
      elapsedMs: Date.now() - subStartedAt,
    });
    yield { type: "cancelled" };
    return {
      output: { error: "aborted" },
      isError: true,
      summary: "Sub-agent aborted.",
    };
  }
  if (ctx.mergeSubCheckpoints) {
    await ctx.mergeSubCheckpoints(run.checkpoints);
  }
  if (run.checkpoints.length > 0 && ctx.recordMutation) {
    ctx.recordMutation();
  }
  ctx.recordLedger({
    eventType: "subagent_finished",
    tool: "delegate_task",
    inputHash: inputKey,
    outcome: "ok",
    tokens: run.usage,
    elapsedMs: Date.now() - subStartedAt,
  });
  yield {
    type: "subagent_finished",
    toolCalls: run.toolCalls,
    inputTokens: run.usage.in,
    outputTokens: run.usage.out,
    report: run.report,
  };
  const subFailed = Boolean(run.failureReason);
  return {
    output: subFailed
      ? { report: run.report, error: run.failureReason }
      : { report: run.report },
    isError: subFailed,
    summary: subFailed
      ? `Sub-agent crashed after ${run.toolCalls} tool call${run.toolCalls === 1 ? "" : "s"}: ${run.failureReason}`
      : `Sub-agent report (${run.toolCalls} tool call${run.toolCalls === 1 ? "" : "s"}).`,
  };
}