import type { AgentEvent, GoalEvent } from "@anvil/core";

export interface RenderCliOptions {
  raw?: boolean;
}

export interface RenderResult {
  exitCode?: number;
}

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
      return undefined;
    case "guardian_blocked":
      if (!raw) {
        process.stderr.write(
          `⚠ [guardian] ${event.count} pending call(s) blocked before execution ` +
            `(${event.fixed} auto-fixed); fix and retry — do not re-emit unchanged.\n`
        );
      } else {
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
      return { exitCode: 1 };
    case "budget_exhausted":
      if (!raw) {
        process.stderr.write("\nTurn stopped: step budget exhausted. Task may be incomplete.\n");
      } else {
        process.stderr.write("budget_exhausted\n");
      }
      return { exitCode: 2 };
    case "turn_complete":
      process.stdout.write("\n");
      return { exitCode: 0 };
    case "cancelled":
      process.stderr.write("\nCancelled.\n");
      return { exitCode: 130 };
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
      return { exitCode: event.result.success ? 0 : 1 };
    case "goal_failed":
      if (!raw) {
        process.stderr.write(`\n✗ Goal failed: ${event.error}\n`);
      }
      return { exitCode: 1 };
    default:
      return undefined;
  }
}
