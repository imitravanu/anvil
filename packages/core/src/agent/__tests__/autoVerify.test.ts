import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { AgentSession } from "../session.js";
import { AUTO_APPROVE_BROKER, type AgentEvent } from "../types.js";
import { FakeProvider } from "./fakeProvider.js";

describe("Closed-Loop TDD Auto-Verification in AgentSession", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-autoverify-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs verification probe after file mutation and completes when tests pass", async () => {
    const provider = new FakeProvider([
      // Turn 1: model writes code
      [
        { type: "tool_call_start", id: "c1", name: "write_file" },
        {
          type: "tool_call_end",
          id: "c1",
          name: "write_file",
          input: { path: "calc.js", content: "module.exports = 42;" },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      // Turn 2: model concludes
      [
        { type: "text_delta", text: "Code is written." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);

    const session = new AgentSession(provider, {
      systemPrompt: "You are Anvil.",
      model: "test-model",
      maxTokens: 1024,
      projectRoot: tmpDir,
      permissionBroker: AUTO_APPROVE_BROKER,
      autoVerify: "echo 'All 10 tests passed' && exit 0",
    });

    const events = [];
    for await (const ev of session.send("implement calc")) {
      events.push(ev);
    }

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("verification_started");
    expect(eventTypes).toContain("verification_result");
    expect(eventTypes).toContain("turn_complete");

    const vResult = events.find((e) => e.type === "verification_result") as any;
    expect(vResult?.passed).toBe(true);

    const ledger = session.getRunLedger();
    const vEntry = ledger.find((e) => e.eventType === "verification_finished");
    expect(vEntry?.outcome).toBe("ok");
  });

  it("feeds test failure back to model and allows autonomous self-repair", async () => {
    // Flag file to simulate test failing first, then passing after repair
    const testMarker = path.join(tmpDir, "repaired.flag");

    const provider = new FakeProvider([
      // Turn 1: Model creates buggy implementation
      [
        { type: "tool_call_start", id: "c1", name: "write_file" },
        {
          type: "tool_call_end",
          id: "c1",
          name: "write_file",
          input: { path: "feature.js", content: "buggy" },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      // Turn 2: Model tries to finish, but test will fail
      [
        { type: "text_delta", text: "Done with feature." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
      // Turn 3: Model receives verification failure in context and repairs the bug
      [
        { type: "text_delta", text: "Fixing test regression..." },
        { type: "tool_call_start", id: "c2", name: "write_file" },
        {
          type: "tool_call_end",
          id: "c2",
          name: "write_file",
          input: { path: "feature.js", content: "fixed" },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      // Turn 4: Model concludes after repair, test passes now
      [
        { type: "text_delta", text: "Feature repaired and verified." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);

    // Test command fails if repaired.flag doesn't exist, passes once it does
    // Turn 3 touches repaired.flag when feature.js is updated
    const testCmd = `test -f "${path.join(tmpDir, "feature.js")}" && grep -q "fixed" "${path.join(tmpDir, "feature.js")}"`;

    const session = new AgentSession(provider, {
      systemPrompt: "You are Anvil.",
      model: "test-model",
      maxTokens: 1024,
      projectRoot: tmpDir,
      permissionBroker: AUTO_APPROVE_BROKER,
      autoVerify: testCmd,
    });

    const events = [];
    for await (const ev of session.send("build feature")) {
      events.push(ev);
    }

    const vResults = events.filter(
      (e): e is Extract<AgentEvent, { type: "verification_result" }> => e.type === "verification_result"
    );
    expect(vResults.length).toBe(2);
    expect(vResults[0]?.passed).toBe(false); // First probe failed
    expect(vResults[1]?.passed).toBe(true);  // Second probe after repair passed!

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("turn_complete");

    // Check history: verification failure was pushed into history for the model to see
    const history = session.getHistory();
    const repairPrompt = history.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some(
          (c) => "text" in c && typeof c.text === "string" && c.text.includes("[Automated Test Verification Failed]")
        )
    );
    expect(repairPrompt).toBeDefined();

    // Verify file content on disk is the repaired version
    expect(fs.readFileSync(path.join(tmpDir, "feature.js"), "utf8")).toBe("fixed");
  });

  it("caps repair attempts at MAX_VERIFY_REPAIRS (2) without infinite looping", async () => {
    // Script keeps failing tests
    const provider = new FakeProvider([
      // Turn 1
      [
        { type: "tool_call_start", id: "c1", name: "write_file" },
        {
          type: "tool_call_end",
          id: "c1",
          name: "write_file",
          input: { path: "bad.js", content: "1" },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      // Turn 2: Attempt finish -> verify fail 1
      [{ type: "text_delta", text: "Try 1" }, { type: "turn_end", stopReason: "end_turn" }],
      // Turn 3: Attempt finish -> verify fail 2
      [{ type: "text_delta", text: "Try 2" }, { type: "turn_end", stopReason: "end_turn" }],
      // Turn 4: Turn concludes after hitting max repairs
      [{ type: "text_delta", text: "Try 3" }, { type: "turn_end", stopReason: "end_turn" }],
    ]);

    const session = new AgentSession(provider, {
      systemPrompt: "You are Anvil.",
      model: "test-model",
      maxTokens: 1024,
      projectRoot: tmpDir,
      permissionBroker: AUTO_APPROVE_BROKER,
      autoVerify: "exit 1", // always fails
    });

    const events = [];
    for await (const ev of session.send("start")) {
      events.push(ev);
    }

    const vResults = events.filter(
      (e): e is Extract<AgentEvent, { type: "verification_result" }> => e.type === "verification_result"
    );
    // S1.2: two failing probes request repairs (the repair cap), then the
    // FINAL state is still verified once more and reported gave_up — the turn
    // never ends with an untested mutation. Still bounded: no infinite loop.
    expect(vResults.length).toBe(3);
    expect(events.map((e) => e.type)).toContain("verification_gave_up");
    expect(events.map((e) => e.type)).toContain("turn_complete");
  });
});
