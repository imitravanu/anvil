import {
  AgentSession,
  buildAnvilAgentProfile,
  MAX_STDIN_BYTES,
  MAX_STDIN_WAIT_MS,
  STDIN_IDLE_TIMEOUT_MS,
  type ModelProvider,
  type PermissionBroker,
  type ToolDefinition,
} from "@anvil/core";
import { renderCliEvent, EXIT_OK, EXIT_PERMISSION_DENIED } from "./terminalRenderer.js";

export interface HeadlessOptions {
  prompt: string;
  provider: ModelProvider;
  model: string;
  projectRoot: string;
  autoApprove: boolean;
  raw: boolean;
  /** Full wired tool list (built-ins + plugins + MCP); undefined = built-in defaults. */
  sessionTools?: ToolDefinition[];
  /** System-prompt additions from enabled plugins (folded in before buildSystemPrompt). */
  pluginPrompts?: string[];
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

// Centralized in @anvil/core's config/constants (§2.4); re-exported so the
// public API and every import site stay unchanged.
export { MAX_STDIN_BYTES, MAX_STDIN_WAIT_MS };

/**
 * Reads all buffered data from stdin until EOF (for piped usage).
 * A parent process that spawns Anvil with an open-but-silent inherited pipe
 * would otherwise block boot forever — after `idleMs` with no data (default
 * 5s) we assume there is nothing more and proceed, noting it on stderr.
 * Capped by maxBytes and hard timeout against infinite/slow streaming pipes.
 */
export async function readStdin(
  idleMs = STDIN_IDLE_TIMEOUT_MS,
  maxBytes = MAX_STDIN_BYTES,
  maxWaitMs = MAX_STDIN_WAIT_MS,
  quiet = false
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
        if (!quiet) process.stderr.write(`[anvil] stdin exceeded ${Math.round(maxBytes / 1024)} KB — truncating\n`);
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
      if (!quiet) {
        process.stderr.write(
          `[anvil] no EOF on stdin after ${Math.round(idleMs / 1000)}s — continuing without piped input\n`
        );
      }
      process.stdin.destroy();
      finish(Buffer.concat(chunks).toString("utf8"));
    };
    let idle = setTimeout(onIdle, idleMs);
    hardTimer = setTimeout(() => {
      if (!quiet) process.stderr.write(`[anvil] stdin reached hard timeout (${Math.round(maxWaitMs / 1000)}s) — continuing\n`);
      finish(Buffer.concat(chunks).toString("utf8"));
    }, maxWaitMs);
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
  });
}

/**
 * Tracks whether a headless run ended blocked by permission denials (G4,
 * AUDIT-2026-09-30). A denial arms it; only an EXECUTED (non-error) mutating
 * tool result disarms it — a read-only success does not unblock a refused
 * mutation. `isMutating` follows the orchestrator's convention: unknown tool
 * names count as mutating (fail closed). Pure state machine so the exit
 * contract is testable without driving a whole run.
 */
export class DenialTracker {
  private pending = false;

  constructor(private readonly isMutating: (name: string) => boolean) {}

  onPermissionDenied(): void {
    this.pending = true;
  }

  onToolFinished(name: string, isError: boolean): void {
    if (!isError && this.isMutating(name)) this.pending = false;
  }

  get blocked(): boolean {
    return this.pending;
  }
}

/**
 * Execute a single agent turn in headless mode without React/Ink.
 * Streams text deltas to stdout, diagnostic messages to stderr.
 */
export async function runHeadless(opts: HeadlessOptions): Promise<number> {
  const broker = new HeadlessPermissionBroker(opts.autoApprove, opts.raw);
  // Shared with the TUI and the eval lane: one base prompt, one output budget,
  // one verify flag. Plugin prompts arrive pre-joined from the shared boot
  // context; a broken plugin never blocks the run (problems were reported
  // there).
  const profile = buildAnvilAgentProfile(opts.projectRoot, {
    pluginPrompts: opts.pluginPrompts,
  });

  const session = new AgentSession(opts.provider, {
    systemPrompt: profile.systemPrompt,
    model: opts.model,
    maxTokens: profile.maxTokens,
    projectRoot: opts.projectRoot,
    permissionBroker: broker,
    // Closed-loop verification is a core product behavior, not a goal-mode
    // extra: after mutations, the detected test runner gates the turn.
    autoVerify: profile.autoVerify,
    ...(opts.sessionTools !== undefined ? { tools: opts.sessionTools } : {}),
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

  const mutatingByName = new Map(session.getTools().map((t) => [t.name, t.mutating === true]));
  const denials = new DenialTracker((name) => mutatingByName.get(name) ?? true);

  try {
    for await (const event of session.send(opts.prompt)) {
      if (event.type === "tool_permission_denied") {
        denials.onPermissionDenied();
      } else if (event.type === "tool_finished") {
        denials.onToolFinished(event.name, event.result.isError);
      }
      const rendered = renderCliEvent(event, { raw: opts.raw });
      if (rendered?.exitCode !== undefined) {
        if (rendered.exitCode === EXIT_OK && denials.blocked) {
          // G4/AUDIT-2026-09-30: a run whose every mutation was refused must
          // not report success — turn_complete's 0 used to win here and CI
          // could not distinguish "done" from "blocked".
          if (!opts.raw) {
            process.stderr.write(
              "\n[anvil] every mutating action was denied this run — reporting permission denied (exit 4), not success.\n"
            );
          }
          return EXIT_PERMISSION_DENIED;
        }
        return rendered.exitCode;
      }
    }
    return denials.blocked ? EXIT_PERMISSION_DENIED : 0;
  } finally {
    process.off("SIGINT", abortHandler);
  }
}
