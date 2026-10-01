import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { runHeadless, readStdin, DenialTracker } from "../headless.js";
import { EXIT_PERMISSION_DENIED } from "../terminalRenderer.js";
import type { ModelProvider, CompletionRequest, StreamEvent } from "@anvil/core";

class TestFakeProvider implements ModelProvider {
  readonly id = "anthropic" as const;
  readonly displayName = "Test Fake Provider";
  calls: CompletionRequest[] = [];
  constructor(private script: StreamEvent[][]) {}
  isConfigured(): boolean { return true; }
  async *streamCompletion(req: CompletionRequest): AsyncGenerator<StreamEvent> {
    this.calls.push(req);
    const turn = this.script.shift() ?? [];
    for (const ev of turn) yield ev;
  }
}

describe("runHeadless", () => {
  let tmpDir: string;
  let stdoutSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-headless-test-"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("streams text_delta events to stdout and exits with code 0", async () => {
    const provider = new TestFakeProvider([
      [
        { type: "text_delta", text: "Hello " },
        { type: "text_delta", text: "World!" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);

    const code = await runHeadless({
      prompt: "greet",
      provider,
      model: "test-model",
      projectRoot: tmpDir,
      autoApprove: false,
      raw: false,
    });

    expect(code).toBe(0);
    const stdoutCalls = stdoutSpy.mock.calls.map((c: any) => c[0]);
    expect(stdoutCalls).toContain("Hello ");
    expect(stdoutCalls).toContain("World!");
  });

  it("handles error events and exits with code 1", async () => {
    const provider = new TestFakeProvider([
      [{ type: "error", message: "API connection failed" }],
    ]);

    const code = await runHeadless({
      prompt: "test",
      provider,
      model: "test-model",
      projectRoot: tmpDir,
      autoApprove: false,
      raw: false,
    });

    expect(code).toBe(1);
    const stderrCalls = stderrSpy.mock.calls.map((c: any) => c[0]).join("");
    expect(stderrCalls).toContain("API connection failed");
  });

  it("refuses mutating tools when autoApprove is false and explains --yes", async () => {
    const provider = new TestFakeProvider([
      [
        { type: "tool_call_start", id: "call_1", name: "write_file" },
        {
          type: "tool_call_end",
          id: "call_1",
          name: "write_file",
          input: { path: "test.txt", content: "data" },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "File write was blocked." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);

    const code = await runHeadless({
      prompt: "create test.txt",
      provider,
      model: "test-model",
      projectRoot: tmpDir,
      autoApprove: false,
      raw: false,
    });

    // G4/AUDIT-2026-09-30: a run whose every mutation was refused must NOT
    // report success — CI scripts key on the exit code. This used to be 0.
    expect(code).toBe(EXIT_PERMISSION_DENIED);
    const stderrCalls = stderrSpy.mock.calls.map((c: any) => c[0]).join("");
    expect(stderrCalls).toContain('Refused mutating tool "write_file"');
    expect(stderrCalls).toContain("pass -y / --yes");
    // Ensure file was NOT written
    expect(fs.existsSync(path.join(tmpDir, "test.txt"))).toBe(false);
  });

  it("still exits 4 when read-only tools succeed after a denial", async () => {
    // A successful READ does not unblock a denied mutation: only an executed
    // mutating tool clears the denial state.
    const provider = new TestFakeProvider([
      [
        { type: "tool_call_start", id: "call_1", name: "write_file" },
        {
          type: "tool_call_end",
          id: "call_1",
          name: "write_file",
          input: { path: "test.txt", content: "data" },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      [
        { type: "tool_call_start", id: "call_2", name: "read_file" },
        { type: "tool_call_end", id: "call_2", name: "read_file", input: { path: "test.txt" } },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Done." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);

    const code = await runHeadless({
      prompt: "read test.txt",
      provider,
      model: "test-model",
      projectRoot: tmpDir,
      autoApprove: false,
      raw: false,
    });

    expect(code).toBe(EXIT_PERMISSION_DENIED);
  });

  it("auto-approves mutating tools when autoApprove is true", async () => {
    const provider = new TestFakeProvider([
      [
        { type: "tool_call_start", id: "call_1", name: "write_file" },
        {
          type: "tool_call_end",
          id: "call_1",
          name: "write_file",
          input: { path: "approved.txt", content: "safe data" },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Created file." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);

    const code = await runHeadless({
      prompt: "write approved.txt",
      provider,
      model: "test-model",
      projectRoot: tmpDir,
      autoApprove: true,
      raw: false,
    });

    expect(code).toBe(0);
    const stderrCalls = stderrSpy.mock.calls.map((c: any) => c[0]).join("");
    expect(stderrCalls).toContain("Auto-approved mutating tool: write_file");
    // Ensure file WAS written
    expect(fs.existsSync(path.join(tmpDir, "approved.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "approved.txt"), "utf8")).toBe("safe data");
  });

  it("suppresses stderr notices when raw is true", async () => {
    const provider = new TestFakeProvider([
      [
        { type: "text_delta", text: "Clean output" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);

    const code = await runHeadless({
      prompt: "test raw",
      provider,
      model: "test-model",
      projectRoot: tmpDir,
      autoApprove: false,
      raw: true,
    });

    expect(code).toBe(0);
    expect(stderrSpy).not.toHaveBeenCalled();
    const stdoutCalls = stdoutSpy.mock.calls.map((c: any) => c[0]).join("");
    expect(stdoutCalls).toContain("Clean output");
  });
});

describe("DenialTracker (G4/AUDIT-2026-09-30)", () => {
  it("flags a run as blocked after a denial until an executed mutation succeeds", () => {
    const tracker = new DenialTracker((name) => name === "write_file");
    expect(tracker.blocked).toBe(false);
    tracker.onPermissionDenied();
    expect(tracker.blocked).toBe(true);
    // A read-only success clears nothing.
    tracker.onToolFinished("read_file", false);
    expect(tracker.blocked).toBe(true);
    // A mutation that FAILED was not an authorized execution.
    tracker.onToolFinished("write_file", true);
    expect(tracker.blocked).toBe(true);
    // An executed mutation success clears the denial state.
    tracker.onToolFinished("write_file", false);
    expect(tracker.blocked).toBe(false);
  });

  it("treats unknown tool names as mutating (fail closed, matches the orchestrator)", () => {
    // The orchestrator classifies unknown tools as mutating; the tracker must
    // not be more permissive than the thing it observes.
    const tracker = new DenialTracker((name) => name !== "read_file");
    tracker.onPermissionDenied();
    tracker.onToolFinished("mystery_tool", false);
    expect(tracker.blocked).toBe(false);
    tracker.onPermissionDenied();
    tracker.onToolFinished("read_file", false);
    expect(tracker.blocked).toBe(true);
  });
});

describe("readStdin", () => {
  it("returns empty string when process.stdin.isTTY is true", async () => {
    const origIsTTY = process.stdin.isTTY;
    try {
      process.stdin.isTTY = true;
      const result = await readStdin();
      expect(result).toBe("");
    } finally {
      process.stdin.isTTY = origIsTTY;
    }
  });
});
