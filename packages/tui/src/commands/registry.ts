import { createOpenRouterFreeSource, syncFreeModels } from "@anvil/core";
import { Command } from "./types.js";
import { THEMES } from "../theme/themes.js";

export const COMMANDS: Command[] = [
  {
    name: "help",
    description: "List available commands",
    run: (_args, ctx) => {
      // Phase 8 (C5): one concrete usage example per command.
      const EXAMPLES: Record<string, string> = {
        clear: "e.g. /clear — fresh transcript; the old session stays resumable",
        connect: "e.g. /connect — pick a provider, paste its API key",
        model: "e.g. /model — Enter switches, Esc cancels",
        session: "e.g. /session resume — with no id it opens the picker",
        sync: "e.g. /sync — force a free-model refresh now",
        theme: "e.g. /theme dark | light | highContrast",
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
      // Phase 8 (B): force through the single coordinator; errors are reported,
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