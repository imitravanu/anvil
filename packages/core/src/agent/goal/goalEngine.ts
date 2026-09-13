import {
  GoalMilestone,
  GoalRunResult,
  GoalEvent,
  SituationalContext,
} from "./types.js";
import { analyzeWorkspace } from "./awareness.js";
import { AgentSession } from "../session.js";
import { AgentOptions } from "../types.js";
import { ModelProvider } from "../../providers/types.js";
import { buildSystemPrompt } from "../../config/rules.js";
import { TOOL_DEFINITIONS } from "../../tools/index.js";
import { autoCommitMilestone } from "../../git/gitUtils.js";

export const MAX_GOAL_TURNS = 10;

const GOAL_AGENT_SYSTEM_PROMPT =
  "You are Anvil's Autonomous Mission Operator. You are given a high-level engineering goal. " +
  "You must pursue this goal with deep situational awareness, multi-step planning, and rigorous verification. " +
  "Work methodically through each milestone: inspect existing code, apply precise edits, verify tests, " +
  "and maintain architectural integrity. Be concise, direct, and factual.";

/**
 * Outcome signals of one mission turn — the evidence milestone completion is
 * judged on.
 */
export interface GoalTurnOutcome {
  text: string;
  errored: boolean;
  verificationFailed: boolean;
  permissionDenied: boolean;
  cancelled: boolean;
}

/**
 * Runs one mission turn over the host (a session the caller owns). Yields
 * progress events while the turn runs and returns the turn's outcome.
 * `milestone` is the active milestone (null for planning/critique turns) —
 * hosts may use it to attribute progress.
 */
export type GoalTurnRunner = (
  prompt: string,
  milestone: GoalMilestone | null
) => AsyncGenerator<GoalEvent, GoalTurnOutcome, unknown>;

export interface GoalMissionDeps {
  projectRoot: string;
  sendTurn: GoalTurnRunner;
  summarizeChanges(): Promise<{ path: string }[]>;
  autoCommit?: boolean;
}


function emptyOutcome(): GoalTurnOutcome {
  return { text: "", errored: false, verificationFailed: false, permissionDenied: false, cancelled: false };
}

/**
 * Parse milestone JSON or fall back to a deterministic plan scaled to the
 * goal: a short, single-action goal gets ONE milestone; only broad goals
 * earn the 3-phase plan.
 */
export function parseMilestones(rawText: string, goal: string): GoalMilestone[] {
  try {
    // Fenced JSON first — models wrap arrays in ```json fences more often
    // than not, and the greedy fallback below can span prose if two arrays
    // or an example appear in the reply.
    const fenced = rawText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    const jsonMatch = fenced?.[1] ?? rawText.match(/\[\s*\{[\s\S]*\}\s*\]/)?.[0];
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((m: any, idx: number) => ({
          id: String(m.id ?? idx + 1),
          title: String(m.title ?? `Milestone ${idx + 1}`),
          criteria: String(m.criteria ?? "Milestone completion criteria"),
          status: "pending" as const,
        }));
      }
    }
  } catch {
    // fallback below
  }

  const ACTION_VERBS =
    /\b(create|add|fix|refactor|update|remove|delete|implement|migrate|write|rewrite|extract|split|rename|move|port|replace)\b/gi;
  const verbCount = goal.match(ACTION_VERBS)?.length ?? 0;
  if (verbCount <= 1 && goal.length < 120) {
    return [
      {
        id: "1",
        title: goal.length <= 60 ? goal : `${goal.slice(0, 57)}...`,
        criteria: goal,
        status: "pending",
      },
    ];
  }

  return [
    {
      id: "1",
      title: "Reconnaissance & Architecture Investigation",
      criteria: "Identify relevant files, interfaces, and dependencies for the goal.",
      status: "pending",
    },
    {
      id: "2",
      title: "Core Implementation & Refactoring",
      criteria: "Implement required functionality or fixes with precise file edits.",
      status: "pending",
    },
    {
      id: "3",
      title: "Verification & Regression Testing",
      criteria: "Ensure tests pass and code satisfies all acceptance criteria.",
      status: "pending",
    },
  ];
}

