import { ToolContext, ToolDefinition, ToolExecutor, ToolExecutionResult } from "./types.js";
import * as readFile from "./readFile.js";
import * as writeFile from "./writeFile.js";
import * as editFile from "./editFile.js";
import * as listFiles from "./listFiles.js";
import * as grep from "./grep.js";
import * as bash from "./bash.js";

interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
  /**
   * Permission-prompt preview, computed WITHOUT performing the mutation
   * (edit_file returns its real unified diff here). Additive to the spec's
   * minimum export shape — optional, falls back to a generic description.
   */
  describe?: (input: unknown, ctx: ToolContext) => Promise<string>;
}

const REGISTRY: RegisteredTool[] = [
  { definition: readFile.definition, execute: readFile.execute },
  { definition: writeFile.definition, execute: writeFile.execute, describe: writeFile.describe },
  { definition: editFile.definition, execute: editFile.execute, describe: editFile.describe },
  { definition: listFiles.definition, execute: listFiles.execute },
  { definition: grep.definition, execute: grep.execute },
  { definition: bash.definition, execute: bash.execute, describe: bash.describe },
];

export const TOOL_DEFINITIONS: ToolDefinition[] = REGISTRY.map((t) => t.definition);

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext
): Promise<ToolExecutionResult> {
  const tool = REGISTRY.find((t) => t.definition.name === name);
  if (!tool) {
    return {
      output: { error: `Unknown tool: ${name}` },
      isError: true,
      summary: `Unknown tool: ${name}`,
    };
  }
  try {
    return await tool.execute(input, ctx);
  } catch (err: any) {
    return {
      output: { error: err.message ?? String(err) },
      isError: true,
      summary: `${name} failed`,
    };
  }
}

/**
 * Human-readable summary of what a tool call WOULD do, for the permission
 * prompt, computed before execution. For edit_file this is the actual unified
 * diff (computed against the current file, nothing written).
 */
export async function describeToolInput(
  name: string,
  input: unknown,
  ctx: ToolContext
): Promise<string> {
  const tool = REGISTRY.find((t) => t.definition.name === name);
  if (tool?.describe) return tool.describe(input, ctx);
  return `${name}(${JSON.stringify(input).slice(0, 200)})`;
}
