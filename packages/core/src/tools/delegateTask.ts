import { ToolDefinition, ToolExecutionResult, ToolSessionContext } from "./types.js";
import { runSubAgentLive, MAX_DELEGATIONS_PER_TURN, capReport } from "../agent/subagent.js";
import { runTeam } from "../agent/team/index.js";
import { TEAM_DEFAULT_ITERATIONS } from "../config/constants.js";
import type { TeamSpec, TeamMemberSpec, TeamMemberResult, TeamRunnerDeps } from "../agent/team/types.js";
import type { AgentEvent } from "../agent/types.js";

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
    properties: {
      task: { type: "string" },
      // Phase 25.2: optional team spec. When present (with strategy + members
      // carrying {id, task}), the call routes through runTeam instead of a
      // single sub-agent. Omit for normal single-task delegation.
      team: {
        type: "object",
        properties: {
          strategy: { type: "string", enum: ["parallel", "pipeline", "review"] },
          members: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                task: { type: "string" },
              },
              required: ["id", "task"],
            },
          },
        },
      },
    },
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
): AsyncGenerator<AgentEvent, ToolExecutionResult> {
  const raw = input as { task?: unknown; team?: unknown };
  // Phase 25.2 → product: a `team` field on delegate_task routes through the
  // real runTeam orchestrator. Members run as sub-agents (runSubAgentLive) so
  // they share the permission broker, signal, and checkpoint-rewinding — the
  // same path a single delegation takes.
  const teamSpec = raw.team as
    | { strategy?: string; members?: { id?: string; task?: string; maxInnerIterations?: unknown }[]; totalIterations?: unknown }
    | undefined;
  const isTeamRun =
    ctx.allowDelegation !== false &&
    teamSpec != null &&
    typeof teamSpec === "object" &&
    typeof teamSpec.strategy === "string" &&
    Array.isArray(teamSpec.members) &&
    teamSpec.members.length > 0 &&
    teamSpec.members.every(
      (m) => typeof m === "object" && typeof m.id === "string" && typeof m.task === "string"
    );

  if (isTeamRun) {
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

  const spec: TeamSpec = {
    strategy: teamSpec!.strategy as TeamSpec["strategy"],
    members: teamSpec!.members!.map((m) => ({ id: m!.id!, task: m!.task! })),
  };
  if (typeof teamSpec!.totalIterations === "number") {
    spec.totalIterations = teamSpec!.totalIterations;
  }
  // Per-member override: the model may tune one member's depth. Clamped to the
  // [1, total] range in runMemberAdapter so it can never exceed the whole team
  // budget or drop below one iteration.
  const memberOverrides = new Map<string, number>();
  if (Array.isArray(teamSpec!.members)) {
    for (const m of teamSpec!.members) {
      if (m && typeof m === "object" && typeof m.id === "string" && typeof m.maxInnerIterations === "number") {
        memberOverrides.set(m.id, m.maxInnerIterations);
      }
    }
  }

    // runTeam awaits runMember per-strategy. To surface subagent_started /
    // subagent_finished events in this turn's stream, runMember collects the
    // events it would have yielded and stashes them; executeSession drains any
    // collected events per member after runTeam resolves. Tradeoff: cross-
    // member streaming isn't live — the parent still sees each member's
    // start and finish in order.
    const collected: Map<string, AgentEvent[]> = new Map();
    // Enforce the budget the team runner computed: the sub-session is created
    // with exactly the passed iteration cap, so splitBudget is a real bound,
    // not a decorative number. A per-member override clamps to [1, total].
    const totalBudget = spec.totalIterations ?? spec.members.length * TEAM_DEFAULT_ITERATIONS;
    const runMemberAdapter = async (
      member: TeamMemberSpec,
      budget: number,
      signal: AbortSignal
    ): Promise<TeamMemberResult> => {
      const override = memberOverrides.get(member.id);
      const effectiveBudget = Math.max(1, Math.min(override ?? budget, totalBudget));
      const events: AgentEvent[] = [];
      ctx.recordLedger({
        eventType: "subagent_started",
        tool: "delegate_task",
        inputHash: inputKey,
        outcome: "ok",
        elapsedMs: 0,
      });
      events.push({ type: "subagent_started", task: member.task });
      const startedAt = Date.now();
      const gen = runSubAgentLive({
        provider: ctx.provider,
        model: ctx.model,
        projectRoot: ctx.projectRoot,
        permissionBroker: ctx.permissionBroker,
      task: member.task,
      signal,
      maxInnerIterations: effectiveBudget,
      tools: [...ctx.tools],
      ...(ctx.guardian === undefined ? {} : { guardian: ctx.guardian }),
    });
      let step = await gen.next();
      while (!step.done) {
        events.push(step.value);
        step = await gen.next();
      }
      const run = step.value;
      if (ctx.mergeSubCheckpoints && run.checkpoints.length > 0) {
        await ctx.mergeSubCheckpoints(run.checkpoints);
      }
      if (run.checkpoints.length > 0 && ctx.recordMutation) ctx.recordMutation();
      ctx.recordLedger({
        eventType: run.aborted ? "cancelled" : "subagent_finished",
        tool: "delegate_task",
        inputHash: inputKey,
        outcome: run.aborted ? "aborted" : run.failureReason ? "error" : "ok",
        elapsedMs: Date.now() - startedAt,
      });
      events.push({
        type: "subagent_finished",
        toolCalls: run.toolCalls,
        inputTokens: run.usage.in,
        outputTokens: run.usage.out,
        report: capReport(run.report),
      });
      collected.set(member.id, events);
      return {
        id: member.id,
        report: capReport(run.report),
        toolCalls: run.toolCalls,
        inputTokens: run.usage.in,
        outputTokens: run.usage.out,
        aborted: run.aborted,
        ...(run.failureReason ? { failureReason: run.failureReason } : {}),
      };
    };

    const deps: TeamRunnerDeps = { projectRoot: ctx.projectRoot, runMember: runMemberAdapter };
    const result = await runTeam(spec, deps, ctx.signal);
    ctx.onTeamRunResult?.(result);
    for (const member of result.members) {
      const evs = collected.get(member.id);
      if (evs) for (const ev of evs) yield ev;
    }
    return {
      output: { report: result.combinedReport, members: result.members },
      isError: result.members.some((m) => m.failureReason !== undefined),
      summary: `Team (${result.strategy}) ${result.members.length} member(s), ${result.totalToolCalls} tool call(s).`,
    };
  }

  const task = typeof raw.task === "string" ? raw.task : undefined;
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
    provider: ctx.provider,
    model: ctx.model,
    projectRoot: ctx.projectRoot,
    permissionBroker: ctx.permissionBroker,
    task,
    signal: ctx.signal,
    tools: [...ctx.tools],
    ...(ctx.guardian === undefined ? {} : { guardian: ctx.guardian }),
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