export interface GoalEngineOptions {
  provider: ModelProvider;
  model: string;
  projectRoot: string;
  permissionBroker: AgentOptions["permissionBroker"];
  maxTurns?: number;
  tools?: AgentOptions["tools"];
  autoVerify?: boolean | string;
  autoCommit?: boolean;
}


/**
 * The mission protocol: awareness → decomposition → evidence-gated milestone
 * execution → adversarial critique → debrief. Host-agnostic: the caller
 * supplies the turn runner, so the same mission drives a headless session or
 * the TUI's live session (where tool cards render in the transcript).
 */
export async function* runGoalMission(
  goal: string,
  deps: GoalMissionDeps,
  maxTurns: number = MAX_GOAL_TURNS
): AsyncGenerator<GoalEvent, GoalRunResult> {
  // 1. Situational Awareness & Environment Introspection
  const context: SituationalContext = await analyzeWorkspace(deps.projectRoot);
  yield { type: "awareness_ready", context };

  // 2. Goal Decomposition
  const planningPrompt =
    `Current Situational Context: ${context.summary}\n\n` +
    `High-Level Goal: "${goal}"\n\n` +
    `Decompose this goal into 2 to 4 sequential, verifiable milestones. ` +
    `Respond with ONLY a JSON array — no prose, no markdown fences — of objects with keys: id (string), title (string), criteria (string).`;

  const planning = yield* deps.sendTurn(planningPrompt, null);
  // Cancel/error on the planning turn must fail the mission — falling
  // through would run parseMilestones on an empty text (deterministic
  // fallback plan) and burn the whole turn budget against a dead provider.
  if (planning.cancelled) {
    yield { type: "goal_failed", error: "Mission cancelled." };
    return {
      goal,
      success: false,
      milestones: [],
      totalTurns: 1,
      filesChanged: [],
      summary: "Mission cancelled during planning.",
    };
  }
  if (planning.errored) {
    yield { type: "goal_failed", error: "Planning turn failed; mission aborted." };
    return {
      goal,
      success: false,
      milestones: [],
      totalTurns: 1,
      filesChanged: [],
      summary: "Mission aborted: the planning turn errored.",
    };
  }
  const milestones = parseMilestones(planning.text, goal);
  yield { type: "plan_decomposed", milestones };

  let totalTurns = 1;

  // 3. Autonomous Milestone Execution Loop — completion is EVIDENCE-GATED:
  // a milestone only passes when its turn finished cleanly, verification
  // (when it ran) passed, and no tool was permission-denied. Failed
  // milestones do NOT abort the mission; they are reported and the run
  // concludes unsuccessful if any remain failed.
  let budgetExhausted = false;
  let activeMilestone: GoalMilestone | null = null;
  for (const milestone of milestones) {
    if (totalTurns >= maxTurns) {
      // Never attempted → stays "pending" (not failed); the debrief says why.
      budgetExhausted = true;
      continue;
    }

    milestone.status = "in_progress";
    activeMilestone = milestone;
    yield { type: "milestone_started", milestone };

    const milestonePrompt =
      `Focusing on Milestone ${milestone.id}: "${milestone.title}"\n` +
      `Criteria to satisfy: ${milestone.criteria}\n` +
      `Execute necessary tools (read, outline, edit, write, test) autonomously to fulfill this milestone.`;

    totalTurns += 1;
    const outcome = yield* deps.sendTurn(milestonePrompt, milestone);

    if (outcome.cancelled) {
      yield { type: "goal_failed", error: "Mission cancelled." };
      return {
        goal,
        success: false,
        milestones,
        totalTurns,
        filesChanged: [],
        summary: `Mission cancelled during milestone ${milestone.id}.`,
      };
    }

    if (outcome.permissionDenied) {
      // Autonomous execution cannot proceed past a consent wall.
      milestone.status = "failed";
      milestone.summary = "A required tool was refused (permissions). Goal mode needs consent for mutating tools.";
      yield { type: "milestone_failed", milestone, error: "Tool permission denied" };
      yield {
        type: "goal_failed",
        error:
          "A mutating tool was refused during the mission. " +
          "In non-interactive mode, rerun with -y / --yes; in the TUI, approve the prompt.",
      };
      return {
        goal,
        success: false,
        milestones,
        totalTurns,
        filesChanged: [],
        summary: `Mission aborted: permissions refused at milestone ${milestone.id}.`,
      };
    }

    if (outcome.errored || outcome.verificationFailed) {
      milestone.status = "failed";
      milestone.summary = (outcome.text || "Milestone turn failed").slice(0, 300);
      yield {
        type: "milestone_failed",
        milestone,
        error: outcome.verificationFailed
          ? "Automated test verification failed after repair attempts"
          : "Turn ended with an error",
      };
      continue;
    }

    // Per-milestone adversarial review against the milestone's own criteria.
    const review = yield* deps.sendTurn(
      `Adversarial review of Milestone ${milestone.id}: "${milestone.title}".\n` +
        `Criteria: ${milestone.criteria}\n` +
        `Your report: ${outcome.text.slice(0, 2000)}\n` +
        `Answer with exactly YES or NO followed by " — " and a one-line reason.`,
      milestone
    );
    const reviewVerdict = review.text.trim();
    // Accept any response starting with YES, rejecting hedges like "Yes, but..."
    const startsYes = /^YES\b/i.test(reviewVerdict);
    const isHedge = /^YES\s*[,]\s*(but|however|although|except|unfortunately)/i.test(reviewVerdict);
    const satisfied = startsYes && !isHedge;
    totalTurns += 1;

    if (review.cancelled) {
      yield { type: "goal_failed", error: "Mission cancelled." };
      return {
        goal,
        success: false,
        milestones,
        totalTurns,
        filesChanged: [],
        summary: `Mission cancelled during milestone ${milestone.id} review.`,
      };
    }

    if (!satisfied) {
      milestone.status = "failed";
      milestone.summary = reviewVerdict.slice(0, 300) || "Self-review could not confirm the criteria.";
      yield { type: "milestone_failed", milestone, error: "Self-review rejected completion" };
      continue;
    }

    milestone.status = "completed";
    milestone.summary = (reviewVerdict.replace(/^YES\s*—?\s*/i, "") || outcome.text).slice(0, 300);

    if (deps.autoCommit) {
      // Commit ONLY what this session touched (the /diff baseline): an
      // untracked .env or unrelated worktree change must never be swept in.
      let touched: string[] = [];
      try {
        touched = (await deps.summarizeChanges()).map((c) => c.path);
      } catch {
        touched = [];
      }
      if (touched.length === 0) {
        yield {
          type: "milestone_progress",
          milestone,
          detail: `Skipped auto-commit for milestone ${milestone.id}: no session-touched files.`,
        };
      } else {
        const commitRes = await autoCommitMilestone(deps.projectRoot, milestone.id, milestone.title, touched);
        if (commitRes.committed && commitRes.hash) {
          yield {
            type: "milestone_progress",
            milestone,
            detail: `Committed milestone ${milestone.id}: ${commitRes.hash}`,
          };
        }
      }
    }

    yield {
      type: "milestone_completed",
      milestone,
      summary: milestone.summary,
    };
  }

  // 4. Final Adversarial Self-Critique (overall mission)
  yield { type: "critique_started" };
  const critiquePrompt =
    `Perform an adversarial self-review of all changes made during this goal run. ` +
    `Check for edge cases, security regressions, missing error handling, and verify if goal "${goal}" is completely fulfilled. Be critical and honest. Be concise (max 5 sentences).`;
  const critique = yield* deps.sendTurn(critiquePrompt, null);
  let criticVerdict = critique.text.trim();
  if (!criticVerdict && !critique.cancelled) {
    // The critique turn sometimes ends in tool calls with no prose (seen
    // live). Re-ask once; if still empty, state that honestly.
    const retry = yield* deps.sendTurn(
      `State your adversarial review verdict for goal "${goal}" in plain sentences now. Do not use tools.`,
      null
    );
    criticVerdict = retry.text.trim();
  }
  if (!criticVerdict) {
    criticVerdict = critique.cancelled
      ? "Mission cancelled before the critic could finish."
      : "The critic produced no verdict text; treat the run with suspicion and inspect the diffs manually.";
  }
  totalTurns += 1;
  yield { type: "critique_result", verdict: criticVerdict };

  // 5. Final Mission Debriefing
  const changes = await deps.summarizeChanges();
  const filesChanged = changes.map((c) => c.path);
  const allCompleted = milestones.every((m) => m.status === "completed");
  const completedCount = milestones.filter((m) => m.status === "completed").length;
  const budgetNote = budgetExhausted
    ? ` The turn budget (${maxTurns}) ran out before every milestone could be attempted.`
    : "";

  const result: GoalRunResult = {
    goal,
    success: allCompleted,
    milestones,
    totalTurns,
    filesChanged,
    summary: `Autonomous mission "${goal}" concluded across ${totalTurns} turns with ${completedCount}/${milestones.length} milestones completed.${budgetNote}`,
    criticVerdict,
  };

  yield { type: "goal_completed", result };
  return result;
}

