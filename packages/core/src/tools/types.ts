import type { TeamRunResult } from "../agent/team/types.js";
import type { AgentEvent, PermissionBroker } from "../agent/types.js";
import type { Checkpoint } from "../agent/checkpoints.js";
import type { RunLedgerEntry } from "../agent/ledger.js";
import type { ModelProvider } from "../providers/types.js";

export interface ToolContext {
  projectRoot: string;
  signal: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // Tools that mutate the filesystem or run commands must be flagged — the agent loop uses
  // this to decide whether a PermissionBroker check is required before execution.
  mutating: boolean;
}

export interface ToolExecutionResult {
  output: unknown; // JSON-serializable — becomes the tool_result content sent back to the model
  isError: boolean;
  // A short, human-readable description of what this call did or would do, e.g.
  // "Wrote 340 bytes to src/index.ts" or "Ran: npm test". Used in permission prompts and logs.
  // For edit_file specifically, this is a real unified diff string — see editFile.ts.
  summary: string;
}

export type ToolExecutor = (
  input: unknown,
  ctx: ToolContext
) => Promise<ToolExecutionResult>;

export interface ToolSessionContext {
  setPlan?: (plan: string) => void;
  recordLedger: (entry: Omit<RunLedgerEntry, "seq" | "ts">) => void;
  allowDelegation?: boolean;
  tryConsumeDelegation: (max: number) => boolean;
  provider: ModelProvider;
  model: string;
  projectRoot: string;
  permissionBroker: PermissionBroker;
  tools: readonly ToolDefinition[];
  signal: AbortSignal;
  mergeSubCheckpoints?: (checkpoints: Checkpoint[]) => Promise<void>;
  recordMutation?: () => void;
  /** Called once when a `delegate_task` team run completes (Phase 25.2 introspection). */
  onTeamRunResult?: (result: TeamRunResult) => void;
}

export type SessionToolExecutor = (
  input: unknown,
  ctx: ToolSessionContext,
  inputKey: string
) => AsyncGenerator<AgentEvent, ToolExecutionResult>;
