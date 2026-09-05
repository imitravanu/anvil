import { describe, expect, it } from "vitest";
import type { RunLedgerEntry } from "@anvil/core";
import { formatLedger } from "../ledger.js";

function entry(partial: Partial<RunLedgerEntry> & { seq: number }): RunLedgerEntry {
  return {
    ts: "2026-09-05T00:00:00.000Z",
    eventType: "tool_finished",
    outcome: "ok",
    elapsedMs: 5,
    ...partial,
  };
}

describe("formatLedger", () => {
  it("reports an empty ledger honestly", () => {
    expect(formatLedger([])).toContain("No tool activity");
  });

  it("summarizes outcomes, tools, tokens, and recent rows", () => {
    const entries = [
      entry({ seq: 1, eventType: "tool_started", tool: "read_file", outcome: "ok", elapsedMs: 0 }),
      entry({ seq: 2, eventType: "tool_finished", tool: "read_file", outcome: "ok", tokens: { in: 100, out: 10 } }),
      entry({ seq: 3, eventType: "tool_permission_denied", tool: "run_command", outcome: "denied" }),
    ];
    const out = formatLedger(entries);
    expect(out).toContain("3 events");
    expect(out).toContain("2 ok");
    expect(out).toContain("1 denied");
    expect(out).toContain("read_file ×2");
    expect(out).toContain("run_command ×1");
    expect(out).toContain("100 in / 10 out");
    expect(out).toContain("#1 tool_started read_file ok");
    expect(out).toContain("#3 tool_permission_denied run_command denied");
  });

  it("caps rows at 15 with an omission notice", () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      entry({ seq: i + 1, tool: "read_file", outcome: "ok" })
    );
    const out = formatLedger(entries);
    expect(out).toContain("5 older event(s) omitted");
    expect(out).toContain("#20 ");
    expect(out).not.toContain("#1 ");
  });
});
