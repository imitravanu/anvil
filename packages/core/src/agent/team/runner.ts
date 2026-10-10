import { getErrorMessage } from "../../errors.js";
import { TEAM_DEFAULT_ITERATIONS, TEAM_MAX_AGENTS, TEAM_MAX_TOTAL_ITERATIONS, MEMBER_TASK_MAX_CHARS, SUB_AGENT_REPORT_MAX_CHARS } from "../../config/constants.js";
import { instrumentRunner, isTeamStrategy, TEAM_STRATEGIES } from "./types.js";
import { headChars } from "../../text.js";
import type { TeamMemberResult, TeamMemberSpec, TeamRunnerDeps, TeamRunResult, TeamSpec } from "./types.js";

/**
 * Phase 25.2 — AgentTeam orchestrator.
 * Pure coordination: budget splitting, strategy fan-out, report merging.
 * Tool execution lives in the injected runMember (session-owned AgentSession).
 */
export function splitBudget(spec: TeamSpec): number[] {
  const count = spec.members.length;
  if (count === 0) return [];
  const total = spec.totalIterations ?? count * TEAM_DEFAULT_ITERATIONS;
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return spec.members.map((_, i) => base + (i < remainder ? 1 : 0));
}

export function validateTeamSpec(spec: TeamSpec): string | null {
  // C9: reject an unknown strategy loudly. Without this, any non-"parallel"/
  // "review" string fell through to the serial pipeline branch below — a
  // typo silently changed the team's execution model.
  if (!isTeamStrategy(spec.strategy)) {
    return `unknown strategy: ${String(spec.strategy)} (expected: ${TEAM_STRATEGIES.join(", ")})`;
  }
  if (spec.members.length === 0) return "team needs at least one member";
  if (spec.members.length > TEAM_MAX_AGENTS) {
    return `team exceeds max agents (${TEAM_MAX_AGENTS})`;
  }
  // An unbounded, zero, or fractional budget either starves members at zero
  // shares or runs away — validate loudly instead of silently mis-splitting.
  if (spec.totalIterations !== undefined) {
    if (!Number.isInteger(spec.totalIterations)) return "totalIterations must be an integer";
    if (spec.totalIterations < spec.members.length) {
      return `totalIterations (${spec.totalIterations}) must cover at least one share per member (${spec.members.length})`;
    }
    if (spec.totalIterations > TEAM_MAX_TOTAL_ITERATIONS) {
      return `totalIterations (${spec.totalIterations}) exceeds the runaway cap (${TEAM_MAX_TOTAL_ITERATIONS})`;
    }
  }
  const ids = new Set<string>();
  for (const m of spec.members) {
    if (!m.id || m.id.trim().length === 0) return "member id must be non-empty";
    if (ids.has(m.id)) return `duplicate member id: ${m.id}`;
    ids.add(m.id);
    if (!m.task || m.task.trim().length === 0) return `member ${m.id} needs a task`;
    if (m.task.length > MEMBER_TASK_MAX_CHARS) {
      return `member ${m.id} task is ${m.task.length} chars (cap ${MEMBER_TASK_MAX_CHARS})`;
    }
  }
  if (spec.strategy === "pipeline" && spec.members.length < 2) {
    return "pipeline strategy needs at least two members (handoff chain)";
  }
  if (spec.strategy === "review" && spec.members.length !== 2) {
    return "review strategy needs exactly two members (worker + reviewer)";
  }
  return null;
}

function mergeReports(results: TeamMemberResult[]): string {
  const parts = results.map((r) => `## ${r.id}\n${r.report}`);
  const combined = parts.join("\n\n");
  // headChars, not slice: the merged report rides back to the model, and a cap
  // landing mid-surrogate-pair would hand it a lone surrogate (see text.ts).
  const head = headChars(combined, SUB_AGENT_REPORT_MAX_CHARS);
  if (head === combined) return combined;
  return head + "\n[team report truncated]";
}

