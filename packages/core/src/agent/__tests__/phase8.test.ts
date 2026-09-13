import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StreamEvent } from "../../providers/types.js";
import { FakeProvider } from "./fakeProvider.js";
import { AUTO_APPROVE_BROKER } from "../types.js";
import {
  AgentSession,
  DEFAULT_MAX_INNER_ITERATIONS,
  LEDGER_CAP,
  canonicalInputHash,
  capLedger,
  type AgentEvent,
  type AgentOptions,
} from "../index.js";

// ---------------------------------------------------------------------------
// Phase 8 (A) — deterministic acceptance tests against FakeProvider + the real
// tool registry. No network, no timers beyond the tools themselves.
// ---------------------------------------------------------------------------

const BASE_OPTIONS: Omit<AgentOptions, "projectRoot"> = {
  systemPrompt: "",
  model: "phase8-fake",
  maxTokens: 512,
  permissionBroker: AUTO_APPROVE_BROKER,
};

function readTurn(file: string, id: string): StreamEvent[] {
  return [
    { type: "tool_call_end", id, name: "read_file", input: { path: file } },
    { type: "usage", inputTokens: 120, outputTokens: 12 },
    { type: "turn_end", stopReason: "tool_use" },
  ];
}

function planTurn(plan: string, id: string): StreamEvent[] {
  return [
    { type: "tool_call_end", id, name: "update_plan", input: { plan } },
    { type: "usage", inputTokens: 100, outputTokens: 10 },
    { type: "turn_end", stopReason: "tool_use" },
  ];
}

function textTurn(text = "Done."): StreamEvent[] {
  return [
    { type: "text_delta", text },
    { type: "usage", inputTokens: 80, outputTokens: 30 },
    { type: "turn_end", stopReason: "end_turn" },
  ];
}

async function collect(
  provider: FakeProvider,
  projectRoot: string,
  extra: Partial<AgentOptions> = {}
): Promise<{ session: AgentSession; events: AgentEvent[] }> {
  const session = new AgentSession(provider, {
    ...BASE_OPTIONS,
    projectRoot,
    ...extra,
  });
  const events: AgentEvent[] = [];
  for await (const event of session.send("Start the task.")) events.push(event);
  return { session, events };
}

const finishedMsg = (e: AgentEvent) => (e.type === "tool_finished" ? e.result.summary : "");

