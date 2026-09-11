import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StreamEvent } from "../../providers/types.js";
import { FakeProvider } from "./fakeProvider.js";
import { AUTO_APPROVE_BROKER } from "../types.js";
import {
  AgentSession,
  capCheckpoints,
  takeSnapshot,
  type AgentEvent,
  type AgentOptions,
  type Checkpoint,
} from "../index.js";

// ---------------------------------------------------------------------------
// Rewind (docs/REWIND-SPEC.md) — deterministic acceptance tests against
// FakeProvider + a real tmp root. No network.
// ---------------------------------------------------------------------------

const BASE_OPTIONS: Omit<AgentOptions, "projectRoot"> = {
  systemPrompt: "",
  model: "rewind-fake",
  maxTokens: 512,
  permissionBroker: AUTO_APPROVE_BROKER,
};

function writeTurn(file: string, content: string, id: string): StreamEvent[] {
  return [
    { type: "tool_call_end", id, name: "write_file", input: { path: file, content } },
    { type: "usage", inputTokens: 120, outputTokens: 12 },
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

async function runOneTurn(
  session: AgentSession,
  text = "Do it."
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.send(text)) events.push(event);
  return events;
}

describe("rewind checkpoints", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-rw-"));
  });
  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function newSession(script: StreamEvent[][]): { session: AgentSession; provider: FakeProvider } {
    const provider = new FakeProvider(script);
    const session = new AgentSession(provider, { ...BASE_OPTIONS, projectRoot: tmp });
    return { session, provider };
  }

  it("R1: overwrite is snapshotted and rewind restores the original bytes", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "original");
    const { session } = newSession([writeTurn(file, "NEW", "w0"), textTurn()]);
    const events = await runOneTurn(session);

    const checkpoints = events.filter((e) => e.type === "checkpoint");
    expect(checkpoints).toEqual([{ type: "checkpoint", id: 1, files: 1 }]);
    expect(fs.readFileSync(file, "utf-8")).toBe("NEW");

    const result = await session.rewind(1);
    expect(result.ok).toBe(true);
    expect(result.restored).toEqual([file]);
    expect(fs.readFileSync(file, "utf-8")).toBe("original");

    const ledger = session.getRunLedger();
    expect(ledger.some((e) => e.eventType === "checkpoint_created")).toBe(true);
    expect(ledger.some((e) => e.eventType === "rewind" && e.outcome === "ok")).toBe(true);
  });

  it("R2: rewind deletes a file the turn created", async () => {
    const file = path.join(tmp, "fresh.txt");
    const { session } = newSession([writeTurn(file, "NEW", "w0"), textTurn()]);
    await runOneTurn(session);
    expect(fs.existsSync(file)).toBe(true);

    const result = await session.rewind(1);
    expect(result.ok).toBe(true);
    expect(result.deleted).toEqual([file]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("R3: read-only and run_command-only turns snapshot nothing", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "x");
    const script: StreamEvent[][] = [
      [
        { type: "tool_call_end", id: "r0", name: "read_file", input: { path: file } },
        { type: "usage", inputTokens: 100, outputTokens: 10 },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      [
        { type: "tool_call_end", id: "c0", name: "run_command", input: { command: "echo hi" } },
        { type: "usage", inputTokens: 100, outputTokens: 10 },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      textTurn(),
      textTurn(),
    ];
    const { session } = newSession(script);
    const e1 = await runOneTurn(session);
    const e2 = await runOneTurn(session);
    expect([...e1, ...e2].some((e) => e.type === "checkpoint")).toBe(false);
    expect(session.getCheckpoints()).toEqual([]);
  });

  it("R4: ring keeps the last 5 checkpoints", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "v0");
    const script: StreamEvent[][] = [];
    for (let i = 1; i <= 6; i++) {
      script.push(writeTurn(file, `v${i}`, `w${i}`));
      script.push(textTurn());
    }
    const { session } = newSession(script);
    for (let i = 0; i < 6; i++) await runOneTurn(session, `Turn ${i}`);
    expect(session.getCheckpoints().map((c) => c.id)).toEqual([2, 3, 4, 5, 6]);
    // Latest checkpoint restores the version before the last write.
    const result = await session.rewind(6);
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("v5");
  });

  it("R5: unknown id fails cleanly, files untouched", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "v0");
    const { session } = newSession([writeTurn(file, "v1", "w0"), textTurn()]);
    await runOneTurn(session);
    const result = await session.rewind(999);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("No checkpoint #999");
    expect(fs.readFileSync(file, "utf-8")).toBe("v1");
    expect(
      session.getRunLedger().some((e) => e.eventType === "rewind" && e.outcome === "error")
    ).toBe(true);
  });

  it("R6: path-escape target is skipped, turn proceeds, no throw", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "v0");
    const escapeTarget = path.join(path.dirname(tmp), "anvil-rw-should-not-exist.txt");
    try {
      const { session } = newSession([
        [
          { type: "tool_call_end", id: "e0", name: "write_file", input: { path: "../anvil-rw-should-not-exist.txt", content: "evil" } },
          { type: "tool_call_end", id: "w0", name: "write_file", input: { path: file, content: "v1" } },
          { type: "usage", inputTokens: 120, outputTokens: 12 },
          { type: "turn_end", stopReason: "tool_use" },
        ],
        textTurn(),
      ]);
      const events = await runOneTurn(session);
      const checkpoints = events.filter((e) => e.type === "checkpoint");
      expect(checkpoints.length).toBe(1);
      expect(session.getCheckpoints()).toHaveLength(1);
      expect(fs.readFileSync(file, "utf-8")).toBe("v1");
      expect(fs.existsSync(escapeTarget)).toBe(false);
    } finally {
      try {
        fs.rmSync(escapeTarget, { force: true });
      } catch {
        // ignore
      }
    }
  });

  it("R5: denied or errored file batches mint no checkpoint and evict nothing", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "original");
    // Broker denies everything: the write never runs.
    const denyBroker = { async requestPermission() { return false; } };
    const provider = new FakeProvider([
      [
        { type: "tool_call_end", id: "w0", name: "write_file", input: { path: file, content: "NEVER" } },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      textTurn(),
    ]);
    const session = new AgentSession(provider, {
      ...BASE_OPTIONS,
      projectRoot: tmp,
      permissionBroker: denyBroker,
    });
    const events = await runOneTurn(session);
    expect(events.map((e) => e.type)).toContain("tool_permission_denied");
    expect(events.some((e) => e.type === "checkpoint")).toBe(false);
    expect(session.getCheckpoints()).toEqual([]);
    expect(session.getRunLedger().some((e) => e.eventType === "checkpoint_created")).toBe(false);
    expect(fs.readFileSync(file, "utf-8")).toBe("original");
  });

  it("takeSnapshot: missing file snapshots null, directories skip", async () => {
    const missing = path.join(tmp, "nope.txt");
    const dir = path.join(tmp, "sub");
    fs.mkdirSync(dir);
    const cp = await takeSnapshot(tmp, 1, [missing, "./sub", ""]);
    expect(cp.files).toEqual([{ path: missing, content: null }]);
    expect(cp.skipped).toBe(2);
  });

  it("capCheckpoints keeps the newest CHECKPOINT_KEEP", () => {
    const mk = (id: number): Checkpoint => ({ id, ts: "t", files: [], skipped: 0 });
    const list = [1, 2, 3, 4, 5, 6, 7].map(mk);
    expect(capCheckpoints(list).map((c) => c.id)).toEqual([3, 4, 5, 6, 7]);
  });

  it("sub-agent file writes merge into the parent ring and rewind", async () => {
    const file = path.join(tmp, "sub.txt");
    fs.writeFileSync(file, "before-sub");
    const script: StreamEvent[][] = [
      [
        { type: "tool_call_end", id: "d1", name: "delegate_task", input: { task: "edit the file" } },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      // sub-agent turn: overwrites the file, then reports
      [
        { type: "tool_call_end", id: "w0", name: "write_file", input: { path: file, content: "after-sub" } },
        { type: "usage", inputTokens: 60, outputTokens: 8 },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "edited" },
        { type: "usage", inputTokens: 70, outputTokens: 5 },
        { type: "turn_end", stopReason: "end_turn" },
      ],
      textTurn("noted"),
    ];
    const provider = new FakeProvider(script);
    const session = new AgentSession(provider, { ...BASE_OPTIONS, projectRoot: tmp });
    const events = await runOneTurn(session);
    expect(fs.readFileSync(file, "utf-8")).toBe("after-sub");
    expect(events.filter((e) => e.type === "subagent_finished")).toHaveLength(1);

    // The parent ring holds the sub's checkpoint (fresh parent id).
    const cps = session.getCheckpoints();
    expect(cps).toHaveLength(1);
    expect(cps[0].files).toBe(1);
    expect(session.getRunLedger().some((e) => e.eventType === "checkpoint_merged")).toBe(true);

    const result = await session.rewind(cps[0].id);
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("before-sub");
  });
});
