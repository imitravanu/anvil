import type { AgentEvent, GoalEvent } from "@anvil/core";

export interface RenderCliOptions {
  raw?: boolean;
}

export interface RenderResult {
  exitCode?: number;
}

/**
 * Exit codes for headless (`anvil -p`) and goal (`anvil goal`) runs. CI and
 * scripts key off these, so they are a contract — named here to stop them
 * drifting into scattered literals.
 */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_BUDGET_EXHAUSTED = 2;
/** Turn mutated files and automated verification gave up with tests failing. */
export const EXIT_UNVERIFIED = 3;
export const EXIT_CANCELLED = 130;

/**
 * Unified CLI terminal event renderer for headless and goal execution modes.
 * Formats events to stdout and stderr, suppressing non-essential diagnostics when raw mode is active.
 */
export function renderCliEvent(event: AgentEvent, opts?: RenderCliOptions): RenderResult | undefined {
  const raw = opts?.raw === true;
  switch (event.type) {
    case "text_delta":
      process.stdout.write(event.text);
      return undefined;
    case "tool_started":
      if (!raw) {
        process.stderr.write(`\n⚙ [${event.name}] ...\n`);
      }
      return undefined;
    case "tool_finished":
      if (!raw) {
        const sym = event.result.isError ? "✗" : "✓";
        process.stderr.write(`${sym} [${event.name}] ${event.result.summary}\n`);
      }
      return undefined;
    case "tool_permission_denied":
      if (!raw) {
        process.stderr.write(`✗ [${event.name}] Permission denied (pass -y to allow)\n`);
      }
      return undefined;
    case "verification_started":
      if (!raw) {
        process.stderr.write(`\n🧪 [verify] running ${event.command}...\n`);
      }
      return undefined;
    case "verification_result":
      if (!raw) {
        process.stderr.write(`${event.passed ? "✓" : "✗"} [verify] ${event.summary}\n`);
      }
      return undefined;
    case "verification_gave_up":
      if (!raw) {
        process.stderr.write(
          `⚠ [verify] repair budget exhausted — tests may still be failing: ${event.command}\n`
        );
      }
      // Terminal and unverified: the engine emits this only when the FINAL
      // state still fails, and it precedes turn_complete. headless.ts returns
      // on the first exit code it sees, so returning none here let
      // turn_complete's 0 win — a silent success for a broken mutation (S1.4).
      return { exitCode: EXIT_UNVERIFIED };
    case "guardian_blocked":
      if (!raw) {
        process.stderr.write(
          `\n⚠ [guardian] ${event.count} pending call(s) blocked before execution (${event.fixed} auto-fixed):\n`
        );
        for (const v of event.violations.slice(0, 10)) {
          process.stderr.write(`   - ${v.file}:${v.line} [${v.rule}] ${v.detail}\n`);
        }
        process.stderr.write("   Fix and retry — do not re-emit unchanged.\n");
      } else {
        // Stable machine line — scripts and CI key off this exact shape.
        process.stderr.write(`guardian_blocked count=${event.count} fixed=${event.fixed}\n`);
      }
      return undefined;
    case "subagent_started":
      if (!raw) {
        process.stderr.write(`\n🤖 [subagent] ${event.task}\n`);
      }
      return undefined;
    case "subagent_progress":
      if (!raw) {
        process.stderr.write(`  ↳ [subagent] ${event.tool}: ${event.detail}\n`);
      }
      return undefined;
    case "subagent_finished":
      if (!raw) {
        process.stderr.write(`✓ [subagent] Completed (${event.toolCalls} tool calls)\n`);
      }
      return undefined;
    case "error":
      process.stderr.write(`\nError: ${event.message}\n`);
      return { exitCode: EXIT_ERROR };
    case "budget_exhausted":
      if (!raw) {
        process.stderr.write("\nTurn stopped: step budget exhausted. Task may be incomplete.\n");
      } else {
        process.stderr.write("budget_exhausted\n");
      }
      return { exitCode: EXIT_BUDGET_EXHAUSTED };
    case "turn_complete":
      process.stdout.write("\n");
      return { exitCode: EXIT_OK };
    case "cancelled":
      process.stderr.write("\nCancelled.\n");
      return { exitCode: EXIT_CANCELLED };
    default:
      return undefined;
  }
}

/**
 * Unified goal event renderer for autonomous missions.
 */
export function renderGoalEvent(event: GoalEvent, opts?: RenderCliOptions): RenderResult | undefined {
  const raw = opts?.raw === true;
  switch (event.type) {
    case "awareness_ready":
      if (!raw) {
        process.stderr.write(`🎯 [Awareness] ${event.context.summary}\n\n`);
      }
      return undefined;
    case "plan_decomposed":
      if (!raw) {
        process.stderr.write(`📋 [Goal Plan] ${event.milestones.length} Milestones:\n`);
        for (const m of event.milestones) {
          process.stderr.write(`  ${m.id}. ${m.title} — ${m.criteria}\n`);
        }
        process.stderr.write("\n");
      }
      return undefined;
    case "milestone_started":
      if (!raw) {
        process.stderr.write(`▶ [Milestone ${event.milestone.id}] ${event.milestone.title}\n`);
      }
      return undefined;
    case "milestone_progress":
      if (!raw) {
        process.stderr.write(`  ↳ ${event.detail}\n`);
      }
      return undefined;
    case "milestone_completed":
      if (!raw) {
        process.stderr.write(`✔ [Milestone ${event.milestone.id} Completed]\n\n`);
      }
      return undefined;
    case "milestone_failed":
      if (!raw) {
        process.stderr.write(`✗ [Milestone ${event.milestone.id} Failed] ${event.error}\n\n`);
      }
      return undefined;
    case "critique_started":
      if (!raw) {
        process.stderr.write(`🔍 [Adversarial Self-Critique] Reviewing mission integrity...\n`);
      }
      return undefined;
    case "critique_result":
      if (!raw) {
        process.stderr.write(`\n--- Self-Critique Verdict ---\n${event.verdict}\n-----------------------------\n\n`);
      }
      return undefined;
    case "goal_completed":
      process.stdout.write(`\n=== Mission Summary ===\n${event.result.summary}\n`);
      if (event.result.filesChanged.length > 0) {
        process.stdout.write(`Files Changed (${event.result.filesChanged.length}):\n`);
        for (const f of event.result.filesChanged) {
          process.stdout.write(`  - ${f}\n`);
        }
      }
      return { exitCode: event.result.success ? EXIT_OK : EXIT_ERROR };
    case "goal_failed":
      if (!raw) {
        process.stderr.write(`\n✗ Goal failed: ${event.error}\n`);
      }
      return { exitCode: EXIT_ERROR };
    default:
      return undefined;
  }
}
