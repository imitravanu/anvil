import { getErrorMessage } from "../../errors.js";
import { TEAM_DEFAULT_ITERATIONS, TEAM_MAX_AGENTS, SUB_AGENT_REPORT_MAX_CHARS } from "../../config/constants.js";
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
  if (spec.members.length === 0) return "team needs at least one member";
  if (spec.members.length > TEAM_MAX_AGENTS) {
    return `team exceeds max agents (${TEAM_MAX_AGENTS})`;
  }
  const ids = new Set<string>();
  for (const m of spec.members) {
    if (!m.id || m.id.trim().length === 0) return "member id must be non-empty";
    if (ids.has(m.id)) return `duplicate member id: ${m.id}`;
    ids.add(m.id);
    if (!m.task || m.task.trim().length === 0) return `member ${m.id} needs a task`;
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
  if (combined.length <= SUB_AGENT_REPORT_MAX_CHARS) return combined;
  return combined.slice(0, SUB_AGENT_REPORT_MAX_CHARS) + "\n[team report truncated]";
}

export async function runTeam(spec: TeamSpec, deps: TeamRunnerDeps, signal: AbortSignal): Promise<TeamRunResult> {
  const invalid = validateTeamSpec(spec);
  if (invalid) {
    throw new Error(`Invalid team spec: ${invalid}`);
  }
  const budgets = splitBudget(spec);
  const members: TeamMemberResult[] = [];

  if (spec.strategy === "parallel" || spec.strategy === "review") {
    // Parallel fan-out: independent histories, shared filesystem.
    // Review uses the same fan-out; the reviewer task references the
    // worker's scope by id (inter-agent messaging via task text).
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
          return await deps.runMember(member, budgets[i] ?? TEAM_DEFAULT_ITERATIONS, signal);
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
        const result = await deps.runMember(handoff, budgets[i] ?? TEAM_DEFAULT_ITERATIONS, signal);
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
