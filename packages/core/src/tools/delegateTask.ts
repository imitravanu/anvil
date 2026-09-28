import { ToolDefinition, ToolExecutionResult, ToolSessionContext } from "./types.js";
import { runSubAgentLive, MAX_DELEGATIONS_PER_TURN, capReport } from "../agent/subagent.js";
import { runTeam } from "../agent/team/index.js";
import { TEAM_DEFAULT_ITERATIONS } from "../config/constants.js";
import type {
  TeamSpec,
  TeamMemberSpec,
  TeamMemberResult,
  TeamRunnerDeps,
  TeamMemberEvent,
  TeamRunResult,
} from "../agent/team/types.js";
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

    // Phase 34/35 — per-TOOL live streaming across members. Every event a
    // member's sub-session emits (progress, checkpoints) is queued here the
    // moment it happens, so member B's activity interleaves with member A's
    // tool-by-tool progress instead of arriving in per-member batches. The
    // runner emits lifecycle transitions from its own sequencing; this adapter
    // owns the queue. Failure semantics are unchanged: a failed member's events
    // have already streamed, its failureReason still lands in the tool result,
    // and member_failed guarantees a terminating event so no stream hangs.
    const pending: AgentEvent[] = [];
    const memberTaskById = new Map(spec.members.map((m) => [m.id, m.task]));
    // The pipeline strategy starts member N only after member N-1's runMember
    // resolves, i.e. after its finish has been queued. A runner that awaited
    // the consumer instead of queueing would deadlock on handoff; the queue
    // never blocks the emitter.
    let settled = false;
    let wake: (() => void) | null = null;
    const onMemberEvent: TeamRunnerDeps["onMemberEvent"] = (memberId, event) => {
      if (event.type === "member_started") {
        pending.push({ type: "subagent_started", task: memberTaskById.get(memberId) ?? "" });
      } else if (event.type === "member_failed") {
        // The adapter threw before its own subagent_finished (e.g. a provider
        // error outside the sub-session's catch). Mirror the runner's report
        // convention so the member's stream still terminates.
        pending.push({
          type: "subagent_finished",
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          report: `member failed: ${event.reason}`,
        });
      }
      // member_finished needs no event: the adapter queued the real
      // subagent_finished with actual stats before returning.
      wake?.();
    };
    const waitForEvent = (): Promise<void> => new Promise((resolve) => { wake = resolve; });
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
      ctx.recordLedger({
        eventType: "subagent_started",
        tool: "delegate_task",
        inputHash: inputKey,
        outcome: "ok",
        elapsedMs: 0,
      });
      // subagent_started is emitted by the runner's member_started transition
      // (see onMemberEvent); buffering one here would duplicate it.
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
        // Live per-tool streaming: queue immediately instead of buffering until
        // the member finishes.
        pending.push(step.value);
        wake?.();
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
      pending.push({
        type: "subagent_finished",
        toolCalls: run.toolCalls,
        inputTokens: run.usage.in,
        outputTokens: run.usage.out,
        report: capReport(run.report),
      });
      wake?.();
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

    const deps: TeamRunnerDeps = { projectRoot: ctx.projectRoot, runMember: runMemberAdapter, onMemberEvent };
    let settledResult: TeamRunResult | undefined;
    let settledError: unknown;
    const runPromise = runTeam(spec, deps, ctx.signal).then(
      (result) => {
        settledResult = result;
        settled = true;
        wake?.();
        return result;
      },
      (err: unknown) => {
        settledError = err;
        settled = true;
        wake?.();
        throw err;
      }
    );
    // Drain between generator suspensions: events surface as members
    // transition rather than after the whole team settles. The loop exits only
    // once the run has settled AND every buffered event has been yielded.
    while (!(settled && pending.length === 0)) {
      const ev = pending.shift();
      if (ev) {
        yield ev;
      } else {
        await waitForEvent();
      }
    }
    const result = await runPromise;
    if (settledError !== undefined) throw settledError;
    ctx.onTeamRunResult?.(result);
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
