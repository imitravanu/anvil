/**
 * Phase 25.4 — Plugin System types.
 * Plugins live in ~/.anvil/plugins/<name>/plugin.json and register tools
 * through the same permission model as MCP (unknown external tools gate).
 */

export interface PluginToolDef {
  name: string;
  description: string;
  /** Shell command template run in the project root; {input} is JSON. */
  command: string;
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
