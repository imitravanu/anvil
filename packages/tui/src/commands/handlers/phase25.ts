import {
  contextBreakdown,
  detectLspServers,
  getErrorMessage,
  loadPlugins,
  CONTEXT_WARN_THRESHOLD,
  FALLBACK_CONTEXT_WINDOW,
} from "@anvil/core";
import type { CommandHandlerDeps } from "../types.js";

/** /context — token budget breakdown + predictive compaction warning. */
export function handleContext(deps: CommandHandlerDeps): void {
  try {
    const history = deps.session.getHistory();
    // A5: use the session's real model window, not the 32k fallback, so the
    // reported utilization matches what the compaction loop actually compares
    // against (session.ts uses modelInfo?.contextWindow ?? FALLBACK_CONTEXT_WINDOW).
    const window = deps.session.contextWindow ?? FALLBACK_CONTEXT_WINDOW;
    const breakdown = contextBreakdown(history, window, CONTEXT_WARN_THRESHOLD);
    const pct = (breakdown.utilization * 100).toFixed(1);
    const lines = [
      `Context: ${breakdown.totalTokens} tokens / ~${window} (${pct}%) across ${breakdown.messageCount} message(s)`,
      `  user: ${breakdown.byRole.user} · assistant: ${breakdown.byRole.assistant} · tools: ${breakdown.toolTokens} · text: ${breakdown.textTokens}`,
      breakdown.shouldWarn
        ? "Near budget — compaction will summarize older history soon."
        : "Budget healthy.",
    ];
    deps.printSystemMessage(lines.join("\n"));
  } catch (err: unknown) {
    deps.printSystemMessage(`Cannot read context: ${getErrorMessage(err)}`);
  }
}

/** /team — inspect multi-agent collaboration status. */
export function handleTeam(deps: CommandHandlerDeps, args: string[]): void {
  const sub = args[0];
  if (!sub || sub === "status") {
    // Phase 25.2 → product: the session records the last completed team run
    // (AgentSession.teamRun, set by delegate_task's runTeam path). Live member
    // progress streams as subagent events; this reports the last settled state.
    const run = deps.session.teamRun;
    if (!run) {
      deps.printSystemMessage(
        "Teams: no team run in this session yet. Ask the model to run parallel work (e.g. \"implement the feature while writing tests in parallel\") and it will coordinate via the team runner (parallel | pipeline | review)."
      );
      return;
    }
    const totals = `${run.totalToolCalls} tool call(s), ${run.totalInputTokens}→${run.totalOutputTokens} tokens`;
    const lines = [
      `Team (${run.strategy}): ${run.members.length} member(s), ${totals}`,
      ...run.members.map((m) => {
        const status = m.aborted ? "aborted" : m.failureReason ? "failed" : "ok";
        const reason = m.failureReason ? ` — ${m.failureReason}` : "";
        return `  • ${m.id}: ${status}, ${m.toolCalls} call(s), report ${m.report.length} char(s)${reason}`;
      }),
    ];
    deps.printSystemMessage(lines.join("\n"));
    return;
  }
  deps.printSystemMessage(`Unknown /team subcommand: ${sub}. Try /team status.`);
}

/** /plugin — list, inspect plugin registry. */
export function handlePlugin(deps: CommandHandlerDeps, args: string[]): void {
  const sub = args[0];
  if (!sub || sub === "list") {
    try {
      const { plugins, problems } = loadPlugins();
      if (plugins.length === 0 && problems.length === 0) {
        deps.printSystemMessage("No plugins installed. Add one at ~/.anvil/plugins/<name>/plugin.json.");
        return;
      }
      const lines = plugins.map(
        (p) => `${p.enabled ? "enabled" : "disabled"} ${p.manifest.name}@${p.manifest.version} — ${(p.manifest.tools ?? []).length} tool(s)`
      );
      for (const problem of problems) lines.push(`problem ${problem.name}: ${problem.error}`);
      deps.printSystemMessage(lines.join("\n"));
    } catch (err: unknown) {
      deps.printSystemMessage(`Cannot list plugins: ${getErrorMessage(err)}`);
    }
    return;
  }
  if (sub === "lsp") {
    const servers = detectLspServers();
    deps.printSystemMessage(
      servers.length === 0
        ? "No language servers on PATH (checked typescript-language-server, pyright-langserver, rust-analyzer, gopls). Code tools use the fallback engine."
        : servers.map((s) => `${s.language}: ${s.command} ${s.args.join(" ")}`).join("\n")
    );
    return;
  }
  deps.printSystemMessage(`Unknown /plugin subcommand: ${sub}. Try /plugin list.`);
}
