import { ConversationMessage, ModelProvider } from "../providers/types.js";
import { TOOL_DEFINITIONS } from "../tools/index.js";
import type { ToolDefinition } from "../tools/types.js";
import { AgentSession } from "./session.js";
import type { PermissionBroker } from "./types.js";

// ---------------------------------------------------------------------------
// Phase 9: sub-agent runner. A sub-agent is a real AgentSession with a fresh
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
export function subAgentTools(): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((t) => t.name !== "delegate_task");
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
}

export async function runSubAgent(opts: {
  provider: ModelProvider;
  model: string;
  projectRoot: string;
  permissionBroker: PermissionBroker;
  task: string;
  signal: AbortSignal;
  maxInnerIterations?: number;
}): Promise<SubAgentRun> {
  const sub = new AgentSession(opts.provider, {
    systemPrompt: SUB_AGENT_SYSTEM_PROMPT,
    model: opts.model,
    maxTokens: SUB_AGENT_MAX_TOKENS,
    projectRoot: opts.projectRoot,
    permissionBroker: opts.permissionBroker,
    tools: subAgentTools(),
    allowDelegation: false,
    maxInnerIterations: opts.maxInnerIterations ?? SUB_AGENT_MAX_ITERATIONS,
  });

  // The parent turn's AbortSignal covers the sub-run (spec: no wall-clock
  // timer — user cancel propagates). Registered BEFORE send() starts so no
  // abort can slip in between; removed on exit so the session can't leak.
  if (opts.signal.aborted) {
    return { report: "", usage: { in: 0, out: 0 }, toolCalls: 0, aborted: true };
  }
  const onAbort = () => sub.cancel();
  opts.signal.addEventListener("abort", onAbort, { once: true });

  let report = "";
  let inTokens = 0;
  let outTokens = 0;
  let toolCalls = 0;
  let aborted = false;
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
        case "tool_started":
          toolCalls += 1;
          break;
        case "cancelled":
          aborted = true;
          break;
        default:
          break;
      }
    }
  } catch {
    aborted = true; // a crashed sub-run must not crash the main turn
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
  }

  return {
    report: capReport(report),
    usage: { in: inTokens, out: outTokens },
    toolCalls,
    aborted,
  };
}