import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ToolOrchestrator, type RunnableCall } from "../orchestrator.js";
import type { PreparedCall } from "../loopGuard.js";
import type { PermissionBroker } from "../types.js";
import type { RunLedgerEntry } from "../ledger.js";
import type { AgentEvent } from "../types.js";
import { TOOL_DEFINITIONS } from "../../tools/index.js";

function def(name: string) {
  const d = TOOL_DEFINITIONS.find((t) => t.name === name);
  if (!d) throw new Error(`unknown built-in tool ${name}`);
  return d;
}

let seq = 0;
function runnable(
  name: string,
  input: unknown,
  opts: { defMissing?: boolean } = {}
): RunnableCall {
  seq += 1;
  const call = { id: `c${seq}`, name, input };
  return {
    p: {
      call,
      def: opts.defMissing ? undefined : def(name),
      key: `${name}:${seq}`,
      refused: false,
      loopWarn: false,
      repeatWarn: false,
    } satisfies PreparedCall,
    startedAt: Date.now(),
  };
}

function broker(approved: boolean): PermissionBroker & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async requestPermission(name: string) {
      calls.push(name);
      return approved;
    },
  };
}

function ledger() {
  const entries: Omit<RunLedgerEntry, "seq" | "ts">[] = [];
  return {
    entries,
    recordLedger: (e: Omit<RunLedgerEntry, "seq" | "ts">) => {
      entries.push(e);
    },
  };
}

async function collect(
  gen: AsyncGenerator<AgentEvent, Map<string, unknown>>
): Promise<{ events: AgentEvent[]; results: Map<string, unknown> }> {
  const events: AgentEvent[] = [];
  let done = false;
  let results = new Map<string, unknown>();
  while (!done) {
    const next = await gen.next();
    if (next.done) {
      done = true;
      results = next.value;
    } else {
      events.push(next.value);
    }
  }
  return { events, results };
}