export class GoalEngine {
  private readonly session: AgentSession;
  private readonly maxTurns: number;
  private readonly autoCommit: boolean;

  constructor(options: GoalEngineOptions) {
    this.maxTurns = options.maxTurns ?? MAX_GOAL_TURNS;
    this.autoCommit = options.autoCommit ?? false;
    const basePrompt = buildSystemPrompt(GOAL_AGENT_SYSTEM_PROMPT, options.projectRoot);
    this.session = new AgentSession(options.provider, {
      systemPrompt: basePrompt,
      model: options.model,
      maxTokens: 4096,
      projectRoot: options.projectRoot,
      permissionBroker: options.permissionBroker,
      tools: options.tools ?? TOOL_DEFINITIONS,
      autoVerify: options.autoVerify ?? true,
    });
  }

  /** Cancel the running mission turn/session. */
  cancel(): void {
    this.session.cancel();
  }

  /**
   * Run the complete autonomous goal lifecycle over this engine's own
   * (headless) session.
   */
  run(goal: string): AsyncGenerator<GoalEvent, GoalRunResult> {
    return runGoalMission(goal, {
      projectRoot: this.session.projectRoot,
      summarizeChanges: () => this.session.summarizeChanges(),
      sendTurn: (prompt, milestone) => this.sendTurn(prompt, milestone),
      autoCommit: this.autoCommit,
    }, this.maxTurns);
  }

