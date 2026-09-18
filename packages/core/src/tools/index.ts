import { getErrorMessage } from "../errors.js";
import { ToolContext, ToolDefinition, ToolExecutor, ToolExecutionResult, SessionToolExecutor } from "./types.js";
import * as readFile from "./readFile.js";
import * as writeFile from "./writeFile.js";
import * as editFile from "./editFile.js";
import * as listFiles from "./listFiles.js";
import * as grep from "./grep.js";
import * as bash from "./bash.js";
import * as outline from "./outline.js";
import * as verifyTests from "./verifyTests.js";
import * as updatePlan from "./updatePlan.js"; // plan scratchpad
import * as delegateTask from "./delegateTask.js"; // sub-agent delegation tool
import * as updateMemory from "./updateMemory.js"; // project memory tool
import {
  gotoDefinitionDef,
  gotoDefinitionExec,
  findReferencesDef,
  findReferencesExec,
  getHoverDef,
  getHoverExec,
  getDiagnosticsDef,
  getDiagnosticsExec,
} from "../lsp/tools.js";

interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
  /**
   * Permission-prompt preview, computed WITHOUT performing the mutation
   * (edit_file returns its real unified diff here). Additive to the spec's
   * minimum export shape — optional, falls back to a generic description.
   */
  describe?: (input: unknown, ctx: ToolContext) => Promise<string>;
  executeSession?: SessionToolExecutor;
}

const REGISTRY: RegisteredTool[] = [
  { definition: readFile.definition, execute: readFile.execute },
  { definition: writeFile.definition, execute: writeFile.execute, describe: writeFile.describe },
  { definition: editFile.definition, execute: editFile.execute, describe: editFile.describe },
  { definition: listFiles.definition, execute: listFiles.execute },
  { definition: grep.definition, execute: grep.execute },
  { definition: bash.definition, execute: bash.execute, describe: bash.describe },
  { definition: outline.definition, execute: outline.execute },
  { definition: verifyTests.definition, execute: verifyTests.execute },
  { definition: updatePlan.definition, execute: updatePlan.execute, executeSession: updatePlan.executeSession },
  { definition: delegateTask.definition, execute: delegateTask.execute, executeSession: delegateTask.executeSession },
  { definition: updateMemory.definition, execute: updateMemory.execute },
  { definition: gotoDefinitionDef, execute: gotoDefinitionExec },
  { definition: findReferencesDef, execute: findReferencesExec },
  { definition: getHoverDef, execute: getHoverExec },
  { definition: getDiagnosticsDef, execute: getDiagnosticsExec },
];

export const TOOL_DEFINITIONS: ToolDefinition[] = REGISTRY.map((t) => t.definition);

export function getSessionToolHandler(name: string): SessionToolExecutor | undefined {
  return REGISTRY.find((t) => t.definition.name === name)?.executeSession;
}

// external tool executors (MCP). The built-in registry stays
// closed; unknown names fall through to registered prefixes in order.
export interface ExternalToolResult {
  /** True when this executor owns the name (it must then provide result). */
  claimed: boolean;
  result?: ToolExecutionResult;
}

export type ExternalToolExecutor = (
  name: string,
  input: unknown,
  ctx: ToolContext
) => Promise<ExternalToolResult>;

export type ExternalToolDescribe = (input: unknown, ctx: ToolContext) => Promise<string>;

const externalExecutors: { prefix: string; exec: ExternalToolExecutor; describe?: ExternalToolDescribe }[] = [];

export function registerExternalExecutor(
  prefix: string,
  exec: ExternalToolExecutor,
  describe?: ExternalToolDescribe
): void {
  if (!externalExecutors.some((e) => e.prefix === prefix)) {
    externalExecutors.push({ prefix, exec, describe });
  }
}

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext
): Promise<ToolExecutionResult> {
  if (input && typeof input === "object" && "__parseError" in (input as Record<string, unknown>)) {
    const rawInput = (input as { rawInput?: string }).rawInput ?? "";
    return {
      output: { error: `Malformed JSON in tool call input. Raw: ${rawInput}` },
      isError: true,
      summary: `${name}: malformed JSON input`,
    };
  }
  const tool = REGISTRY.find((t) => t.definition.name === name);
  if (!tool) {
    for (const ext of externalExecutors) {
      if (!name.startsWith(ext.prefix)) continue;
      try {
        const r = await ext.exec(name, input, ctx);
        if (r.claimed && r.result) return r.result;
      } catch (err: unknown) {
        return {
          output: { error: getErrorMessage(err) },
          isError: true,
          summary: `${name} failed`,
        };
      }
    }
    return {
      output: { error: `Unknown tool: ${name}` },
      isError: true,
      summary: `Unknown tool: ${name}`,
    };
  }
  try {
    return await tool.execute(input, ctx);
  } catch (err: unknown) {
    return {
      output: { error: getErrorMessage(err) },
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
  for (const ext of externalExecutors) {
    if (name.startsWith(ext.prefix) && ext.describe) return ext.describe(input, ctx);
  }
  return `${name}(${JSON.stringify(input).slice(0, 200)})`;
}

export { detectTestCommand, runTestVerification, type TestRunResult } from "./verifyTests.js";
