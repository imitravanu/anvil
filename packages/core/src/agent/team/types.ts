/**
 * Phase 25.2 — Multi-Agent Collaboration (Agent Teams).
 * Shared filesystem, independent histories. Strategies: parallel, pipeline, review.
 */

import { getErrorMessage } from "../../errors.js";

export type TeamStrategy = "parallel" | "pipeline" | "review";

/** The only strategy values `runTeam` understands, in one place (C9). */
export const TEAM_STRATEGIES: readonly TeamStrategy[] = ["parallel", "pipeline", "review"];

/**
 * Runtime guard for a value arriving as `unknown` (tool input, JSON). A
 * `typeof x === "string"` check is NOT enough: an unknown strategy used to be
 * cast straight to `TeamStrategy` and then silently ran the pipeline branch,
 * because `runTeam` only special-cases "parallel"/"review" and falls through
 * for everything else. Callers must reject unknown values instead of casting.
 */
export function isTeamStrategy(value: unknown): value is TeamStrategy {
  return typeof value === "string" && (TEAM_STRATEGIES as readonly string[]).includes(value);
}

export interface TeamMemberSpec {
  /** Stable id within the team (e.g. "feature", "tests", "review"). */
  id: string;
  /** The one task this member owns. */
  task: string;
}

export interface TeamSpec {
  strategy: TeamStrategy;
  members: TeamMemberSpec[];
  /** Total iteration budget split across members (default: members * TEAM_DEFAULT_ITERATIONS). */
  totalIterations?: number;
}

export interface TeamMemberResult {
  id: string;
  report: string;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  aborted: boolean;
  failureReason?: string;
}

export interface TeamRunResult {
  strategy: TeamStrategy;
  members: TeamMemberResult[];
  /** Combined report: concatenated member reports (capped by caller). */
  combinedReport: string;
  totalToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface TeamRunnerDeps {
  projectRoot: string;
  /** Runs one member task; provided by session layer (real AgentSession) or tests (fake). */
  runMember: (spec: TeamMemberSpec, budget: number, signal: AbortSignal) => Promise<TeamMemberResult>;
  /**
   * Optional per-member lifecycle events. Absent for existing callers (tests,
   * mocks) — the runner treats it as fire-and-forget and never awaits it, so
   * adding it cannot change runTeam's own sequencing. This is the seam that
   * makes cross-member streaming additive rather than a protocol change.
   */
  onMemberEvent?: (memberId: string, event: TeamMemberEvent) => void;
}

/** Coarse member lifecycle, emitted by the runner as transitions happen. */
export type TeamMemberEvent =
  | { type: "member_started"; memberId: string }
  | { type: "member_finished"; memberId: string; failed: boolean; aborted: boolean }
  | { type: "member_failed"; memberId: string; reason: string };

/**
 * Wraps `runMember` so lifecycle events fire around it, in the runner's own
 * sequencing — parallel fan-out, pipeline handoff, aborts — instead of after the
 * whole team has settled. The delegated work (and its failure modes) stays
 * exactly the caller's; only the timing of the announcement changes.
 */
export function instrumentRunner(deps: TeamRunnerDeps): TeamRunnerDeps {
  if (!deps.onMemberEvent) return deps;
  const emit = deps.onMemberEvent;
  const runMember: TeamRunnerDeps["runMember"] = async (member, budget, signal) => {
    emit(member.id, { type: "member_started", memberId: member.id });
    try {
      const result = await deps.runMember(member, budget, signal);
      emit(member.id, {
        type: "member_finished",
        memberId: member.id,
        failed: result.failureReason !== undefined,
        aborted: result.aborted,
      });
      return result;
    } catch (err: unknown) {
      const reason = getErrorMessage(err);
      emit(member.id, { type: "member_failed", memberId: member.id, reason });
      throw err;
    }
  };
  return { ...deps, runMember };
}
