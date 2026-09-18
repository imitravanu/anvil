import fs from "node:fs";
import path from "node:path";
import { getErrorMessage } from "../errors.js";
import { anvilHome } from "../atomicWrite.js";
import { PLUGIN_MAX_TOOLS } from "../config/constants.js";
import type { LoadedPlugin, PluginManifest, PluginProblem } from "./types.js";

const PLUGIN_NAME_RE = /^[a-z0-9-_]{1,40}$/;
const TOOL_NAME_RE = /^[a-z0-9_]{1,64}$/;

export function pluginsDir(): string {
  return path.join(anvilHome(), "plugins");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateManifest(raw: unknown): { manifest?: PluginManifest; error?: string } {
  if (!isRecord(raw)) return { error: "plugin.json must be an object" };
  const name = raw.name;
  const version = raw.version;
  if (typeof name !== "string" || !PLUGIN_NAME_RE.test(name)) {
    return { error: "plugin name must match [a-z0-9-_]{1,40}" };
  }
  if (typeof version !== "string" || version.length === 0) {
    return { error: "plugin version must be a non-empty string" };
  }
  const toolsRaw = raw.tools ?? [];
  if (!Array.isArray(toolsRaw)) return { error: '"tools" must be an array' };
  if (toolsRaw.length > PLUGIN_MAX_TOOLS) {
    return { error: `too many tools (max ${PLUGIN_MAX_TOOLS})` };
  }
  const tools: PluginManifest["tools"] = [];
  for (const entry of toolsRaw) {
    if (!isRecord(entry)) return { error: "tool entries must be objects" };
    const toolName = entry.name;
    const description = entry.description;
    const command = entry.command;
    if (typeof toolName !== "string" || !TOOL_NAME_RE.test(toolName)) {
      return { error: `tool name must match [a-z0-9_]{1,64} (got ${JSON.stringify(toolName)})` };
    }
    if (typeof description !== "string" || description.length === 0) {
      return { error: `tool ${toolName} needs a description` };
    }
    if (typeof command !== "string" || command.length === 0) {
      return { error: `tool ${toolName} needs a command template` };
    }
    tools.push({ name: toolName, description, command });
  }
  const manifest: PluginManifest = {
    name,
    version,
    tools,
    enabled: raw.enabled === undefined ? true : raw.enabled === true,
  };
  if (typeof raw.description === "string") manifest.description = raw.description;
  if (typeof raw.systemPrompt === "string") manifest.systemPrompt = raw.systemPrompt;
  return { manifest };
}

/**
 * Load all plugins. Missing dir → empty. Never throws; problems are reported.
 */
export function loadPlugins(dir: string = pluginsDir()): { plugins: LoadedPlugin[]; problems: PluginProblem[] } {
  const plugins: LoadedPlugin[] = [];
  const problems: PluginProblem[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { plugins, problems };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, "plugin.json");
    let text: string;
    try {
      text = fs.readFileSync(manifestPath, "utf8");
    } catch {
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err: unknown) {
      problems.push({ name: entry.name, error: `invalid JSON: ${getErrorMessage(err)}` });
      continue;
    }
    const { manifest, error } = validateManifest(raw);
    if (!manifest || error) {
      problems.push({ name: entry.name, error: error ?? "invalid manifest" });
      continue;
    }
    plugins.push({ manifest, dir: path.join(dir, entry.name), enabled: manifest.enabled !== false });
  }
  return { plugins, problems };
}

/** Combined system-prompt additions from enabled plugins. */
export function pluginSystemPrompts(plugins: LoadedPlugin[]): string[] {
  return plugins
    .filter((p) => p.enabled && typeof p.manifest.systemPrompt === "string")
    .map((p) => p.manifest.systemPrompt as string)
    .filter((s) => s.trim().length > 0);
}