export async function runTeam(spec: TeamSpec, deps: TeamRunnerDeps, signal: AbortSignal): Promise<TeamRunResult> {
  const invalid = validateTeamSpec(spec);
  if (invalid) {
    throw new Error(`Invalid team spec: ${invalid}`);
  }
  const budgets = splitBudget(spec);
  const members: TeamMemberResult[] = [];
  // Lifecycle events fire inside the runner's own sequencing (parallel fan-out,
  // pipeline handoff), not after the whole team settles. With no listener this
  // is the identity wrapper — zero behavior change for existing callers.
  const instrumented = instrumentRunner(deps);

  if (spec.strategy === "review") {
    // Takeover 2026-10-10: review is SEQUENTIAL by definition — the reviewer
    // judges work that has already happened. The first cut reused the parallel
    // fan-out, so the reviewer started at the same instant as the worker and
    // reviewed an untouched workspace; the in-code justification ("references
    // the worker's scope by id") cannot work concurrently. The handoff mirrors
    // pipeline's: each later member receives its predecessor's report as
    // "Work to review". Budgets and merging are unchanged.
    const settled: TeamMemberResult[] = [];
    for (let i = 0; i < spec.members.length; i++) {
      const member = spec.members[i];
      if (signal.aborted) {
        settled.push({
          id: member.id,
          report: "aborted before start",
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          aborted: true,
        });
        continue;
      }
      const prior = settled[settled.length - 1];
      const handoff: TeamMemberSpec =
        prior !== undefined
          ? { ...member, task: `${member.task}\n\nWork to review (report from ${prior.id}):\n${prior.report}` }
          : member;
      try {
        const result = await instrumented.runMember(handoff, budgets[i] ?? TEAM_DEFAULT_ITERATIONS, signal);
        settled.push(result);
      } catch (err: unknown) {
        settled.push({
          id: member.id,
          report: `member failed: ${getErrorMessage(err)}`,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          aborted: false,
          failureReason: getErrorMessage(err),
        });
      }
    }
    members.push(...settled);
  } else if (spec.strategy === "parallel") {
    // Parallel fan-out: independent histories, shared filesystem.
    const settled = await Promise.all(
      spec.members.map(async (member: TeamMemberSpec, i: number): Promise<TeamMemberResult> => {
        if (signal.aborted) {
          return {
            id: member.id,
            report: "aborted before start",
            toolCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            aborted: true,
          };
        }
        try {
          return await instrumented.runMember(member, budgets[i] ?? TEAM_DEFAULT_ITERATIONS, signal);
        } catch (err: unknown) {
          return {
            id: member.id,
            report: `member failed: ${getErrorMessage(err)}`,
            toolCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            aborted: false,
            failureReason: getErrorMessage(err),
          };
        }
      })
    );
    members.push(...settled);
  } else {
    // Pipeline: serial handoff — each member sees prior reports in its task.
    let prior = "";
    for (let i = 0; i < spec.members.length; i++) {
      const member = spec.members[i];
      if (signal.aborted) {
        members.push({
          id: member.id,
          report: "aborted before start",
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          aborted: true,
        });
        continue;
      }
      const handoff: TeamMemberSpec =
        prior.length > 0 ? { ...member, task: `${member.task}\n\nPrior work:\n${prior}` } : member;
      try {
        const result = await instrumented.runMember(handoff, budgets[i] ?? TEAM_DEFAULT_ITERATIONS, signal);
        members.push(result);
        prior = result.report;
      } catch (err: unknown) {
        const failed: TeamMemberResult = {
          id: member.id,
          report: `member failed: ${getErrorMessage(err)}`,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          aborted: false,
          failureReason: getErrorMessage(err),
        };
        members.push(failed);
        prior = failed.report;
      }
    }
  }

  return {
    strategy: spec.strategy,
    members,
    combinedReport: mergeReports(members),
    totalToolCalls: members.reduce((n, m) => n + m.toolCalls, 0),
    totalInputTokens: members.reduce((n, m) => n + m.inputTokens, 0),
    totalOutputTokens: members.reduce((n, m) => n + m.outputTokens, 0),
  };
}
