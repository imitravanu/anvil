export interface GitContext {
  branch: string;
  clean: boolean;
  modifiedFiles: string[];
}

export interface EcosystemContext {
  type: "node" | "rust" | "go" | "python" | "generic";
  packageManager?: string;
  testScript?: string;
  buildScript?: string;
}

export interface SituationalContext {
  projectRoot: string;
  projectName: string;
  git?: GitContext;
  ecosystem: EcosystemContext;
  projectRules?: {
    source: string;
    content: string;
  };
  topLevelEntries: string[];
  summary: string;
}

export type MilestoneStatus = "pending" | "in_progress" | "completed" | "failed";

export interface GoalMilestone {
  id: string;
  title: string;
  criteria: string;
  status: MilestoneStatus;
  summary?: string;
}

export interface GoalRunResult {
  goal: string;
  success: boolean;
  milestones: GoalMilestone[];
  totalTurns: number;
  filesChanged: string[];
  summary: string;
  criticVerdict?: string;
}

export type GoalEvent =
  | { type: "awareness_ready"; context: SituationalContext }
  | { type: "plan_decomposed"; milestones: GoalMilestone[] }
  | { type: "milestone_started"; milestone: GoalMilestone }
  | { type: "milestone_progress"; milestone: GoalMilestone; detail: string }
  | { type: "milestone_completed"; milestone: GoalMilestone; summary: string }
  | { type: "milestone_failed"; milestone: GoalMilestone; error: string }
  | { type: "critique_started" }
  | { type: "critique_result"; verdict: string }
  | { type: "goal_completed"; result: GoalRunResult }
  | { type: "goal_failed"; error: string };
