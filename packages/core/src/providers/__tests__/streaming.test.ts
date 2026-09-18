import { describe, expect, it } from "vitest";
import { ToolCallAssembler, ensureTurnEnd } from "../streaming.js";
import type { StreamEvent } from "../types.js";

async function collect(gen: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

async function* of(items: StreamEvent[]): AsyncGenerator<StreamEvent> {
  yield* items;
}

describe("ensureTurnEnd", () => {
  it("appends turn_end unknown when the stream ends without one", async () => {
    const events = await collect(ensureTurnEnd(of([{ type: "text_delta", text: "hi" }])));
    expect(events).toEqual([
      { type: "text_delta", text: "hi" },
      { type: "turn_end", stopReason: "unknown" },
    ]);
  });

  it("never duplicates an existing turn_end and never follows errors", async () => {
    const withEnd = await collect(
      ensureTurnEnd(of([{ type: "turn_end", stopReason: "end_turn" }]))
    );
    expect(withEnd).toEqual([{ type: "turn_end", stopReason: "end_turn" }]);
    const withError = await collect(
      ensureTurnEnd(of([{ type: "error", message: "boom" }]))
    );
    expect(withError).toEqual([{ type: "error", message: "boom" }]);
  });
});

describe("ToolCallAssembler", () => {
  it("defers start until the name is known, then streams cumulative deltas", () => {
    const asm = new ToolCallAssembler();
    // id-only first chunk: buffered silently, no nameless start
    expect(asm.push(0, { id: "call_9" })).toEqual([]);
    // name arrives: start fires with the frozen id
    expect(asm.push(0, { name: "read_file" })).toEqual([
      { type: "tool_call_start", id: "call_9", name: "read_file" },
    ]);
    expect(asm.push(0, { argsFragment: '{"a' })).toEqual([
      { type: "tool_call_delta", id: "call_9", cumulativeInputJson: '{"a' },
    ]);
    expect(asm.push(0, { argsFragment: '":1}' })).toEqual([
      { type: "tool_call_delta", id: "call_9", cumulativeInputJson: '{"a":1}' },
    ]);
    expect([...asm.drain()]).toEqual([
      { type: "tool_call_end", id: "call_9", name: "read_file", input: { a: 1 } },
    ]);
    expect(asm.pending).toBe(0);
  });

  it("freezes the id at first sight and orders ends by index", () => {
    const asm = new ToolCallAssembler();
    asm.push(1, { id: "second", name: "b" });
    asm.push(0, { id: "first", name: "a" });
    // A late conflicting id is ignored — start/end pairs never diverge.
    expect(asm.push(1, { id: "renamed" })).toEqual([]);
    expect([...asm.drain()].map((e) => (e as { id: string }).id)).toEqual(["first", "second"]);
  });

  it("falls back to a call_N id and {} input for a genuinely empty arg set", () => {
    const asm = new ToolCallAssembler();
    // Name only, no arguments at all: a legitimately empty call, not malformed.
    asm.push(3, { name: "f" });
    expect([...asm.drain()]).toEqual([
      { type: "tool_call_end", id: "call_3", name: "f", input: {} },
    ]);
    expect([...asm.drain()]).toEqual([]);
  });

  it("preserves malformed-JSON provenance instead of fabricating {}", () => {
    // Swallowing a parse failure to {} made all-optional tools run with invented
    // defaults and never told the model its JSON was bad. The executor and
    // orchestrator already turn this sentinel into a model-visible error — the
    // assembler was the one hole that made that path unreachable.
    const asm = new ToolCallAssembler();
    asm.push(3, { name: "f", argsFragment: "not json{" });
    expect([...asm.drain()]).toEqual([
      {
        type: "tool_call_end",
        id: "call_3",
        name: "f",
        input: { __parseError: true, rawInput: "not json{" },
      },
    ]);
    expect([...asm.drain()]).toEqual([]);
  });
});
