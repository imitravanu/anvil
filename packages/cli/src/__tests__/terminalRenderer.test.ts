import { describe, expect, it, vi } from "vitest";
import { renderCliEvent, EXIT_OK, EXIT_ERROR, EXIT_BUDGET_EXHAUSTED, EXIT_CANCELLED, EXIT_UNVERIFIED } from "../terminalRenderer.js";
import type { AgentEvent } from "@anvil/core";

describe("renderCliEvent (Phase 24.13)", () => {
  it("renders text_delta to stdout", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const event: AgentEvent = { type: "text_delta", text: "hello chunk" };
    const res = renderCliEvent(event, { raw: false });
    expect(stdoutSpy).toHaveBeenCalledWith("hello chunk");
    expect(res).toBeUndefined();
    stdoutSpy.mockRestore();
  });

  it("renders tool_started and tool_finished to stderr when not raw", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    renderCliEvent({ type: "tool_started", id: "1", name: "read_file", input: {} }, { raw: false });
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("⚙ [read_file]"));

    renderCliEvent(
      {
        type: "tool_finished",
        id: "1",
        name: "read_file",
        result: { output: {}, isError: false, summary: "read 10 lines" },
      },
      { raw: false }
    );
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("✓ [read_file] read 10 lines"));
    stderrSpy.mockRestore();
  });

  it("suppresses diagnostic formatting when raw is true", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    renderCliEvent({ type: "tool_started", id: "1", name: "read_file", input: {} }, { raw: true });
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("returns exitCode on terminal events", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    expect(renderCliEvent({ type: "turn_complete" })).toEqual({ exitCode: EXIT_OK });
    expect(renderCliEvent({ type: "error", message: "fail" })).toEqual({ exitCode: EXIT_ERROR });
    expect(renderCliEvent({ type: "budget_exhausted" })).toEqual({ exitCode: EXIT_BUDGET_EXHAUSTED });
    expect(renderCliEvent({ type: "cancelled" })).toEqual({ exitCode: EXIT_CANCELLED });

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("a give-up after mutations is not reported as success (S1.4)", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(EXIT_UNVERIFIED).not.toBe(0);
    const res = renderCliEvent({ type: "verification_gave_up", command: "npm test" }, { raw: true });
    expect(res).toEqual({ exitCode: EXIT_UNVERIFIED });
    stderrSpy.mockRestore();
  });

  it("headless event order for an unrepaired failure exits nonzero, not 0 (S1.4)", () => {
    // The engine emits verification_gave_up *before* turn_complete. headless.ts
    // returns on the FIRST event carrying an exit code, so if gave_up carried
    // none, the following turn_complete won the race and a turn that mutated
    // files and left tests failing exited 0 — a silent success in the CI path.
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const events: AgentEvent[] = [
      { type: "verification_started", command: "npm test" },
      { type: "verification_result", passed: false, summary: "1 test failed" },
      { type: "verification_gave_up", command: "npm test" },
      { type: "turn_complete" },
    ];

    let code = 0;
    for (const event of events) {
      const rendered = renderCliEvent(event);
      if (rendered?.exitCode !== undefined) {
        code = rendered.exitCode; // same precedence rule as headless.ts
        break;
      }
    }

    expect(code).toBe(EXIT_UNVERIFIED);
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("a failure that is later repaired still exits 0", () => {
    // Only the terminal verdict counts: verify-fail -> repair -> verify-pass
    // must not poison the exit code.
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const events: AgentEvent[] = [
      { type: "verification_result", passed: false, summary: "1 test failed" },
      { type: "verification_result", passed: true, summary: "all passed" },
      { type: "turn_complete" },
    ];

    let code = 0;
    for (const event of events) {
      const rendered = renderCliEvent(event);
      if (rendered?.exitCode !== undefined) {
        code = rendered.exitCode;
        break;
      }
    }

    expect(code).toBe(EXIT_OK);
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});
