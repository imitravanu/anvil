import { describe, expect, it } from "vitest";
import { HistoryStore } from "../historyStore.js";
import type { PreparedCall } from "../loopGuard.js";
import { resolveWithinRoot, PathEscapeError } from "../../tools/paths.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Regression: loop-guard notes used to be pushed as a text part BEFORE the
 * tool_results. Anthropic requires tool_result blocks at the start of the
 * user turn and OpenAI-family providers reject a user message between
 * assistant tool_calls and their role:"tool" replies — so the notes must
 * trail, in the same message.
 */
describe("HistoryStore.pushToolResults ordering", () => {
  it("emits tool_results first, loop-guard notes after", () => {
    const h = new HistoryStore();
    const call: PreparedCall = {
      call: { id: "c1", name: "run_command", input: { command: "ls" } },
      def: undefined,
      key: "k1",
    } as unknown as PreparedCall;
    h.pushAssistant([], [
      { id: "c1", name: "run_command", input: { command: "ls" } },
    ]);
    h.pushToolResults(
      [call],
      new Map([["c1", { output: { ok: true }, isError: false, summary: "ok" }]]),
      ["Loop guard: run_command repeated 3× without progress."]
    );
    const last = h.snapshot().at(-1)!;
    expect(last.role).toBe("user");
    const types = last.content.map((c) => c.type);
    expect(types).toEqual(["tool_result", "text"]);
    expect((last.content[1] as { text: string }).text).toContain("Loop guard");
  });
});

describe("resolveWithinRoot dot-name edge", () => {
  it("accepts a legitimate file whose name starts with '..'", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-paths-"));
    try {
      const target = path.join(root, "..config");
      fs.writeFileSync(target, "x");
      expect(resolveWithinRoot(root, "..config")).toBe(target);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("still rejects real escapes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-paths-"));
    try {
      expect(() => resolveWithinRoot(root, "../escape.txt")).toThrow(PathEscapeError);
      expect(() => resolveWithinRoot(root, "..")).toThrow(PathEscapeError);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
