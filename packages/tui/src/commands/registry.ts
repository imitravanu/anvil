import {
  AgentSession,
  TOOL_DEFINITIONS,
  collectMcpToolDefs,
  createOpenRouterFreeSource,
  listSessions,
  loadSession,
  renameSession,
  syncFreeModels,
} from "@anvil/core";
import { Command, CommandContext, CommandHandlerDeps } from "./types.js";
import { formatLedger } from "../util/ledger.js";
import { formatMcpStatus } from "../util/mcp.js";
import { formatRewindList, formatRewindResult } from "../util/rewind.js";
import { curtail, relativeTime } from "../util/format.js";
import { SESSION_TITLE_MAX } from "../util/displayLimits.js";

export const COMMANDS: Command[] = [
  {
    name: "help",
    description: "List available commands",
    run: (_args, ctx) => {
      // one concrete usage example per command.
      const EXAMPLES: Record<string, string> = {
        clear: "e.g. /clear — fresh transcript; the old session stays resumable",
        connect: "e.g. /connect — pick a provider, paste its API key",
        expand: "e.g. /expand — toggle full tool output on/off",
        ledger: "e.g. /ledger — what ran, what failed, tokens spent",
        mcp: "e.g. /mcp reconnect — refresh all servers",
        model: "e.g. /model — Enter switches, Esc cancels",
        rewind: "e.g. /rewind 2 — restore checkpoint #2 (plain /rewind lists them)",
        session: "e.g. /session resume — with no id it opens the picker",
        sync: "e.g. /sync — force a free-model refresh now",
        theme: "e.g. /theme — arrow through with live preview, Enter applies",
      };
      const lines = COMMANDS.map(
        (c) => `/${c.name} — ${c.description}${EXAMPLES[c.name] ? `\n    ${EXAMPLES[c.name]}` : ""}`
      ).join("\n");
      ctx.printSystemMessage(lines);
    },
  },
  {
    name: "clear",
    description: "Clear the conversation history",
    run: (_args, ctx) => {
      ctx.clearHistory(); // prints its own confirmation (may mention resuming)
    },
  },
  {
    name: "model",
    description: "Switch model or provider",
    run: (_args, ctx) => ctx.openModelPicker(),
  },
  {
    name: "sync",
    description: "Sync live free models (auto-catches pricing & model changes)",
    run: async (_args, ctx) => {
      ctx.printSystemMessage("Checking free-model sources for live updates...");
      // force through the single coordinator; errors are reported,
      // never swallowed.
      const report = await syncFreeModels({
        sources: [createOpenRouterFreeSource()],
        ttlMs: 0,
      });
      let msg = report.refreshedAt
        ? `✓ Refreshed free-model list (${report.results.reduce((m, r) => m + r.count, 0)} known free models).`
        : "✓ No refresh needed — data is current.";
      for (const r of report.results) {
        if (!r.ok) {
          msg += `\n  ✗ ${r.sourceId}: ${r.error ?? "unknown error"}`;
          continue;
        }
        if (r.newlyFree.length > 0) {
          msg += `\n  + ${r.newlyFree.length} new free: ${r.newlyFree.slice(0, 6).join(", ")}${r.newlyFree.length > 6 ? " …" : ""}`;
        }
        if (r.noLongerFree.length > 0) {
          msg += `\n  - ${r.noLongerFree.length} became paid: ${r.noLongerFree.slice(0, 6).join(", ")}${r.noLongerFree.length > 6 ? " …" : ""}`;
        }
      }
      if (report.errors.length > 0) {
        msg += `\n  ⚠ ${report.errors.length} source(s) failed: ${report.errors.join("; ")}`;
      }
      ctx.printSystemMessage(msg);
    },
  },
  {
    name: "session",
    description: "Sessions: list | new | resume [id] | rename <title>",
    run: (args, ctx) => {
      const [sub, ...rest] = args;
      switch (sub) {
        case undefined:
        case "list":
          ctx.sessionList();
          break;
        case "new":
          ctx.sessionNew();
          break;
        case "resume":
          ctx.sessionResume(rest[0]);
          break;
        case "rename": {
          const title = rest.join(" ").trim();
          if (!title) {
            ctx.printSystemMessage("Usage: /session rename <title>");
            break;
          }
          ctx.sessionRename(title);
          break;
        }
        default:
          ctx.printSystemMessage(
            `Unknown /session subcommand: ${sub}. Try /session list | new | resume [id] | rename <title>.`
          );
      }
    },
  },
  {
    name: "connect",
    description: "Add or update a provider API key",
    run: (_args, ctx) => ctx.openConnect(),
  },
  {
    name: "ledger",
    description: "Show this session's run ledger (what ran, tokens spent)",
    run: (_args, ctx) => ctx.showLedger(),
  },
  {
    name: "expand",
    description: "Toggle full tool output in the transcript",
    run: (_args, ctx) => ctx.toggleExpand(),
  },
  {
    name: "rewind",
    description: "List file checkpoints, or restore one: /rewind <n>",
    run: (args, ctx) => ctx.rewind(args[0]),
  },
  {
    name: "mcp",
    description: "MCP servers: status, or refresh all: /mcp reconnect",
    run: (args, ctx) => ctx.mcp(args[0]),
  },
  {
    name: "theme",
    description: "Switch theme (live preview; built-in or ~/.anvil/themes.json custom)",
    run: (args, ctx) => {
      const name = args[0];
      // Bare /theme opens the interactive picker with live preview — the old
      // dead-end usage message made the command look broken.
      if (name) ctx.setTheme(name);
      else ctx.openThemePicker();
    },
  },
];