describe("Phase 8 (A) — durable loop", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-p8-"));
  });
  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("A1: all-read-only batch executes concurrently, results in declared order", async () => {
    const files = ["a", "b", "c", "d", "e"].map((n) => path.join(tmp, `${n}.txt`));
    for (const f of files) fs.writeFileSync(f, f);
    const ids = ["r0", "r1", "r2", "r3", "r4"];
    const script: StreamEvent[][] = [
      [
        ...ids.map((id, i) => ({
          type: "tool_call_end" as const,
          id,
          name: "read_file" as const,
          input: { path: files[i] },
        })),
        { type: "turn_end", stopReason: "tool_use" as const },
      ],
      textTurn(),
    ];
    const provider = new FakeProvider(script);
    const { session, events } = await collect(provider, tmp);

    const lastStarted = events.map((e) => e.type).lastIndexOf("tool_started");
    const firstFinished = events.map((e) => e.type).indexOf("tool_finished");
    expect(lastStarted).toBeGreaterThanOrEqual(0);
    expect(firstFinished).toBeGreaterThanOrEqual(0);
    // concurrent: every tool_started precedes every tool_finished
    expect(lastStarted).toBeLessThan(firstFinished);

    const lastUser = [...session.getHistory()].reverse().find((m) => m.role === "user")!;
    const userContent = Array.isArray(lastUser.content) ? lastUser.content : [];
    const results = userContent.filter((c) => "type" in c && c.type === "tool_result");
    expect(results.map((r) => ("result" in r ? (r.result as { toolCallId: string }).toolCallId : undefined))).toEqual(ids);
  });

  it("A2: batch containing a mutating call runs strictly serially", async () => {
    const inFile = path.join(tmp, "in.txt");
    const outFile = path.join(tmp, "out.txt");
    fs.writeFileSync(inFile, "hello");
    const script: StreamEvent[][] = [
      [
        { type: "tool_call_end", id: "w0", name: "write_file", input: { path: outFile, content: "NEW" } },
        { type: "tool_call_end", id: "r1", name: "read_file", input: { path: inFile } },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      textTurn(),
    ];
    const provider = new FakeProvider(script);
    const { events } = await collect(provider, tmp);

    const seq = events
      .filter((e) => e.type === "tool_started" || e.type === "tool_finished")
      .map((e) => (e.type === "tool_started" ? `start:${e.name}` : `done:${e.name}`));
    expect(seq).toEqual([
      "start:write_file",
      "done:write_file",
      "start:read_file",
      "done:read_file",
    ]);
    expect(fs.readFileSync(outFile, "utf-8")).toBe("NEW");
  });

  it("A3: iteration budget stops the turn with exactly one budget_exhausted", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "x");
    const script: StreamEvent[][] = Array.from({ length: 20 }, (_, i) => readTurn(file, `r${i}`));
    const provider = new FakeProvider(script);
    const { session, events } = await collect(provider, tmp);

    expect(events.filter((e) => e.type === "budget_exhausted").length).toBe(1);
    expect(provider.calls.length).toBe(20); // no unbounded 21st provider round
    expect(
      session.getHistory().some(
        (m) =>
          m.role === "assistant" &&
          Array.isArray(m.content) &&
          m.content.some(
            (c) => "text" in c && typeof c.text === "string" && c.text.includes("step limit") && c.text.includes("20")
          )
      )
    ).toBe(true);
  });
  it("A4: loop guard flags the 3rd identical call and refuses the 4th", async () => {
    const missing = path.join(tmp, "nope.txt");
    const one = readTurn(missing, "x0");
    const script: StreamEvent[][] = [one, one, one, one, textTurn()];
    const provider = new FakeProvider(script);
    const { session, events } = await collect(provider, tmp);

    expect(events.filter((e) => e.type === "loop_detected").length).toBe(1);
    // 3 executed; the 4th is refused BEFORE execution so it never produces a
    // tool_started/tool_finished event pair — only a tool_result error.
    const finished = events.filter((e) => e.type === "tool_finished");
    expect(finished.length).toBe(3);
    const lastExecuted = finished[finished.length - 1];
    expect(finishedMsg(lastExecuted)).not.toContain("loop guard");

    const lastUser = [...session.getHistory()].reverse().find((m) => m.role === "user")!;
    const userContent = Array.isArray(lastUser.content) ? lastUser.content : [];
    const results = userContent.filter((c) => "type" in c && c.type === "tool_result");
    const refused = results[results.length - 1];
    expect(refused && "result" in refused && (refused.result as { isError?: boolean }).isError).toBe(true);
    expect(refused && "result" in refused && String((refused.result as { content?: unknown }).content)).toContain("loop guard");

    const ledger = session.getRunLedger();
    expect(ledger.some((e) => e.eventType === "loop_detected")).toBe(true);
    expect(ledger.some((e) => e.eventType === "loop_refused")).toBe(true);
    expect(canonicalInputHash({ b: 1, a: { d: 2, c: 1 } })).toBe(
      canonicalInputHash({ a: { c: 1, d: 2 }, b: 1 })
    );
  });

  it("A5: update_plan sets session.plan, emits plan_updated, persists & restores", async () => {
    const script: StreamEvent[][] = [planTurn("Write the A tests", "p0"), textTurn()];
    const provider = new FakeProvider(script);
    const { session, events } = await collect(provider, tmp);

    expect(events.some((e) => e.type === "plan_updated" && e.plan === "Write the A tests")).toBe(true);
    expect(session.plan).toBe("Write the A tests");

    const stored = session.toStoredSession("anthropic", "phase8-fake");
    expect(stored.metadata.plan).toBe("Write the A tests");

    const restored = new AgentSession(provider, { ...BASE_OPTIONS, projectRoot: tmp }, stored);
    expect(restored.plan).toBe("Write the A tests");
  });

  it("A6: ledger records events, persists, and caps at LEDGER_CAP", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "x");
    const script: StreamEvent[][] = [readTurn(file, "r0"), textTurn()];
    const provider = new FakeProvider(script);
    const { session } = await collect(provider, tmp);

    const ledger = session.getRunLedger();
    expect(ledger.length).toBeGreaterThanOrEqual(2); // tool_started + tool_finished
    const seqs = ledger.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

    const stored = session.toStoredSession("anthropic", "phase8-fake");
    expect(stored.metadata.runLedger?.length).toBe(ledger.length);

    const padded: any[] = Array.from({ length: LEDGER_CAP + 5 }, (_, i) => ({
      seq: i,
      ts: "t",
      eventType: "x",
      outcome: "ok",
      elapsedMs: 0,
    }));
    const capped = capLedger(padded);
    expect(capped.length).toBe(LEDGER_CAP);
    expect(capped[0].seq).toBe(5);
  });

  it("lets a non-default maxInnerIterations change the budget", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "x");
    const script: StreamEvent[][] = Array.from({ length: 3 }, (_, i) => readTurn(file, `r${i}`));
    const provider = new FakeProvider(script);
    const { events } = await collect(provider, tmp, { maxInnerIterations: 2 });

    expect(events.filter((e) => e.type === "budget_exhausted").length).toBe(1);
    expect(provider.calls.length).toBe(2);
  });

  it("default iteration budget is exported at 20", () => {
    expect(DEFAULT_MAX_INNER_ITERATIONS).toBe(20);
  });

  it("unknown tools take the serial path and error cleanly in declared order", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "x");
    const script: StreamEvent[][] = [
      [
        { type: "tool_call_end", id: "r0", name: "read_file", input: { path: file } },
        { type: "tool_call_end", id: "x0", name: "mystery_tool", input: {} },
        { type: "turn_end", stopReason: "tool_use" as const },
      ],
      textTurn(),
    ];
    const provider = new FakeProvider(script);
    const { session, events } = await collect(provider, tmp);

    // Serial branch never yields tool_started for unknown tools (the
    // concurrent branch would). Unknown names stay on the safe path even
    // though they only ever error today.
    expect(events.some((e) => e.type === "tool_started" && e.name === "mystery_tool")).toBe(false);
    const finished = events.filter((e) => e.type === "tool_finished");
    expect(finished.map((e) => e.id)).toEqual(["r0", "x0"]);
    expect(finished[1].result.isError).toBe(true);
    expect(JSON.stringify(finished[1].result.output)).toContain("Unknown tool");
    expect(
      session.getRunLedger().some((e) => e.eventType === "tool_finished" && e.tool === "mystery_tool" && e.outcome === "error")
    ).toBe(true);
  });

  it("cancel during an open permission prompt ends the turn cancelled", async () => {
    const outFile = path.join(tmp, "out.txt");
    let release!: (approved: boolean) => void;
    const hangingBroker = {
      requestPermission: () => new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    };
    const script: StreamEvent[][] = [
      [
        { type: "tool_call_end", id: "w0", name: "write_file", input: { path: outFile, content: "NEW" } },
        { type: "turn_end", stopReason: "tool_use" as const },
      ],
    ];
    const provider = new FakeProvider(script);
    const session = new AgentSession(provider, { ...BASE_OPTIONS, projectRoot: tmp, permissionBroker: hangingBroker });
    const events: AgentEvent[] = [];
    const done = (async () => {
      for await (const event of session.send("Write it.")) events.push(event);
    })();
    await new Promise((r) => setTimeout(r, 50)); // let the turn reach the prompt
    session.cancel();
    await done;
    expect(events.some((e) => e.type === "cancelled")).toBe(true);
    expect(events.some((e) => e.type === "tool_started")).toBe(false);
    expect(fs.existsSync(outFile)).toBe(false);
    release?.(true); // hygiene: settle the orphaned broker promise
  });

  it("control ledger entries carry no fabricated token attribution", async () => {
    const missing = path.join(tmp, "nope.txt");
    const one = readTurn(missing, "x0");
    const script: StreamEvent[][] = [one, one, one, one, textTurn()];
    const provider = new FakeProvider(script);
    const { session } = await collect(provider, tmp);
    const ledger = session.getRunLedger();
    for (const e of ledger.filter((l) => l.eventType === "loop_detected" || l.eventType === "loop_refused")) {
      expect(e.tokens).toBeUndefined();
    }
    // Completion entries keep measured tokens.
    expect(ledger.filter((e) => e.eventType === "tool_finished" && e.tokens !== undefined).length).toBeGreaterThan(0);
  });

  it("non-consecutive repeat (A-B-A-B-A) warns once but still executes", async () => {
    const fileA = path.join(tmp, "a.txt");
    const fileB = path.join(tmp, "b.txt");
    fs.writeFileSync(fileA, "a");
    fs.writeFileSync(fileB, "b");
    const script: StreamEvent[][] = [
      readTurn(fileA, "r0"),
      readTurn(fileB, "r1"),
      readTurn(fileA, "r2"),
      readTurn(fileB, "r3"),
      readTurn(fileA, "r4"),
      readTurn(fileB, "r5"),
      textTurn(),
    ];
    const provider = new FakeProvider(script);
    const { session, events } = await collect(provider, tmp);

    // Advisory only: one loop_detected, zero refusals — all 6 calls executed.
    expect(events.filter((e) => e.type === "loop_detected").length).toBe(1);
    expect(events.filter((e) => e.type === "tool_finished").length).toBe(6);
    expect(
      session.getHistory().some(
        (m) =>
          m.role === "user" &&
          Array.isArray(m.content) &&
          m.content.some((c) => "text" in c && typeof c.text === "string" && c.text.includes("in between"))
      )
    ).toBe(true);
  });
});