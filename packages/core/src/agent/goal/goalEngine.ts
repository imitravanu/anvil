import {
  GoalMilestone,
  GoalRunResult,
  GoalEvent,
  SituationalContext,
} from "./types.js";
import { analyzeWorkspace } from "./awareness.js";
import { AgentSession } from "../session.js";
import { AgentOptions, type AgentEvent } from "../types.js";
import { ModelProvider } from "../../providers/types.js";
import { buildSystemPrompt } from "../../config/rules.js";
import { TOOL_DEFINITIONS } from "../../tools/index.js";
import { autoCommitMilestone } from "../../git/gitUtils.js";
import { getErrorMessage } from "../../errors.js";

// Centralized in config/constants (§2.4); re-exported so the public API is unchanged.
import {
  MAX_GOAL_TURNS,
  GOAL_REPORT_EXCERPT_CHARS,
  GOAL_MILESTONE_SUMMARY_MAX_CHARS,
  GOAL_SHORT_GOAL_MAX_CHARS,
  GOAL_TITLE_ELLIPSIS_KEEP,
  GOAL_TITLE_MAX_CHARS,
  DEFAULT_MAX_TOKENS,
} from "../../config/constants.js";
export { MAX_GOAL_TURNS };

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
 * Cap on milestones accepted from one plan. The prompt asks for 2–4; a runaway
 * list would flood the mission deck and queue turns no one reviewed. Extra
 * entries are dropped — the mission still runs on the first (highest-priority)
 * ones rather than refusing the whole plan.
 */
const MAX_PARSED_MILESTONES = 8;

/**
 * Fold one session event into a mission turn's outcome — the single owner of
 * the event→outcome rule, shared by GoalEngine's turn runner and the TUI's
 * live-session runner. The two hand-rolled copies HAD diverged: the TUI never
 * counted `verification_gave_up` as a failure (so a milestone could be marked
 * complete on a turn whose tests were still failing), and it let an early
 * failure stick past a successful repair. Verdicts are last-wins where the
 * engine can revise them — `verification_result` reports the FINAL probe, so a
 * repaired turn clears the failure; `verification_gave_up` is terminal.
 */
export function accumulateGoalOutcome(outcome: GoalTurnOutcome, event: AgentEvent): void {
  switch (event.type) {
    case "text_delta":
      outcome.text += event.text;
      break;
    case "verification_result":
      outcome.verificationFailed = !event.passed;
      break;
    case "verification_gave_up":
      outcome.verificationFailed = true;
      break;
    case "tool_permission_denied":
      outcome.permissionDenied = true;
      break;
    case "error":
      outcome.errored = true;
      break;
    case "cancelled":
      outcome.cancelled = true;
      break;
    default:
      break;
  }
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
 * First COMPLETE JSON array in `rawText`, scanned with a string-aware bracket
 * counter. The greedy regex this replaced matched from the first `[` to the
 * LAST `]` in the reply, so any array mentioned after the plan (an example,
 * "options: [...]") merged into one unparseable blob and a valid plan was
 * silently thrown away for the deterministic fallback. Returns null when
 * nothing parseable is found; the fallback owns that case. Pure.
 */
function extractJsonArray(rawText: string): unknown[] | null {
  for (let start = rawText.indexOf("["); start !== -1; start = rawText.indexOf("[", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let ended = false;
    for (let i = start; i < rawText.length; i++) {
      const ch = rawText[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "[") depth += 1;
      else if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          ended = true;
          try {
            const parsed: unknown = JSON.parse(rawText.slice(start, i + 1));
            if (Array.isArray(parsed)) return parsed;
          } catch {
            // Not JSON (prose brackets, a truncated example) — try the next '['.
          }
          break;
        }
      }
    }
    // Ran past the end without closing: no complete array can follow either.
    if (!ended && depth > 0) return null;
  }
  return null;
}

/**
 * Validate and normalize model-supplied milestone rows. The old mapping
 * fabricated `Milestone N` / `"Milestone completion criteria"` for anything
 * shaped wrong, so an empty object became an executable milestone with invented
 * criteria. A row without a usable title is dropped instead; ids are made
 * unique (the plan deck and plan updates address milestones by id, so a
 * duplicate would move two rows at once). Null when nothing is usable.
 */
