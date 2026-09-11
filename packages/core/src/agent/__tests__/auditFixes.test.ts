import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { AgentSession } from "../session.js";
import { AUTO_APPROVE_BROKER } from "../types.js";
import { FakeProvider, type ScriptEntry } from "./fakeProvider.js";
import type { StreamEvent } from "../../providers/types.js";

/**
 * Script: one write_file call per entry, chained with `tool_use` stops so the
 * loop keeps calling the model — a single `end_turn` would end send(), so the
 * six-file chain must stay in tool-use mode until the last call.
 */
function writeChain(paths: { pathRel: string; content: string }[], endTurn = true): ScriptEntry[] {
  return paths.map(({ pathRel, content }, i): ScriptEntry => {
    const id = `c${i + 1}`;
    const events: StreamEvent[] = [
      { type: "tool_call_start", id, name: "write_file" },
      { type: "tool_call_end", id, name: "write_file", input: { path: pathRel, content } },
      {
        type: "turn_end",
        stopReason: endTurn && i === paths.length - 1 ? "end_turn" : "tool_use",
      },
    ];
    return events;
  });
}

function failingVerifyScript(pathRel: string, content: string): ScriptEntry[] {
  const edit = (id: string, oldText: string, newText: string): StreamEvent[] => [
    { type: "tool_call_start", id, name: "edit_file" },
    { type: "tool_call_end", id, name: "edit_file", input: { path: pathRel, oldText, newText } },
    { type: "turn_end", stopReason: "tool_use" },
  ];
  const conclude = (): StreamEvent[] => [
    { type: "text_delta", text: "Attempting repair." },
    { type: "turn_end", stopReason: "end_turn" },
  ];
  return [
    // The write must keep the loop in tool-use mode — an end_turn here would
    // end send() before verification ever fires.
    ...writeChain([{ pathRel, content }], false),
    // Repair 1 → verify fail (budget 1/2) → repair message → loop continues.
    edit("r1", content, content + "\n// repair 1"),
    conclude(),
    // Repair 2 → verify fail (budget 2/2) → repair message → loop continues.
    edit("r2", content + "\n// repair 1", content + "\n// repair 2"),
    conclude(),
    // Final non-tool turn: the verify check now hits the exhausted budget
    // branch — the session emits verification_gave_up instead of a 3rd probe.
    conclude(),
  ];
}

function newSession(provider: FakeProvider, tmpDir: string, verifyCmd: string): AgentSession {
  return new AgentSession(provider, {
    systemPrompt: "You are Anvil.",
    model: "test-model",
    maxTokens: 1024,
    projectRoot: tmpDir,
    permissionBroker: AUTO_APPROVE_BROKER,
    autoVerify: verifyCmd,
  });
}

describe("Audit fixes: verification give-up and review baseline", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-audit-fixes-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits verification_gave_up when the repair budget is exhausted (fix #4)", async () => {
    const provider = new FakeProvider(failingVerifyScript("calc.js", "module.exports = 1;"));
    const session = newSession(provider, tmpDir, "exit 1"); // tests always fail

    const events = [];
    for await (const ev of session.send("implement calc")) {
      events.push(ev);
    }

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "verification_gave_up")).toHaveLength(1);
    // The turn still completes honestly (no pass/fail masquerade).
    expect(types).toContain("turn_complete");

    const gaveUp = events.find((e) => e.type === "verification_gave_up") as any;
    expect(gaveUp?.command).toBe("exit 1");
  });

  it("does NOT emit verification_gave_up when verification passes (fix #4)", async () => {
    // Write ends tool_use (so the tool runs), then a plain end_turn stream
    // concludes — verification fires once and passes.
    const provider = new FakeProvider([
      ...writeChain([{ pathRel: "calc.js", content: "module.exports = 42;" }], false),
      [
        { type: "text_delta", text: "Done." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const session = newSession(provider, tmpDir, "exit 0"); // tests always pass

    const events = [];
    for await (const ev of session.send("implement calc")) {
      events.push(ev);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("verification_result");
    expect(types).not.toContain("verification_gave_up");
  });

  it("/diff survives checkpoint-ring eviction via the review baseline (fix #1)", async () => {
    // Six writes chained in tool-use mode (each snapshot caps the ring at
    // CHECKPOINT_KEEP = 5, so without the session-level baseline map the
    // earliest baselines would be evicted), then a plain end_turn stream.
    const script: ScriptEntry[] = [
      ...writeChain(
        Array.from({ length: 6 }, (_, i) => ({
          pathRel: `file${i + 1}.js`,
          content: `module.exports = ${i + 1};`,
        })),
        false
      ),
      [
        { type: "text_delta", text: "Done." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ];
    const provider = new FakeProvider(script);
    const session = newSession(provider, tmpDir, "exit 0");

    for await (const _ of session.send("write six files")) {
      void _;
    }

    const changes = await session.summarizeChanges();
    const relPaths = changes.map((c) => c.path).sort();
    const expected = Array.from({ length: 6 }, (_, i) => `file${i + 1}.js`).sort();
    expect(relPaths).toEqual(expected);
  });
});
