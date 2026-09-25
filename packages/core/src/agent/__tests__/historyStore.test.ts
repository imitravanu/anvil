import { describe, expect, it } from "vitest";
import { HistoryStore, UNANSWERED_TURN_NOTICE } from "../historyStore.js";
import type { PreparedCall } from "../loopGuard.js";

const prepared = (id: string): PreparedCall => ({
  call: { id, name: "read_file", input: { path: "a.ts" } },
  def: undefined,
  key: `read_file:${id}`,
  refused: false,
  loopWarn: false,
  repeatWarn: false,
});

describe("HistoryStore.pushToolResults", () => {
  it("skips the push when there are no results and no notes (no empty user message)", () => {
    const h = new HistoryStore();
    h.pushUserText("hello");
    const before = h.snapshot().length;
    h.pushToolResults([], new Map(), []);
    expect(h.snapshot()).toHaveLength(before);
  });

  it("still pushes notes-only results", () => {
    const h = new HistoryStore();
    h.pushUserText("hello");
    h.pushToolResults([], new Map(), ["loop warning"]);
    const last = h.snapshot().at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toHaveLength(1);
  });

  it("pushes real tool results in declared order", () => {
    const h = new HistoryStore();
    h.pushUserText("hello");
    h.pushToolResults([prepared("t1")], new Map([["t1", { output: { ok: true }, isError: false, summary: "ok" }]]), []);
    const last = h.snapshot().at(-1)!;
    expect(last.content).toHaveLength(1);
    expect(last.content[0].type).toBe("tool_result");
  });
});

describe("HistoryStore.pushUserText", () => {
  it("folds into a trailing user turn when the previous assistant turn was empty (N-1)", () => {
    const h = new HistoryStore();
    h.pushUserText("first");
    // An empty assistant turn records nothing (pushAssistant refuses empty pushes).
    expect(h.pushAssistant([], [])).toBe(false);
    h.pushUserText("second");
    // Pushing a second user message here would create `user -> user` adjacency,
    // which several providers reject; the fold keeps one user message.
    expect(h.snapshot()).toHaveLength(1);
    const textParts = h.snapshot()[0].content.filter(
      (c): c is { type: "text"; text: string } => c.type === "text"
    );
    expect(textParts.map((c) => c.text).join("|")).toBe("first\nsecond");
  });

  it("folds after a cancel that left the history user-terminated", () => {
    const h = new HistoryStore();
    h.pushUserText("draft"); // Esc before any assistant message exists
    h.pushUserText("continued");
    expect(h.snapshot()).toHaveLength(1);
  });

  it("never folds into a user message that carries tool results", () => {
    const h = new HistoryStore();
    h.pushUserText("hello");
    h.pushToolResults([prepared("t1")], new Map([["t1", { output: { ok: true }, isError: false, summary: "ok" }]]), []);
    h.pushUserText("next");
    expect(h.snapshot()).toHaveLength(3);
    expect(h.snapshot().at(-1)!.role).toBe("user");
    expect(h.snapshot().at(-1)!.content[0].type).toBe("text");
  });

  it("keeps the folded turn retrievable as one unit for /retry", () => {
    const h = new HistoryStore();
    h.pushUserText("one");
    h.pushUserText("two");
    expect(h.popLastUserTurn()).toBe("one\ntwo");
  });

  it("preserves images across a fold", () => {
    const h = new HistoryStore();
    h.pushUserText("with image", [{ mediaType: "image/png", data: "AAAA" }]);
    h.pushUserText("and text");
    const content = h.snapshot()[0].content;
    expect(content.filter((c) => c.type === "image")).toHaveLength(1);
    expect(content.filter((c) => c.type === "text")).toHaveLength(1);
  });
});

describe("HistoryStore.closeOpenTurn", () => {
  it("closes a trailing user turn so the next one cannot create adjacency", () => {
    const h = new HistoryStore();
    h.pushUserText("hello");
    h.pushAssistant([], [{ id: "t1", name: "read_file", input: {} }]);
    h.pushToolResults(
      [prepared("t1")],
      new Map([["t1", { output: { ok: true }, isError: false, summary: "ok" }]]),
      []
    );
    // A turn that ends on tool results (cancelled / interrupted batch).
    expect(h.snapshot().at(-1)!.role).toBe("user");
    h.closeOpenTurn();
    const last = h.snapshot().at(-1)!;
    expect(last.role).toBe("assistant");
    expect(last.content[0]).toEqual({ type: "text", text: UNANSWERED_TURN_NOTICE });
  });

  it("is a no-op when the turn already ended with an assistant message", () => {
    const h = new HistoryStore();
    h.pushUserText("hello");
    h.pushAssistant(["hi"], []);
    const before = h.length;
    h.closeOpenTurn();
    h.closeOpenTurn();
    expect(h.length).toBe(before);
  });
});
