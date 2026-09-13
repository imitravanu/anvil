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
  recordLedger: (entry: unknown) => void;
  allowDelegation?: boolean;
  tryConsumeDelegation: (max: number) => boolean;
  provider: unknown;
  model: string;
  projectRoot: string;
  permissionBroker: unknown;
  tools: readonly ToolDefinition[];
  signal: AbortSignal;
  mergeSubCheckpoints?: (checkpoints: unknown[]) => Promise<void>;
  recordMutation?: () => void;
}

export type SessionToolExecutor = (
  input: unknown,
  ctx: ToolSessionContext,
  inputKey: string
) => AsyncGenerator<any, ToolExecutionResult>;
