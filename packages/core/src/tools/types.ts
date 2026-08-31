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