  private async *sendTurn(
    prompt: string,
    milestone: GoalMilestone | null
  ): AsyncGenerator<GoalEvent, GoalTurnOutcome, unknown> {
    const outcome = emptyOutcome();
    for await (const event of this.session.send(prompt)) {
      if (event.type === "text_delta") {
        outcome.text += event.text;
      } else if (event.type === "verification_result") {
        if (!event.passed) outcome.verificationFailed = true;
        if (milestone) {
          yield {
            type: "milestone_progress",
            milestone,
            detail: event.passed ? "Automated verification passed." : "Automated verification FAILED.",
          };
        }
      } else if (event.type === "verification_started") {
        if (milestone) {
          yield { type: "milestone_progress", milestone, detail: "Running automated test verification..." };
        }
      } else if (event.type === "verification_gave_up") {
        // Verification abandoned mid-mission: tests were last seen failing.
        // A milestone ending this turn must not claim success, and the deck
        // must say why.
        outcome.verificationFailed = true;
        if (milestone) {
          yield {
            type: "milestone_progress",
            milestone,
            detail: "Automated verification gave up after its repair budget — tests may still be failing.",
          };
        }
      } else if (event.type === "tool_started") {
        if (milestone) {
          yield { type: "milestone_progress", milestone, detail: `Running ${event.name}...` };
        }
      } else if (event.type === "tool_permission_denied") {
        outcome.permissionDenied = true;
      } else if (event.type === "error") {
        outcome.errored = true;
      } else if (event.type === "cancelled") {
        outcome.cancelled = true;
      }
    }
    return outcome;
  }
}
