/**
 * Phase 25.2 — Multi-Agent Collaboration (Agent Teams).
 * Shared filesystem, independent histories. Strategies: parallel, pipeline, review.
 */

export type TeamStrategy = "parallel" | "pipeline" | "review";

export interface TeamMemberSpec {
  /** Stable id within the team (e.g. "feature", "tests", "review"). */
  id: string;
  /** The one task this member owns. */
  task: string;
  /** Optional per-member iteration budget override. */
  maxInnerIterations?: number;
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
}