export function parseCommand(input: string): { name: string; args: string[] } | null {
  if (!input.startsWith("/")) return null;
  const [name, ...args] = input.slice(1).trim().split(/\s+/);
  return { name, args };
}

/**
 * P3 single-touch commands: the one constructor for CommandContext.
 * New commands add a registry entry above (+ a context method here if they
 * need session access) — App.tsx and hooks never change for new commands.
 * Built fresh per call so guards (isBusy, session identity) never go stale.
 */
export function makeHandlers(deps: CommandHandlerDeps): CommandContext {
  const {
    session,
    providers,
    activeProviderId,
    currentModel,
    sessionOptions,
    broker,
    mcp,
    isBusy,
    printSystemMessage,
    clearMessages,
    persist,
    resumeFromStored,
    applyTheme,
    setSession,
    setIsModelPickerOpen,
    setIsSessionPickerOpen,
    setIsConnectOpen,
    setIsThemePickerOpen,
    setExpandTools,
  } = deps;
  return {
    clearHistory: () => {
      if (isBusy) {
        printSystemMessage("Cannot clear the conversation while a turn is in flight.");
        return;
      }
      // Keep the old session file intact so /clear is recoverable via
      // /session resume, and give the cleared conversation a new session id.
      const fresh = new AgentSession(providers[activeProviderId], {
        ...sessionOptions,
        model: currentModel,
        permissionBroker: broker,
      });
      setSession(fresh);
      clearMessages();
      printSystemMessage("Conversation cleared. The previous session can be resumed with /session.");
    },
    openModelPicker: () => {
      if (isBusy) {
        printSystemMessage("Cannot switch models while a turn is in flight.");
        return;
      }
      setIsModelPickerOpen(true);
    },
    printSystemMessage,
    sessionList: () => {
      const metas = listSessions();
      if (metas.length === 0) {
        printSystemMessage("No saved sessions.");
        return;
      }
      // Human scale: title, model, age, and a short id — full UUIDs and raw
      // ISO timestamps are machine noise in a chat transcript.
      printSystemMessage(
        metas
          .map(
            (m) =>
              `${m.id.slice(0, 8)}  ${curtail(m.title, SESSION_TITLE_MAX)}  ·  ${m.model}  ·  ${relativeTime(m.updatedAt)}`
          )
          .join("\n")
      );
    },
    sessionNew: () => {
      if (isBusy) {
        printSystemMessage("Cannot start a new session while a turn is in flight.");
        return;
      }
      const fresh = new AgentSession(providers[activeProviderId], {
        ...sessionOptions,
        model: currentModel,
        permissionBroker: broker,
      });
      setSession(fresh);
      clearMessages();
      printSystemMessage("Started a new session.");
    },
    sessionResume: (id?: string) => {
      if (isBusy) {
        printSystemMessage("Cannot resume a session while a turn is in flight.");
        return;
      }
      if (!id) {
        setIsSessionPickerOpen(true);
        return;
      }
      const stored = loadSession(id);
      if (!stored) {
        printSystemMessage(`No saved session found with id ${id}.`);
        return;
      }
      resumeFromStored(stored);
    },
    sessionRename: (title: string) => {
      if (isBusy) {
        printSystemMessage("Cannot rename the session while a turn is in flight.");
        return;
      }
      renameSession(session.id, title);
      printSystemMessage(`Session renamed to "${title}".`);
    },
    setTheme: applyTheme,
    openThemePicker: () => {
      if (isBusy) {
        printSystemMessage("Cannot switch themes while a turn is in flight.");
        return;
      }
      setIsThemePickerOpen(true);
    },
    openConnect: () => {
      if (isBusy) {
        printSystemMessage("Cannot connect a provider while a turn is in flight.");
        return;
      }
      setIsConnectOpen(true);
    },
    showLedger: () => {
      printSystemMessage(formatLedger(session.getRunLedger()));
    },
    toggleExpand: () => {
      setExpandTools((prev) => {
        printSystemMessage(prev ? "Tool output expansion off." : "Tool output expansion on — full results shown.");
        return !prev;
      });
    },
    rewind: (idText?: string) => {
      if (isBusy) {
        printSystemMessage("Cannot rewind while a turn is in flight.");
        return;
      }
      if (idText === undefined) {
        printSystemMessage(formatRewindList(session.getCheckpoints()));
        return;
      }
      const idTextTrimmed = idText.trim();
      // Strict decimal: Number() accepts hex ("0x10"), exponents, and
      // whitespace — none of which are checkpoint ids.
      if (!/^\d+$/.test(idTextTrimmed)) {
        printSystemMessage(`Usage: /rewind <n> — n is a checkpoint number from /rewind.`);
        return;
      }
      const id = Number(idTextTrimmed);
      if (!Number.isSafeInteger(id) || id <= 0) {
        printSystemMessage(`Usage: /rewind <n> — n is a checkpoint number from /rewind.`);
        return;
      }
      void session.rewind(id).then((result) => {
        printSystemMessage(formatRewindResult(result));
        persist();
      }).catch((err: unknown) => {
        printSystemMessage(`Rewind failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    mcp: (sub?: string) => {
      const conns = mcp?.list() ?? [];
      const notices = mcp?.notices ?? [];
      if (sub === undefined || sub === "status") {
        printSystemMessage(formatMcpStatus(conns, notices));
        return;
      }
      if (sub === "reconnect") {
        if (isBusy) {
          printSystemMessage("Cannot reconnect MCP servers while a turn is in flight.");
          return;
        }
        if (!mcp) {
          printSystemMessage(formatMcpStatus([], notices));
          return;
        }
        printSystemMessage("Reconnecting MCP servers...");
        void mcp.reconnect().then((report) => {
          // Hot-reload: rebuild the session's tool list from the live
          // connections so new servers work without a restart. Sub-agents
          // inherit the parent list, so delegation sees them too.
          const kept = collectMcpToolDefs(
            mcp.list(),
            TOOL_DEFINITIONS.map((d) => d.name)
          );
          let hotReloaded = "";
          try {
            session.setTools([...TOOL_DEFINITIONS, ...kept]);
            hotReloaded = ` ${kept.length} MCP tool(s) live in this session.`;
          } catch (err: unknown) {
            hotReloaded = ` (Tools NOT hot-loaded: ${err instanceof Error ? err.message : String(err)})`;
          }
          const fresh = [...notices, ...report.problems.map((p) => `MCP ${p}`)];
          printSystemMessage(
            `Reconnected: ${report.connected} server(s), ${report.tools} tool(s).` +
            `${hotReloaded}\n` +
            formatMcpStatus(mcp.list(), fresh)
          );
        }).catch((err: unknown) => {
          printSystemMessage(`MCP reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        return;
      }
      printSystemMessage(`Unknown /mcp subcommand: ${sub}. Try /mcp or /mcp reconnect.`);
    },
  };
}