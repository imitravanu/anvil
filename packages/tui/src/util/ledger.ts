import type { RunLedgerEntry } from "@anvil/core";
import { LEDGER_MAX_ROWS } from "./displayLimits.js";

/**
 * U7 run-ledger UI: render the Phase 8 (A.1.5) append-only ledger as a
 * plain-text report for the /ledger command. Pure — App just prints it.
 */
export function formatLedger(entries: readonly RunLedgerEntry[]): string {
  if (entries.length === 0) return "No tool activity recorded this session.";

  const byOutcome: Record<string, number> = {};
  const byTool: Record<string, number> = {};
  let inTokens = 0;
  let outTokens = 0;
  for (const e of entries) {
    byOutcome[e.outcome] = (byOutcome[e.outcome] ?? 0) + 1;
    if (e.tool) byTool[e.tool] = (byTool[e.tool] ?? 0) + 1;
    if (e.tokens) {
      inTokens += e.tokens.in;
      outTokens += e.tokens.out;
    }
  }

  const outcomes = Object.entries(byOutcome)
    .map(([o, n]) => `${n} ${o}`)
    .join(", ");
  const tools = Object.entries(byTool)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ×${n}`)
    .join(", ");

  const lines = [
    `Ledger: ${entries.length} event${entries.length === 1 ? "" : "s"} (${outcomes})`,
    `Tokens on ledger: ${inTokens.toLocaleString()} in / ${outTokens.toLocaleString()} out (measured, per-entry)`,
  ];
  if (tools) lines.push(`Tools: ${tools}`);

  const tail = entries.slice(-LEDGER_MAX_ROWS);
  if (entries.length > tail.length) {
    lines.push(`… ${entries.length - tail.length} older event(s) omitted`);
  }
  for (const e of tail) {
    const tokens = e.tokens ? ` ${e.tokens.in}/${e.tokens.out}tok` : "";
    lines.push(`#${e.seq} ${e.eventType}${e.tool ? ` ${e.tool}` : ""} ${e.outcome}${tokens} ${e.elapsedMs}ms`);
  }
  return lines.join("\n");
}
