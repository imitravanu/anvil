import { spawnSync } from "node:child_process";
import { getErrorMessage } from "../errors.js";
import { registerExternalExecutor } from "../tools/index.js";
import type { ToolDefinition } from "../tools/types.js";
import type { LoadedPlugin } from "./types.js";

export const PLUGIN_TOOL_PREFIX = "plugin_";

/**
 * Render a tool's command template with `{input}` replaced by the JSON of the
 * argument object. Uses the replacement-FUNCTION form of `String.replace`:
 * the literal form treats `$&` / `` $` `` / `$'` inside the JSON as pattern
 * references, so a model-controlled input containing `$&` would corrupt (or
 * inject into) the rendered shell command.
 *
 * TRUST NOTE (known limitation): the result is executed by `bash -c`, and the
 * substituted JSON is MODEL-controlled. A template that splices `{input}`
 * unquoted therefore exposes shell metacharacters in the input to the shell
 * (`{input}` of `{"x":"; rm -rf ~"}` parses as a second command). This is the
 * plugin author's explicit shell extension point and every plugin tool is
 * `mutating: true`, so the permission prompt is the gate — but templates should
 * quote the placeholder (e.g. `myscript --json '{input}'`) and the prompt shows
 * the tool, not the rendered command. Passing the JSON as a real argv element
 * instead of splicing it into the shell string is the durable fix.
 */
export function renderCommand(template: string, input: unknown): string {
  const json = JSON.stringify(input ?? {});
  // replaceAll with a function replacement: every `{input}` is replaced, and
  // the function's return is used verbatim (no $& / $` / $' expansion).
  return template.replaceAll("{input}", () => json);
}

/**
 * Register one plugin's tools as external executors. Each tool runs its
 * command template in the project root with {input} replaced by JSON.
 * Unknown external tools gate through the normal permission prompt.
 */
export function pluginToolDefinitions(plugin: LoadedPlugin): ToolDefinition[] {
  if (!plugin.enabled) return [];
  return (plugin.manifest.tools ?? []).map((t) => ({
    name: `${PLUGIN_TOOL_PREFIX}${plugin.manifest.name}__${t.name}`,
    description: `[plugin:${plugin.manifest.name}] ${t.description}`,
    inputSchema: { type: "object" },
    mutating: true,
  }));
}

export function registerPluginExecutors(plugins: LoadedPlugin[]): ToolDefinition[] {
  const defs: ToolDefinition[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    const tools = plugin.manifest.tools ?? [];
    if (tools.length === 0) continue;
    const prefix = `${PLUGIN_TOOL_PREFIX}${plugin.manifest.name}__`;
    const byName = new Map(tools.map((t) => [`${prefix}${t.name}`, t]));
    for (const [fullName, tool] of byName) {
      defs.push({
        name: fullName,
        description: `[plugin:${plugin.manifest.name}] ${tool.description}`,
        inputSchema: { type: "object" },
        mutating: true,
      });
    }
    registerExternalExecutor(
      prefix,
      async (name, input, ctx) => {
        const tool = byName.get(name);
        if (!tool) return { claimed: false };
        const rendered = renderCommand(tool.command, input);
        const child = spawnSync("bash", ["-c", rendered], {
          cwd: ctx.projectRoot,
          timeout: 60_000,
          encoding: "utf8",
          maxBuffer: 512 * 1024,
        });
        if (child.error) {
          return {
            claimed: true,
            result: { output: { error: getErrorMessage(child.error) }, isError: true, summary: `${name} failed` },
          };
        }
        if (child.status !== 0) {
          const detail = (child.stderr || child.stdout || `exit ${child.status}`).slice(0, 2000);
          return {
            claimed: true,
            result: { output: { error: detail }, isError: true, summary: `${name} exited ${child.status}` },
          };
        }
        return {
          claimed: true,
          result: {
            output: { stdout: (child.stdout || "").slice(0, 8000) },
            isError: false,
            summary: `${name} ran`,
          },
        };
      },
      async (input) => `${JSON.stringify(input).slice(0, 200)}`
    );
  }
  return defs;
}
