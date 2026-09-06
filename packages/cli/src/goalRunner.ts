import { GoalEngine, type ModelProvider, type ToolDefinition } from "@anvil/core";
import { HeadlessPermissionBroker } from "./headless.js";

export interface GoalHeadlessOptions {
  goal: string;
  provider: ModelProvider;
  model: string;
  projectRoot: string;
  autoApprove: boolean;
  raw: boolean;
  mcpTools?: ToolDefinition[];
  maxTurns?: number;
}

export async function runGoalHeadless(opts: GoalHeadlessOptions): Promise<number> {
  const broker = new HeadlessPermissionBroker(opts.autoApprove, opts.raw);
  const engine = new GoalEngine({
    provider: opts.provider,
    model: opts.model,
    projectRoot: opts.projectRoot,
    permissionBroker: broker,
    tools: opts.mcpTools,
    maxTurns: opts.maxTurns,
  });

  try {
    for await (const event of engine.run(opts.goal)) {
      switch (event.type) {
        case "awareness_ready":
          if (!opts.raw) {
            process.stderr.write(`🎯 [Awareness] ${event.context.summary}\n\n`);
          }
          break;
        case "plan_decomposed":
          if (!opts.raw) {
            process.stderr.write(`📋 [Goal Plan] ${event.milestones.length} Milestones:\n`);
            for (const m of event.milestones) {
              process.stderr.write(`  ${m.id}. ${m.title} — ${m.criteria}\n`);
            }
            process.stderr.write("\n");
          }
          break;
        case "milestone_started":
          if (!opts.raw) {
            process.stderr.write(`▶ [Milestone ${event.milestone.id}] ${event.milestone.title}\n`);
          }
          break;
        case "milestone_progress":
          if (!opts.raw) {
            process.stderr.write(`  ↳ ${event.detail}\n`);
          }
          break;
        case "milestone_completed":
          if (!opts.raw) {
            process.stderr.write(`✔ [Milestone ${event.milestone.id} Completed]\n\n`);
          }
          break;
        case "milestone_failed":
          // Failed milestones continue the mission; hiding them made the
          // stderr stream claim progress the debrief then contradicted.
          if (!opts.raw) {
            process.stderr.write(`✗ [Milestone ${event.milestone.id} Failed] ${event.error}\n\n`);
          }
          break;
        case "critique_started":
          if (!opts.raw) {
            process.stderr.write(`🔍 [Adversarial Self-Critique] Reviewing mission integrity...\n`);
          }
          break;
        case "critique_result":
          if (!opts.raw) {
            process.stderr.write(`\n--- Self-Critique Verdict ---\n${event.verdict}\n-----------------------------\n\n`);
          }
          break;
        case "goal_completed":
          process.stdout.write(`\n=== Mission Summary ===\n${event.result.summary}\n`);
          if (event.result.filesChanged.length > 0) {
            process.stdout.write(`Files Changed (${event.result.filesChanged.length}):\n`);
            for (const f of event.result.filesChanged) {
              process.stdout.write(`  - ${f}\n`);
            }
          }
          return event.result.success ? 0 : 1;
        case "goal_failed":
          process.stderr.write(`\n✗ Goal failed: ${event.error}\n`);
          return 1;
      }
    }
    return 0;
  } catch (err: unknown) {
    process.stderr.write(`\nError in GoalEngine: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
