import { describe, expect, it } from "vitest";
import { HistoryStore } from "../historyStore.js";
import type { PreparedCall } from "../loopGuard.js";

const prepared = (id: string): PreparedCall => ({
  call: { id, name: "read_file", input: { path: "a.ts" } },
  def: undefined,
  key: `read_file:${id}`,
  refused: false,
  loopWarn: false,
  repeatWarn: false,
});

describe("HistoryStore.pushToolResults", () => {
  it("skips the push when there are no results and no notes (no empty user message)", () => {
    const h = new HistoryStore();
    h.pushUserText("hello");
    const before = h.snapshot().length;
    h.pushToolResults([], new Map(), []);
    expect(h.snapshot()).toHaveLength(before);
  });

  it("still pushes notes-only results", () => {
    const h = new HistoryStore();
    h.pushUserText("hello");
    h.pushToolResults([], new Map(), ["loop warning"]);
    const last = h.snapshot().at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toHaveLength(1);
  });

  it("pushes real tool results in declared order", () => {
    const h = new HistoryStore();
    h.pushUserText("hello");
    h.pushToolResults([prepared("t1")], new Map([["t1", { output: { ok: true }, isError: false, summary: "ok" }]]), []);
    const last = h.snapshot().at(-1)!;
    expect(last.content).toHaveLength(1);
    expect(last.content[0].type).toBe("tool_result");
  });
});
