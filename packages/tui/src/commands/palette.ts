import type { Command } from "./types.js";

/**
 * DW-3.2 — command palette matching. Pure: prefix matches first (registry
 * order), then fuzzy subsequence matches; ties break by MRU, then registry
 * order. Empty query lists everything with MRU boosted to the top.
 */

export interface RankedCommand {
  command: Command;
  /** 0 = prefix/name match, 1 = fuzzy — lower ranks first. */
  rank: number;
}

function isSubsequence(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

export function filterCommands(
  commands: readonly Command[],
  query: string,
  mru: readonly string[] = []
): Command[] {
  const q = query.trim().toLowerCase();
  const mruIndex = new Map(mru.map((name, i) => [name, i]));
  const ranked: { command: Command; rank: number; mru: number; order: number }[] = [];
  commands.forEach((command, order) => {
    const name = command.name.toLowerCase();
    let rank: number;
    if (q.length === 0 || name.startsWith(q)) rank = 0;
    else if (isSubsequence(q, name)) rank = 1;
    else return;
    ranked.push({ command, rank, mru: mruIndex.get(command.name) ?? Number.MAX_SAFE_INTEGER, order });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.mru - b.mru || a.order - b.order);
  return ranked.map((r) => r.command);
}

/** Category icon per command (spec §3.2) — fallback dot for new commands. */
const COMMAND_ICONS: Record<string, string> = {
  goal: "🎯",
  model: "🔄",
  diff: "📝",
  rewind: "⏪",
  session: "💾",
  theme: "🎨",
  connect: "🔑",
  ledger: "📊",
  mcp: "🔧",
  sync: "🔄",
  clear: "🧹",
  help: "❓",
  image: "🖼",
  retry: "↩",
  expand: "🔍",
  pr: "⬆",
  team: "👥",
  plugin: "🧩",
  context: "📏",
};

export function commandIcon(name: string): string {
  return COMMAND_ICONS[name] ?? "•";
}
