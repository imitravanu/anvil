import { Command } from "./types.js";

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
      ctx.clearHistory();
      ctx.printSystemMessage("Conversation cleared.");
    },
  },
  {
    name: "model",
    description: "Switch model or provider",
    run: (_args, ctx) => ctx.openModelPicker(),
  },
];

export function parseCommand(input: string): { name: string; args: string[] } | null {
  if (!input.startsWith("/")) return null;
  const [name, ...args] = input.slice(1).trim().split(/\s+/);
  return { name, args };
}