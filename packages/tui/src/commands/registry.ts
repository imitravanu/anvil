import { Command, CommandContext, CommandHandlerDeps } from "./types.js";
import { formatLedger } from "../util/ledger.js";
import { handleSyncFreeModels } from "./handlers/sync.js";
import {
  handleClearHistory,
  handleSessionList,
  handleSessionNew,
  handleSessionResume,
  handleSessionRename,
  handleRetryLast,
} from "./handlers/session.js";
import { handleShowDiff, handleCreatePr } from "./handlers/diff.js";
import { handleMcp } from "./handlers/mcp.js";
import { handleRewind } from "./handlers/rewind.js";
import { handleAttachImage } from "./handlers/media.js";
import { handleLaunchGoal } from "./handlers/goal.js";
import { handleContext, handlePlugin, handleTeam } from "./handlers/phase25.js";
import { handleCopy } from "./handlers/clipboard.js";

export const COMMANDS: Command[] = [
  {
    name: "help",
    description: "List available commands",
    run: (_args, ctx) => {
      const EXAMPLES: Record<string, string> = {
        clear: "e.g. /clear — fresh transcript; the old session stays resumable",
        connect: "e.g. /connect — pick a provider, paste its API key",
        expand: "e.g. /expand — toggle full tool output on/off",
        image: "e.g. /image diagram.png — then ask about it",
        ledger: "e.g. /ledger — what ran, what failed, tokens spent",
        retry: "e.g. /retry actually use python 3.12 — retry with corrected wording",
        diff: "e.g. /diff or /diff main — review session edits or branch diff",
        goal: "e.g. /goal add user auth — autonomous plan, execution & critique",
        pr: "e.g. /pr — create a GitHub pull request via gh",
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
      ctx.clearHistory();
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
    run: async (_args, ctx) => handleSyncFreeModels(ctx.printSystemMessage),
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
    name: "image",
    description: "Attach an image (png/jpeg/webp/gif) to your next message",
    run: (args, ctx) => ctx.attachImage(args.join(" ").trim()),
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
    name: "retry",
    description: "Re-run your last message (drops the previous answer first)",
    run: (args, ctx) => ctx.retryLast(args.join(" ").trim() || undefined),
  },
  {
    name: "diff",
    description: "Review file changes: /diff (session changes) or /diff <branch>",
    run: (args, ctx) => ctx.showDiff(args[0]),
  },
  {
    name: "pr",
    description: "Create a GitHub pull request for the current branch (via gh)",
    run: (_args, ctx) => ctx.createPr(),
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
      if (name) ctx.setTheme(name);
      else ctx.openThemePicker();
    },
  },
  {
    name: "goal",
    description: "Launch an autonomous mission: /goal <objective>",
    run: (args, ctx) => {
      const objective = args.join(" ").trim();
      if (!objective) {
        ctx.printSystemMessage("Usage: /goal <objective> — launch an autonomous multi-step engineering mission");
        return;
      }
      ctx.launchGoal(objective);
    },
  },
  {
    name: "team",
    description: "Multi-agent teams: /team status",
    run: (args, ctx) => ctx.team(args),
  },
  {
    name: "plugin",
    description: "Plugins: /plugin list",
    run: (args, ctx) => ctx.plugin(args),
  },
  {
    name: "context",
    description: "Show token budget breakdown and compaction forecast",
    run: (_args, ctx) => ctx.showContext(),
  },
  {
    name: "copy",
    description: "Copy the newest code block to the clipboard (OSC 52)",
    run: (_args, ctx) => ctx.copyLast(),
  },
];

export function parseCommand(input: string): { name: string; args: string[] } | null {
  if (!input.startsWith("/")) return null;
  const [name, ...args] = input.slice(1).trim().split(/\s+/);
  return { name, args };
}

export function makeHandlers(deps: CommandHandlerDeps): CommandContext {
  const { isBusy, printSystemMessage, applyTheme, setIsModelPickerOpen, setIsThemePickerOpen, setIsConnectOpen, session, setExpandTools } = deps;
  return {
    clearHistory: () => handleClearHistory(deps),
    openModelPicker: () => {
      if (isBusy) {
        printSystemMessage("Cannot switch models while a turn is in flight.");
        return;
      }
      setIsModelPickerOpen(true);
    },
    printSystemMessage,
    sessionList: () => handleSessionList(deps),
    sessionNew: () => handleSessionNew(deps),
    sessionResume: (id?: string) => handleSessionResume(deps, id),
    sessionRename: (title: string) => handleSessionRename(deps, title),
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
      const turningOn = !deps.expandTools;
      setExpandTools(turningOn);
      printSystemMessage(
        turningOn ? "Tool output expansion on — full results shown." : "Tool output expansion off."
      );
    },
    rewind: (idText?: string) => handleRewind(deps, idText),
    attachImage: (rawPath: string) => handleAttachImage(deps, rawPath),
    retryLast: (replacement?: string) => handleRetryLast(deps, replacement),
    showDiff: (branch?: string) => handleShowDiff(deps, branch),
    createPr: () => handleCreatePr(deps),
    mcp: (sub?: string) => handleMcp(deps, sub),
    launchGoal: (objective: string) => handleLaunchGoal(deps, objective),
    team: (args: string[]) => handleTeam(deps, args),
    plugin: (args: string[]) => handlePlugin(deps, args),
    showContext: () => handleContext(deps),
    copyLast: () => handleCopy(deps),
  };
}
