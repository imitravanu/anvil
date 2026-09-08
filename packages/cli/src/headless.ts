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

export const MAX_STDIN_BYTES = 1024 * 1024; // 1 MB cap
export const MAX_STDIN_WAIT_MS = 30_000; // 30s hard timeout

/**
 * Reads all buffered data from stdin until EOF (for piped usage).
 * A parent process that spawns Anvil with an open-but-silent inherited pipe
 * would otherwise block boot forever — after `idleMs` with no data (default
 * 5s) we assume there is nothing more and proceed, noting it on stderr.
 * Capped by maxBytes and hard timeout against infinite/slow streaming pipes.
 */
export async function readStdin(
  idleMs = 5_000,
  maxBytes = MAX_STDIN_BYTES,
  maxWaitMs = MAX_STDIN_WAIT_MS
): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    let hardTimer: NodeJS.Timeout | undefined;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      if (hardTimer) clearTimeout(hardTimer);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
      resolve(text);
    };
    const onData = (chunk: Buffer) => {
      const buf = Buffer.from(chunk);
      totalBytes += buf.length;
      chunks.push(buf);
      if (totalBytes >= maxBytes) {
        process.stderr.write(`[anvil] stdin exceeded ${Math.round(maxBytes / 1024)} KB — truncating\n`);
        finish(Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8"));
        return;
      }
      // Data arriving resets the idle window — a slow but live pipe is fine.
      clearTimeout(idle);
      idle = setTimeout(onIdle, idleMs);
    };
    const onEnd = () => finish(Buffer.concat(chunks).toString("utf8"));
    const onError = () => finish("");
    const onIdle = () => {
      process.stderr.write(
        `[anvil] no EOF on stdin after ${Math.round(idleMs / 1000)}s — continuing without piped input\n`
      );
      process.stdin.destroy();
      finish(Buffer.concat(chunks).toString("utf8"));
    };
    let idle = setTimeout(onIdle, idleMs);
    hardTimer = setTimeout(() => {
      process.stderr.write(`[anvil] stdin reached hard timeout (${Math.round(maxWaitMs / 1000)}s) — continuing\n`);
      finish(Buffer.concat(chunks).toString("utf8"));
    }, maxWaitMs);
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
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

  let abortCount = 0;
  const abortHandler = () => {
    abortCount++;
    if (abortCount > 1) {
      process.exit(130);
    }
    session.cancel();
  };
  // Prepend: allows session.cancel() to run cleanly on the first SIGINT.
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
