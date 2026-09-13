import { describe, expect, it, vi } from "vitest";
import { renderCliEvent } from "../terminalRenderer.js";
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

    expect(renderCliEvent({ type: "turn_complete" })).toEqual({ exitCode: 0 });
    expect(renderCliEvent({ type: "error", message: "fail" })).toEqual({ exitCode: 1 });
    expect(renderCliEvent({ type: "budget_exhausted" })).toEqual({ exitCode: 2 });
    expect(renderCliEvent({ type: "cancelled" })).toEqual({ exitCode: 130 });

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});
