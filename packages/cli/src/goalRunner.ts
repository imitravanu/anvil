import { getErrorMessage } from "@anvil/core";
import { GoalEngine, type ModelProvider, type ToolDefinition } from "@anvil/core";
import { HeadlessPermissionBroker } from "./headless.js";
import { renderGoalEvent } from "./terminalRenderer.js";

export interface GoalHeadlessOptions {
  goal: string;
  provider: ModelProvider;
  model: string;
  projectRoot: string;
  autoApprove: boolean;
  raw: boolean;
  /** Full wired tool list (built-ins + plugins + MCP); undefined = built-in defaults. */
  sessionTools?: ToolDefinition[];
  maxTurns?: number;
}

export async function runGoalHeadless(opts: GoalHeadlessOptions): Promise<number> {
  const broker = new HeadlessPermissionBroker(opts.autoApprove, opts.raw);
  const engine = new GoalEngine({
    provider: opts.provider,
    model: opts.model,
    projectRoot: opts.projectRoot,
    permissionBroker: broker,
    tools: opts.sessionTools,
    maxTurns: opts.maxTurns,
  });

  // SIGINT parity with headless mode: first Ctrl+C cancels the mission
  // gracefully, the second exits immediately.
  let abortCount = 0;
  const abortHandler = () => {
    abortCount++;
    if (abortCount > 1) {
      process.exit(130);
    }
    engine.cancel();
  };
  process.prependListener("SIGINT", abortHandler);

  try {
    for await (const event of engine.run(opts.goal)) {
      const rendered = renderGoalEvent(event, { raw: opts.raw });
      if (rendered?.exitCode !== undefined) {
        return rendered.exitCode;
      }
    }
    return 0;
  } catch (err: unknown) {
    if (!opts.raw) {
      process.stderr.write(`\nError in GoalEngine: ${getErrorMessage(err)}\n`);
    }
    return 1;
  } finally {
    process.removeListener("SIGINT", abortHandler);
  }
}
