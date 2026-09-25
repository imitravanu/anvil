/**
 * Phase 25.4 — Plugin System types.
 * Plugins live in ~/.anvil/plugins/<name>/plugin.json and register tools
 * through the same permission model as MCP (unknown external tools gate).
 */

export interface PluginToolDef {
  name: string;
  description: string;
  /**
   * Shell command template run in the project root; {input} is JSON. Spliced
   * into `bash -c`, so an UNQUOTED {input} exposes model-controlled
   * metacharacters to the shell — prefer `args` below.
   */
  command: string;
  /**
   * Argv form (preferred): the tool runs `command` directly, with NO shell, and
   * these arguments — each optionally containing `{input}`. The input JSON
   * fills in as one argv element, so it can never be re-parsed as shell syntax.
   */
  args?: string[];
}

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  tools?: PluginToolDef[];
  systemPrompt?: string;
  enabled?: boolean;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  enabled: boolean;
}

export interface PluginProblem {
  name: string;
  error: string;
}