function normalizeMilestones(parsed: readonly unknown[]): GoalMilestone[] | null {
  const out: GoalMilestone[] = [];
  const seenIds = new Set<string>();
  for (const row of parsed) {
    if (out.length >= MAX_PARSED_MILESTONES) break;
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (!title) continue;
    const criteria =
      typeof rec.criteria === "string" && rec.criteria.trim().length > 0 ? rec.criteria.trim() : title;
    const rawId = typeof rec.id === "string" ? rec.id.trim() : "";
    let id = rawId.length > 0 ? rawId : String(out.length + 1);
    if (seenIds.has(id)) id = `${id}-${out.length + 1}`;
    seenIds.add(id);
    out.push({ id, title, criteria, status: "pending" });
  }
  return out.length > 0 ? out : null;
}

/**
 * Parse milestone JSON or fall back to a deterministic plan scaled to the
 * goal: a short, single-action goal gets ONE milestone; only broad goals
 * earn the 3-phase plan.
 */
export function parseMilestones(rawText: string, goal: string): GoalMilestone[] {
  const parsed = extractJsonArray(rawText);
  if (parsed) {
    const normalized = normalizeMilestones(parsed);
    if (normalized) return normalized;
  }

  const ACTION_VERBS =
    /\b(create|add|fix|refactor|update|remove|delete|implement|migrate|write|rewrite|extract|split|rename|move|port|replace)\b/gi;
  const verbCount = goal.match(ACTION_VERBS)?.length ?? 0;
  if (verbCount <= 1 && goal.length < GOAL_SHORT_GOAL_MAX_CHARS) {
    return [
      {
        id: "1",
        title: goal.length <= GOAL_TITLE_MAX_CHARS ? goal : `${goal.slice(0, GOAL_TITLE_ELLIPSIS_KEEP)}...`,
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

/**
 * Whether an adversarial milestone review's verdict counts as satisfied.
 *
 * Any response starting with YES is accepted, but a hedge is not: "Yes, but the
 * criteria were not met" is a NO wearing a YES, and reading it as satisfaction
 * is how a mission marks itself complete on criteria it never met. The
 * separator before the hedge word is ANY run of whitespace/punctuation —
 * C2/AUDIT-2026-09-30: the comma-only rule read the engine's OWN prompted form
 * ("YES — however …", see the review prompt below) as satisfaction. Pure, so
 * the verdict rule is testable without driving a whole mission through the
 * engine.
 */
/**
 * A negation bound to the WORK verb it negates — `did not verify`, `not done`,
 * `criteria not met`, `nothing was verified`. Decisive wherever it appears:
 * negating the work is itself the defect, unlike a negation of a defect term
 * (`no failing tests`). The window is short (<=3 words) so a negated defect can
 * still be described in a longer clause without tripping it.
 */
const VERDICT_WORK_NEGATION_RE =
  /\b(?:not|never|nothing|none|didn['\u2019]?t|did\s+not|doesn['\u2019]?t|does\s+not|isn['\u2019]?t|aren['\u2019]?t|wasn['\u2019]?t|weren['\u2019]?t|cannot|can['\u2019]?t|unable)\b(?:\s+\w+){0,3}\s+(?:verif\w*|test\w*|confirm\w*|check\w*|complet\w*|done|met|pass\w*|finish\w*|satisf\w*|prove\w*|validat\w*|run)\b/i;

/**
 * Defect nouns/verbs — decisive only inside a clause with no negator, so a
 * negated mention (`no failing tests`, `zero errors`, `nothing missing`) reads
 * as the pass it is.
 */
const VERDICT_DEFECT_RE = /\b(?:fail\w*|broken|missing|error\w*|blocked|partial\w*|unmet|incomplete|unfinished)\b/i;

/** Words that make a defect term describe its own ABSENCE. */
const VERDICT_NEGATOR_RE = /\b(?:no|not|never|without|zero|nothing|none|free\s+of|clear\s+of)\b|\bn['\u2019]?t\b/i;

export function isSatisfiedVerdict(verdict: string): boolean {
  const trimmed = verdict.trim();
  const startsYes = /^YES\b/i.test(trimmed);
  const isHedge =
    /^YES\b[\s,;:.!—–-]*(?:but|however|although|except|unfortunately)\b/i.test(trimmed);
  // A YES that later states a defect is still a NO: `YES. The tests fail.` used
  // to be accepted, and the mission marks a milestone complete on this verdict.
  //
  // 2026-10-14: the first attempt at this matched a blunt defect word list
  // ANYWHERE in the response, which rejected 9 of 13 clean positives — `no`,
  // `still`, `yet` and `error` all appear in ordinary satisfied verdicts
  // (`No issues remain`, `Every test still passes`, `Zero errors`). Rejection is
  // not free: the milestone is recorded FAILED and the mission reports
  // `success: false`, with no retry. So the defect must be ASSERTED, not merely
  // mentioned:
  //  - a negation bound to the work verb it negates is decisive on its own
  //    (`did not verify`, `not done`, `criteria not met`);
  //  - a bare defect noun/verb is decisive only in a clause carrying no negator,
  //    so `no failing tests` passes while `the tests fail` does not.
  const statesDefect =
    VERDICT_WORK_NEGATION_RE.test(trimmed) ||
    trimmed.split(/[.;,\n]+/).some((clause) => VERDICT_DEFECT_RE.test(clause) && !VERDICT_NEGATOR_RE.test(clause));
  return startsYes && !isHedge && !statesDefect;
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
  if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new Error("maxTurns must be a positive integer");
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
    yield { type: "goal_failed", error: "Mission cancelled.", cancelled: true };
    return {
      goal,
      success: false,
      cancelled: true,
      milestones: [],
      totalTurns: 1,
      filesChanged: [],
      summary: "Mission cancelled during planning.",
    };
  }
  if (planning.errored || planning.verificationFailed || planning.permissionDenied) {
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
    // Reserve implementation, its review, and the final critique together.
    if (totalTurns + 3 > maxTurns) {
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
      yield { type: "goal_failed", error: "Mission cancelled.", cancelled: true };
      return {
        goal,
        success: false,
        cancelled: true,
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
      milestone.summary = (outcome.text || "Milestone turn failed").slice(0, GOAL_MILESTONE_SUMMARY_MAX_CHARS);
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
        `Your report: ${outcome.text.slice(0, GOAL_REPORT_EXCERPT_CHARS)}\n` +
        `Answer with exactly YES or NO followed by " — " and a one-line reason.`,
      milestone
    );
    const reviewVerdict = review.text.trim();
    const satisfied = isSatisfiedVerdict(review.text);
    totalTurns += 1;

    if (review.cancelled) {
      yield { type: "goal_failed", error: "Mission cancelled.", cancelled: true };
      return {
        goal,
        success: false,
        cancelled: true,
        milestones,
        totalTurns,
        filesChanged: [],
        summary: `Mission cancelled during milestone ${milestone.id} review.`,
      };
    }

    if (review.errored || review.verificationFailed || review.permissionDenied || !satisfied) {
      milestone.status = "failed";
      milestone.summary = review.errored || review.verificationFailed || review.permissionDenied
        ? "Self-review failed or was permission-denied; completion is unverified."
        : reviewVerdict.slice(0, GOAL_MILESTONE_SUMMARY_MAX_CHARS) || "Self-review could not confirm the criteria.";
      yield { type: "milestone_failed", milestone, error: "Self-review rejected completion" };
      if (review.permissionDenied) {
        yield { type: "goal_failed", error: "A required review tool was permission-denied." };
        return { goal, success: false, milestones, totalTurns, filesChanged: [], summary: "Mission aborted: review permissions refused." };
      }
      continue;
    }

    milestone.status = "completed";
    milestone.summary = (reviewVerdict.replace(/^YES\s*—?\s*/i, "") || outcome.text).slice(0, GOAL_MILESTONE_SUMMARY_MAX_CHARS);

    if (deps.autoCommit) {
      // Commit ONLY what this session touched (the /diff baseline): an
      // untracked .env or unrelated worktree change must never be swept in.
      let touched: string[] = [];
      let summarizeError: string | undefined;
      try {
        touched = (await deps.summarizeChanges()).map((c) => c.path);
      } catch (err: unknown) {
        // C16: a failed change-summary is NOT "nothing changed". Swallowing it
        // and then reporting "no session-touched files" blames the session for
        // a summarizer/git failure; surface the real cause instead.
        summarizeError = getErrorMessage(err);
      }
      if (touched.length === 0) {
        yield {
          type: "milestone_progress",
          milestone,
          detail: summarizeError
            ? `Skipped auto-commit for milestone ${milestone.id}: could not summarize session changes (${summarizeError}).`
            : `Skipped auto-commit for milestone ${milestone.id}: no session-touched files.`,
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
  let critique = emptyOutcome();
  if (totalTurns < maxTurns) {
    yield { type: "critique_started" };
    const critiquePrompt =
      `Perform an adversarial self-review of all changes made during this goal run. ` +
      `Check for edge cases, security regressions, missing error handling, and verify if goal "${goal}" is completely fulfilled. Be critical and honest. Be concise (max 5 sentences).`;
    totalTurns += 1;
    critique = yield* deps.sendTurn(critiquePrompt, null);
  }
  let criticVerdict = critique.text.trim();
  // C3/AUDIT-2026-09-30: the cancellation must survive into the result. It
  // used to be read only to pick fallback TEXT, so a mission whose milestones
  // had completed reported success even though the operator stopped it.
  let cancelledAtCritique = critique.cancelled;
  let critiqueFailed = critique.errored || critique.verificationFailed || critique.permissionDenied;
  if (!criticVerdict && !cancelledAtCritique && !critique.permissionDenied && !critique.verificationFailed && totalTurns < maxTurns) {
    // The critique turn sometimes ends in tool calls with no prose (seen
    // live). Re-ask once; if still empty, state that honestly.
    totalTurns += 1;
    const retry = yield* deps.sendTurn(
      `State your adversarial review verdict for goal "${goal}" in plain sentences now. Do not use tools.`,
      null
    );
    criticVerdict = retry.text.trim();
    cancelledAtCritique = retry.cancelled;
    critiqueFailed = retry.errored || retry.verificationFailed || retry.permissionDenied;
  }
  if (!criticVerdict) {
    critiqueFailed = true;
    criticVerdict = cancelledAtCritique
      ? "Mission cancelled before the critic could finish."
      : "The critic produced no verdict text; treat the run with suspicion and inspect the diffs manually.";
  }
  yield { type: "critique_result", verdict: criticVerdict };

  // 5. Final Mission Debriefing
  const changes = await deps.summarizeChanges();
  const filesChanged = changes.map((c) => c.path);
  if (cancelledAtCritique) {
    // The debrief still renders — but as a CANCELLED result, never success.
    const result: GoalRunResult = {
      goal,
      success: false,
      cancelled: true,
      milestones,
      totalTurns,
      filesChanged,
      summary: `Mission "${goal}" was cancelled during the final critique.`,
      criticVerdict,
    };
    yield { type: "goal_completed", result };
    return result;
  }
  const allCompleted = milestones.every((m) => m.status === "completed");
  const completedCount = milestones.filter((m) => m.status === "completed").length;
  const budgetNote = budgetExhausted
    ? ` The turn budget (${maxTurns}) ran out before every milestone could be attempted.`
    : "";

  const result: GoalRunResult = {
    goal,
    success: allCompleted && !critiqueFailed,
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
      // The shared chat budget, not a hardcoded half-budget: reasoning models
      // bill deliberation INSIDE the output ceiling (Probe K), so a 4,096 cap
      // starves the visible turn — the first surface to go silent in goal mode.
      maxTokens: DEFAULT_MAX_TOKENS,
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
      // Single owner of the outcome rule (shared with the TUI's live runner) —
      // the branches below only produce deck progress, never outcome state.
      accumulateGoalOutcome(outcome, event);
      if (event.type === "verification_result") {
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
        // `accumulateGoalOutcome` already marked the turn failed; the deck must
        // say why rather than showing a silent pass.
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
      }
    }
    return outcome;
  }
}
