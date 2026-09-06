import {
  AgentSession,
  buildSystemPrompt,
  type ModelProvider,
  type PermissionBroker,
  type ToolDefinition,
} from "@anvil/core";

export interface HeadlessOptions {
  prompt: string;
  provider: ModelProvider;
  model: string;
  projectRoot: string;
  autoApprove: boolean;
  raw: boolean;
  mcpTools?: ToolDefinition[];
}

export class HeadlessPermissionBroker implements PermissionBroker {
  constructor(
    private readonly autoApprove: boolean,
    private readonly raw: boolean
  ) {}

  async requestPermission(toolName: string, _summary: string): Promise<boolean> {
    if (this.autoApprove) {
      if (!this.raw) {
        process.stderr.write(`[anvil] Auto-approved mutating tool: ${toolName}\n`);
      }
      return true;
    }
    if (!this.raw) {
      process.stderr.write(
        `[anvil] Refused mutating tool "${toolName}" (pass -y / --yes in non-interactive mode to allow)\n`
      );
    }
    return false;
  }
}

/**
 * Reads all buffered data from stdin until EOF (for piped usage).
 */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

/**
 * Execute a single agent turn in headless mode without React/Ink.
 * Streams text deltas to stdout, diagnostic messages to stderr.
 */
export async function runHeadless(opts: HeadlessOptions): Promise<number> {
  const broker = new HeadlessPermissionBroker(opts.autoApprove, opts.raw);
  const basePrompt = "You are Anvil, a terminal coding agent. Be concise.";
  const systemPrompt = buildSystemPrompt(basePrompt, opts.projectRoot);

  const session = new AgentSession(opts.provider, {
    systemPrompt,
    model: opts.model,
    maxTokens: 8192,
    projectRoot: opts.projectRoot,
    permissionBroker: broker,
    // Closed-loop verification is a core product behavior, not a goal-mode
    // extra: after mutations, the detected test runner gates the turn.
    autoVerify: true,
    ...(opts.mcpTools !== undefined ? { tools: opts.mcpTools } : {}),
  });

  const abortHandler = () => {
    session.cancel();
  };
  // Prepend: index.tsx registers a last-resort exit handler at import time.
  // Listener order is registration order, so without prepending, that handler
  // process.exit()s before this one can cancel the session — piped stdout is
  // truncated and the graceful-cancel path never runs.
  process.prependListener("SIGINT", abortHandler);

  try {
    for await (const event of session.send(opts.prompt)) {
      switch (event.type) {
        case "text_delta":
          process.stdout.write(event.text);
          break;
        case "tool_started":
          if (!opts.raw) {
            process.stderr.write(`\n⚙ [${event.name}] ...\n`);
          }
          break;
        case "tool_finished":
          if (!opts.raw) {
            const sym = event.result.isError ? "✗" : "✓";
            process.stderr.write(`${sym} [${event.name}] ${event.result.summary}\n`);
          }
          break;
        case "tool_permission_denied":
          if (!opts.raw) {
            process.stderr.write(`✗ [${event.name}] Permission denied (pass -y to allow)\n`);
          }
          break;
        case "verification_started":
          if (!opts.raw) {
            process.stderr.write(`\n🧪 [verify] running ${event.command}...\n`);
          }
          break;
        case "verification_result":
          if (!opts.raw) {
            process.stderr.write(`${event.passed ? "✓" : "✗"} [verify] ${event.summary}\n`);
          }
          break;
        case "error":
          process.stderr.write(`\nError: ${event.message}\n`);
          return 1;
        case "budget_exhausted":
          // A turn cut off mid-task is NOT a success — pipelines (and the
          // planned eval harness) key off the exit code.
          if (!opts.raw) {
            process.stderr.write("\nTurn stopped: step budget exhausted. Task may be incomplete.\n");
          } else {
            process.stderr.write("budget_exhausted\n");
          }
          return 2;
        case "turn_complete":
          process.stdout.write("\n");
          return 0;
        case "cancelled":
          process.stderr.write("\nCancelled.\n");
          return 130;
      }
    }
    return 0;
  } finally {
    process.off("SIGINT", abortHandler);
  }
}