describe("ToolOrchestrator policy", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-orch-"));
    fs.writeFileSync(path.join(tmp, "a.txt"), "alpha");
    fs.writeFileSync(path.join(tmp, "b.txt"), "beta");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function orch(b: PermissionBroker, signal?: AbortSignal) {
    const l = ledger();
    const o = new ToolOrchestrator({
      projectRoot: tmp,
      permissionBroker: b,
      signal: signal ?? new AbortController().signal,
      recordLedger: l.recordLedger,
    });
    return { o, ledger: l };
  }

  it("runs a solo call serially and returns its result", async () => {
    const { o } = orch(broker(true));
    expect(o.isSerialBatch([runnable("read_file", { path: "a.txt" })])).toBe(true);
    const { events, results } = await collect(
      o.run([runnable("read_file", { path: "a.txt" })]) as AsyncGenerator<AgentEvent, Map<string, unknown>>
    );
    expect(events.map((e) => e.type)).toEqual(["tool_started", "tool_finished"]);
    expect(results.size).toBe(1);
  });

  it("runs all-read-only batches concurrently with re-ordered results", async () => {
    const { o } = orch(broker(true));
    const batch = [
      runnable("read_file", { path: "a.txt" }),
      runnable("read_file", { path: "b.txt" }),
    ];
    expect(o.isSerialBatch(batch)).toBe(false);
    const { events, results } = await collect(o.run(batch) as AsyncGenerator<AgentEvent, Map<string, unknown>>);
    expect(events.filter((e) => e.type === "tool_started")).toHaveLength(2);
    expect(events.filter((e) => e.type === "tool_finished")).toHaveLength(2);
    expect(results.size).toBe(2);
  });

  it("forces serial execution when any call is mutating", async () => {
    const { o } = orch(broker(true));
    const batch = [
      runnable("read_file", { path: "a.txt" }),
      runnable("write_file", { path: "c.txt", content: "new" }),
    ];
    expect(o.isSerialBatch(batch)).toBe(true);
    const { results } = await collect(o.run(batch) as AsyncGenerator<AgentEvent, Map<string, unknown>>);
    expect(results.size).toBe(2);
    expect(fs.readFileSync(path.join(tmp, "c.txt"), "utf8")).toBe("new");
  });

  it("treats unknown tools as mutating (serial) and reports them", async () => {
    const { o } = orch(broker(true));
    const batch = [
      runnable("read_file", { path: "a.txt" }),
      runnable("nope_tool", {}, { defMissing: true }),
    ];
    expect(o.isSerialBatch(batch)).toBe(true);
    const { events, results } = await collect(o.run(batch) as AsyncGenerator<AgentEvent, Map<string, unknown>>);
    const finished = events.filter((e) => e.type === "tool_finished");
    expect(finished).toHaveLength(2);
    expect(results.get(batch[1].p.call.id)).toMatchObject({ isError: true });
  });

  it("denied mutating tools never execute and record permission_denied", async () => {
    const b = broker(false);
    const { o, ledger: l } = orch(b);
    const call = runnable("write_file", { path: "denied.txt", content: "x" });
    const { events, results } = await collect(
      o.run([call]) as AsyncGenerator<AgentEvent, Map<string, unknown>>
    );
    expect(events.map((e) => e.type)).toEqual(["tool_permission_denied"]);
    // The denial IS recorded as the call's result (error), so history stays
    // replayable — but the file must not exist.
    expect(results.get(call.p.call.id)).toMatchObject({ isError: true });
    expect(fs.existsSync(path.join(tmp, "denied.txt"))).toBe(false);
    expect(l.entries.some((e) => e.eventType === "tool_permission_denied")).toBe(true);
    expect(b.calls).toEqual(["write_file"]);
  });

  it("aborted batches emit no tool_finished and record cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { o, ledger: l } = orch(broker(true), controller.signal);
    const { events, results } = await collect(
      o.run([
        runnable("read_file", { path: "a.txt" }),
        runnable("read_file", { path: "b.txt" }),
      ]) as AsyncGenerator<AgentEvent, Map<string, unknown>>
    );
    expect(events.filter((e) => e.type === "tool_finished")).toHaveLength(0);
    expect(results.size).toBe(0);
    expect(l.entries.every((e) => e.eventType === "cancelled")).toBe(true);
  });

  it("attaches and detaches the abort signal on the broker around the run", async () => {
    const attach = vi.fn();
    const detach = vi.fn();
    const b: PermissionBroker = {
      async requestPermission() {
        return true;
      },
      attachAbortSignal: attach,
      detachAbortSignal: detach,
    };
    const { o } = orch(b);
    await collect(o.run([runnable("read_file", { path: "a.txt" })]) as AsyncGenerator<AgentEvent, Map<string, unknown>>);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it("reports malformed tool-call JSON without prompting (pre-prompt guard)", async () => {
    // Pins WHY the orchestrator keeps its own `__parseError` branch even though
    // `executeTool` has one too: this branch sits BEFORE the mutating/permission
    // branch, so a malformed mutating call is reported as malformed instead of
    // raising a permission prompt for a mutation that cannot be described.
    const b = broker(true);
    const { o, ledger: l } = orch(b);
    const call = runnable("write_file", { __parseError: true, rawInput: '{"path":' });
    const { events, results } = await collect(
      o.run([call]) as AsyncGenerator<AgentEvent, Map<string, unknown>>
    );
    expect(events.map((e) => e.type)).toEqual(["tool_finished"]);
    expect(results.get(call.p.call.id)).toMatchObject({ isError: true });
    expect(b.calls).toEqual([]);
    expect(
      l.entries.some((e) => e.eventType === "tool_finished" && e.outcome === "error")
    ).toBe(true);
  });

  it("a broken broker denies by default instead of hanging", async () => {
    const b: PermissionBroker = {
      async requestPermission() {
        throw new Error("broker exploded");
      },
    };
    const { o } = orch(b);
    const { events } = await collect(
      o.run([runnable("write_file", { path: "x.txt", content: "x" })]) as AsyncGenerator<AgentEvent, Map<string, unknown>>
    );
    expect(events.map((e) => e.type)).toEqual(["tool_permission_denied"]);
    expect(fs.existsSync(path.join(tmp, "x.txt"))).toBe(false);
  });
});
