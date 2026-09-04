import { syncOpenRouterModels } from "@anvil/core";
import { Command } from "./types.js";
import { THEMES } from "../theme/themes.js";

export const COMMANDS: Command[] = [
  {
    name: "help",
    description: "List available commands",
    run: (_args, ctx) => {
      const lines = COMMANDS.map((c) => `/${c.name} — ${c.description}`).join("\n");
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
    description: "Sync live free models from OpenRouter (auto-catches pricing & model changes)",
    run: async (_args, ctx) => {
      ctx.printSystemMessage("Checking OpenRouter for live free model updates...");
      const res = await syncOpenRouterModels();
      let msg = `✓ Synced with OpenRouter: ${res.freeCount} free models active.`;
      if (res.newlyFree.length > 0) {
        msg += ` Added ${res.newlyFree.length} new free model(s): ${res.newlyFree.join(", ")}.`;
      }
      if (res.noLongerFree.length > 0) {
        msg += ` Note: ${res.noLongerFree.length} model(s) became paid and were marked [PAID]: ${res.noLongerFree.join(", ")}.`;
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
    name: "theme",
    description: `Switch theme (${Object.keys(THEMES).join(" | ")})`,
    run: (args, ctx) => {
      const name = args[0];
      if (!name) {
        ctx.printSystemMessage(`Usage: /theme <name>. Valid themes: ${Object.keys(THEMES).join(", ")}`);
        return;
      }
      ctx.setTheme(name);
    },
  },
];

export function parseCommand(input: string): { name: string; args: string[] } | null {
  if (!input.startsWith("/")) return null;
  const [name, ...args] = input.slice(1).trim().split(/\s+/);
  return { name, args };
}