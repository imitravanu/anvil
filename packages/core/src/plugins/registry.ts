import { spawnSync } from "node:child_process";
import { getErrorMessage } from "../errors.js";
import { log } from "../logger.js";
import { registerExternalExecutor } from "../tools/index.js";
import type { ToolDefinition } from "../tools/types.js";
import type { LoadedPlugin, PluginToolDef } from "./types.js";
import {
  PLUGIN_TOOL_TIMEOUT_MS,
  PLUGIN_TOOL_MAX_BUFFER_BYTES,
  PLUGIN_TOOL_ERROR_MAX_CHARS,
  PLUGIN_TOOL_STDOUT_MAX_CHARS,
} from "../config/constants.js";

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
 * Shell metacharacters that a spliced `{input}` could turn into a second
 * command (`; rm -rf ~`), a redirection, or a substitution — the documented
 * limitation of the legacy `bash -c` splice. The argv form never needed this
 * check; the legacy form now REFUSES such input instead of relying on the
 * user to read the rendered command in the prompt. JSON-escaped quotes and
 * structural punctuation are always safe: JSON.stringify emits none of these
 * bytes unescaped except in string content, which is exactly what we test.
 */
const SHELL_METACHARS = /[;&|<>`$\\]/;

/** True when the model-controlled JSON contains a shell metacharacter. */
export function inputHasShellMetachars(input: unknown): boolean {
  const json = JSON.stringify(input ?? {});
  return SHELL_METACHARS.test(json);
}

/**
 * Build the argv for an argv-mode plugin tool: the input JSON fills every
 * `{input}` element and stays ONE argv element, so no shell can re-parse it.
 * Pure — unit-tested without spawning anything.
 */
export function buildArgv(tool: PluginToolDef, input: unknown): string[] {
  const json = JSON.stringify(input ?? {});
  return (tool.args ?? []).map((a) => a.replaceAll("{input}", () => json));
}

/** True when a tool declares the shell-free argv form. */
function usesArgv(tool: PluginToolDef): boolean {
  return Array.isArray(tool.args) && tool.args.length > 0;
}

/**
 * Register one plugin's tools as external executors. Each tool runs in the
 * project root: argv-mode tools spawn `command` directly with NO shell, and
 * legacy `command` templates keep the `bash -c` splice. Unknown external tools
 * gate through the normal permission prompt, whose preview shows the real
 * command in both forms.
 */
export function registerPluginExecutors(plugins: LoadedPlugin[]): ToolDefinition[] {
  const defs: ToolDefinition[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    const tools = plugin.manifest.tools ?? [];
    if (tools.length === 0) continue;
    const prefix = `${PLUGIN_TOOL_PREFIX}${plugin.manifest.name}__`;
    // C19: a duplicate tool name used to collapse silently in this Map, so one
    // definition vanished with no signal at all. Keep the first declaration and
    // warn so the shadowed tool is visible instead of mysteriously missing.
    const byName = new Map<string, PluginToolDef>();
    for (const t of tools) {
      const fullName = `${prefix}${t.name}`;
      if (byName.has(fullName)) {
        log.warn(
          `[plugins] ${plugin.manifest.name}: duplicate tool "${t.name}" ignored (first declaration wins)`
        );
        continue;
      }
      byName.set(fullName, t);
    }
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
        // Legacy `bash -c` splice: model-controlled metacharacters would reach
        // the shell (documented limitation). Refuse instead of prompting — the
        // argv form is the supported way to pass such input.
        if (!usesArgv(tool) && inputHasShellMetachars(input)) {
          return {
            claimed: true,
            result: {
              output: {
                error:
                  `Plugin tool "${name}" uses the legacy shell form, and this input contains shell metacharacters ` +
                  `(; & | < > $ backslash backtick). Refused. Move the plugin tool to the argv form ` +
                  `("args": [...]) so the input is passed as data, or remove the metacharacters.`,
              },
              isError: true,
              summary: `${name} refused: shell metacharacters in input`,
            },
          };
        }
        const rendered = renderCommand(tool.command, input);
        // argv form: no shell, so model-controlled metacharacters stay inert
        // data in their own argv element. legacy form: the documented splice.
        const child = usesArgv(tool)
          ? spawnSync(tool.command, buildArgv(tool, input), {
              cwd: ctx.projectRoot,
              timeout: PLUGIN_TOOL_TIMEOUT_MS,
              encoding: "utf8",
              maxBuffer: PLUGIN_TOOL_MAX_BUFFER_BYTES,
            })
          : spawnSync("bash", ["-c", rendered], {
              cwd: ctx.projectRoot,
              timeout: PLUGIN_TOOL_TIMEOUT_MS,
              encoding: "utf8",
              maxBuffer: PLUGIN_TOOL_MAX_BUFFER_BYTES,
            });
        if (child.error) {
          return {
            claimed: true,
            result: { output: { error: getErrorMessage(child.error) }, isError: true, summary: `${name} failed` },
          };
        }
        if (child.status !== 0) {
          const detail = (child.stderr || child.stdout || `exit ${child.status}`).slice(0, PLUGIN_TOOL_ERROR_MAX_CHARS);
          return {
            claimed: true,
            result: { output: { error: detail }, isError: true, summary: `${name} exited ${child.status}` },
          };
        }
        return {
          claimed: true,
          result: {
            output: { stdout: (child.stdout || "").slice(0, PLUGIN_TOOL_STDOUT_MAX_CHARS) },
            isError: false,
            summary: `${name} ran`,
          },
        };
      },
      async (toolName, input) => {
        // Show the user what will actually run: the argv form has no shell, and
        // the legacy form's splice is exactly the string the shell will see.
        // The tool is resolved by name here (the executor is registered once per
        // PLUGIN, not per tool), so the preview is per-call, not stale.
        const tool = byName.get(toolName);
        if (!tool) return `bash -c ${renderCommand(prefix, input)}`;
        return usesArgv(tool)
          ? [tool.command, ...buildArgv(tool, input)].join(" ")
          : `bash -c ${renderCommand(tool.command, input)}`;
      }
    );
  }
  return defs;
}
