import { ConversationMessage, ModelProvider } from "../providers/types.js";
import { TOOL_DEFINITIONS } from "../tools/index.js";
import type { ToolDefinition } from "../tools/types.js";
import { AgentSession } from "./session.js";
import type { PermissionBroker } from "./types.js";
import type { Checkpoint } from "./checkpoints.js";
import { buildSystemPrompt } from "../config/rules.js";

// ---------------------------------------------------------------------------
// sub-agent runner. A sub-agent is a real AgentSession with a fresh
// context, a focused system prompt, its own step budget, NO delegate_task
// (depth limit 1), and the SAME permission broker (shared grants; mutating
// sub-agent actions still prompt the user).
// ---------------------------------------------------------------------------

export const SUB_AGENT_MAX_ITERATIONS = 12;
export const SUB_AGENT_REPORT_MAX_CHARS = 8000;
export const SUB_AGENT_MAX_TOKENS = 4096;
export const MAX_DELEGATIONS_PER_TURN = 3;

export const SUB_AGENT_SYSTEM_PROMPT =
  "You are a focused sub-agent inside Anvil, a terminal coding agent. You are given exactly " +
  "ONE task. Investigate and act using the available tools; you may mutate files or run " +
  "commands only with user approval. Never ask questions — there is no one to answer. Work " +
  "until the task is complete or you approach your limits, then end with a final report: " +
  "what you did, what you found, files touched (if any), and anything unresolved. Be concise " +
  "and factual.";

/** Sub-agents never see delegate_task — the depth-1 guard for well-behaved models. */
export function subAgentTools(from: ToolDefinition[] = TOOL_DEFINITIONS): ToolDefinition[] {
  return from.filter((t) => t.name !== "delegate_task");
}

export function capReport(report: string): string {
  if (report.length <= SUB_AGENT_REPORT_MAX_CHARS) return report;
  return report.slice(0, SUB_AGENT_REPORT_MAX_CHARS) + "\n[report truncated]";
}

export interface SubAgentRun {
  report: string;
  usage: { in: number; out: number };
  toolCalls: number;
  aborted: boolean;
  /** Set when the sub-run crashed — surfaced to the parent turn, never swallowed. */
  failureReason?: string;
  /** The sub-agent's own checkpoints, for the parent to merge . */
  checkpoints: Checkpoint[];
}

/**
 * Progress event relayed while the sub-run executes: the tool it is using
 * right now. Raw sub-agent text is NOT relayed — the report lands in full on
 * subagent_finished, and duplicating it mid-run would double-render.
 */
export interface SubAgentProgress {
  type: "subagent_progress";
  tool: string;
  detail: string;
}

/** Live variant: yields SubAgentProgress while the run executes, returns the final run. */
export async function* runSubAgentLive(opts: {
  provider: ModelProvider;
  model: string;
  projectRoot: string;
  permissionBroker: PermissionBroker;
  task: string;
  signal: AbortSignal;
  maxInnerIterations?: number;
  /** Parent tool list (incl. MCP tools) — delegate_task still filtered. */
  tools?: ToolDefinition[];
}): AsyncGenerator<SubAgentProgress, SubAgentRun> {
  const sub = new AgentSession(opts.provider, {
    systemPrompt: buildSystemPrompt(SUB_AGENT_SYSTEM_PROMPT, opts.projectRoot),
    model: opts.model,
    maxTokens: SUB_AGENT_MAX_TOKENS,
    projectRoot: opts.projectRoot,
    permissionBroker: opts.permissionBroker,
    tools: subAgentTools(opts.tools),
    allowDelegation: false,
    maxInnerIterations: opts.maxInnerIterations ?? SUB_AGENT_MAX_ITERATIONS,
  });

  // The parent turn's AbortSignal covers the sub-run (no wall-clock
  // timer — user cancel propagates). Registered BEFORE send() starts so no
  // abort can slip in between; removed on exit so the session can't leak.
  if (opts.signal.aborted) {
    return { report: "", usage: { in: 0, out: 0 }, toolCalls: 0, aborted: true, checkpoints: [] };
  }
  const onAbort = () => sub.cancel();
  opts.signal.addEventListener("abort", onAbort, { once: true });

  let report = "";
  let inTokens = 0;
  let outTokens = 0;
  let toolCalls = 0;
  let aborted = false;
  let failureReason: string | undefined;
  try {
    for await (const event of sub.send(opts.task)) {
      switch (event.type) {
        case "text_delta":
          report += event.text;
          break;
        case "usage":
          inTokens += event.inputTokens;
          outTokens += event.outputTokens;
          break;
        case "tool_started": {
          toolCalls += 1;
          const input = (event.input ?? {}) as { command?: string; path?: string };
          const detail = input.command ?? input.path ?? "";
          yield { type: "subagent_progress", tool: event.name, detail };
          break;
        }
        case "cancelled":
          aborted = true;
          break;
        case "error":
          failureReason = event.message;
          break;
        default:
          break;
      }
    }
  } catch (err) {
    // A crashed sub-run must not crash the main turn — but the reason must
    // reach the user (it used to vanish, leaving a silent empty report).
    aborted = true;
    failureReason = err instanceof Error ? err.message : String(err);
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
  }

  return {
    report: capReport(report),
    usage: { in: inTokens, out: outTokens },
    toolCalls,
    aborted,
    ...(failureReason ? { failureReason } : {}),
    // Hand the sub-ring to the parent even on abort/crash: files the sub
    // changed before stopping still exist, so rewind must still reach them.
    checkpoints: sub.drainCheckpoints(),
  };
}
