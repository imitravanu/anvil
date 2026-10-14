import { describe, it, expect, vi } from "vitest";
import type React from "react";
import { applyEvent, retainOutput, OUTPUT_RETAIN_MAX, appendSystemMessage, systemMessage } from "../eventReducer.js";
import { REASONING_RETAIN_MAX } from "../../util/displayLimits.js";
import type { DisplayMessage, UsageTotals } from "../eventReducer.js";
import type { AgentEvent } from "@anvil/core";

describe("eventReducer", () => {
  it("never throws on a malformed event (2026-10-14 fuzz: 4,402 of 20,000 threw)", () => {
    // Each of these threw before the fix. One bad event used to end the whole
    // turn with an error instead of rendering what it could.
    const malformed: Array<Record<string, unknown>> = [
      { type: "plan_updated" },
      { type: "plan_updated", plan: null },
      { type: "tool_finished" },
      { type: "tool_finished", result: null, id: "x" },
      { type: "error", message: 0 },
      { type: "error", message: null },
      { type: "guardian_blocked", count: "many" },
      { type: "guardian_blocked", count: 1, fixed: 0, violations: null },
      { type: "subagent_finished", id: "m" },
      { type: "usage" },
    ];
    for (const ev of malformed) {
      let messages: DisplayMessage[] = [
        { id: "a", role: "assistant", text: "", streaming: true, toolCalls: [], subAgents: [], verifications: [], ts: 0 },
      ];
      const update = (fn: (m: DisplayMessage) => DisplayMessage) => {
        messages = messages.map(fn);
      };
      const setMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>> = (action) => {
        messages = typeof action === "function" ? action(messages) : action;
      };
      expect(
        () =>
          applyEvent(
            ev as unknown as AgentEvent,
            update,
            () => undefined,
            setMessages,
            () => undefined,
            () => undefined
          ),
        JSON.stringify(ev)
      ).not.toThrow();
    }
  });

  it("retained output keeps whole code points at the per-string cap", () => {
    // 1,999 ASCII + emoji + tail crosses the 2,000-UNIT cap exactly on the
    // emoji: the old slice(0, 2000) kept the high half only — invalid UTF-16.
    const value = "a".repeat(1999) + "😀" + "tail";
    const retained = retainOutput({ text: value }) as { text: string };
    expect(retained.text).toContain("…[truncated]");
    expect(retained.text).toContain("😀");
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(retained.text)).toBe(false);
  });

  it("systemMessage creates a system role message", () => {
    const msg = systemMessage("Notice");
    expect(msg.role).toBe("system");
    expect(msg.text).toBe("Notice");
    expect(msg.streaming).toBe(false);
  });

  it("usage events accumulate onto the turn's message as per-turn token totals (28.10)", () => {
    let assistant: DisplayMessage = {
      id: "a1",
      role: "assistant",
      text: "",
      streaming: true,
      toolCalls: [],
      subAgents: [],
    };
    const update = (fn: (m: DisplayMessage) => DisplayMessage) => {
      assistant = fn(assistant);
    };
    let usage: UsageTotals = { inputTokens: 0, outputTokens: 0 };
    const setUsage = (action: React.SetStateAction<UsageTotals>) => {
      usage = typeof action === "function" ? action(usage) : action;
    };
    const setMessages = vi.fn();
    const setPlan = vi.fn();

    // A multi-step turn reports usage once per provider response; the
    // message must end with the SUM, not the last report.
    applyEvent({ type: "usage", inputTokens: 1_200, outputTokens: 340 }, update, setUsage, setMessages, setPlan);
    applyEvent({ type: "usage", inputTokens: 800, outputTokens: 260 }, update, setUsage, setMessages, setPlan);

    expect(assistant.inputTokens).toBe(2_000);
    expect(assistant.outputTokens).toBe(600);
    // The cumulative session totals still track the same events exactly.
    expect(usage).toEqual({ inputTokens: 2_000, outputTokens: 600 });
  });

  it("appendSystemMessage caps history at TRANSCRIPT_STATE_CAP", () => {
    let state: DisplayMessage[] = [];
    const setMessages = (action: React.SetStateAction<DisplayMessage[]>) => {
      state = typeof action === "function" ? (action as (prev: DisplayMessage[]) => DisplayMessage[])(state) : action;
    };
    for (let i = 0; i < 1050; i++) {
      appendSystemMessage(setMessages, `Message ${i}`);
    }
    expect(state.length).toBeLessThanOrEqual(1000);
  });

  it("applyEvent reduces tool_started and tool_finished", () => {
    let assistant: DisplayMessage = {
      id: "a1",
      role: "assistant",
      text: "",
      streaming: true,
      toolCalls: [],
      subAgents: [],
    };
    const update = (fn: (m: DisplayMessage) => DisplayMessage) => {
      assistant = fn(assistant);
    };
    const setUsage = vi.fn();
    const setMessages = vi.fn();
    const setPlan = vi.fn();

    // 1. Tool started
    applyEvent(
      { type: "tool_started", id: "call-1", name: "read_file", input: { path: "foo.txt" } },
      update,
      setUsage,
      setMessages,
      setPlan
    );
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls[0].status).toBe("running");

    // 2. Tool finished
    applyEvent(
      {
        type: "tool_finished",
        id: "call-1",
        name: "read_file",
        result: { output: { content: "hello" }, isError: false, summary: "Read foo.txt" },
        durationMs: 250,
      },
      update,
      setUsage,
      setMessages,
      setPlan
    );
    expect(assistant.toolCalls[0].status).toBe("done");
    expect(assistant.toolCalls[0].summary).toBe("Read foo.txt");
    expect(assistant.toolCalls[0].output).toEqual({ content: "hello" });
    // Execution timing rides the event through to the display DTO (Phase 28.3).
    expect(assistant.toolCalls[0].durationMs).toBe(250);
  });

  it("applyEvent attaches a structured guardian report on guardian_blocked", () => {
    let assistant: DisplayMessage = {
      id: "a1",
      role: "assistant",
      text: "",
      streaming: true,
      toolCalls: [],
      subAgents: [],
    };
    const update = (fn: (m: DisplayMessage) => DisplayMessage) => {
      assistant = fn(assistant);
    };
    applyEvent(
      {
        type: "guardian_blocked",
        count: 1,
        fixed: 1,
        firstRule: "no-placeholder-marker",
        violations: [
          { file: "src/a.ts", line: 3, rule: "no-placeholder-marker", family: "placeholder", detail: "placeholder left in code" },
        ],
        fixes: [],
      },
      update,
      vi.fn(),
      vi.fn(),
      vi.fn()
    );
    expect(assistant.guardianReports).toHaveLength(1);
    expect(assistant.guardianReports?.[0].blocked).toBe(1);
    expect(assistant.guardianReports?.[0].fixed).toBe(1);
    expect(assistant.guardianReports?.[0].violations[0].family).toBe("placeholder");
  });

  /** Harness for the sub-agent card cases: message + usage both reduce. */
  function subAgentHarness() {
    let assistant: DisplayMessage = {
      id: "a1",
      role: "assistant",
      text: "",
      streaming: true,
      toolCalls: [],
      subAgents: [],
    };
    let usage: UsageTotals = { inputTokens: 0, outputTokens: 0 };
    const update = (fn: (m: DisplayMessage) => DisplayMessage) => {
      assistant = fn(assistant);
    };
    const setUsage = (action: React.SetStateAction<UsageTotals>) => {
      usage = typeof action === "function" ? action(usage) : action;
    };
    const send = (event: AgentEvent) => applyEvent(event, update, setUsage, vi.fn(), vi.fn());
    return {
      send,
      cards: () => assistant.subAgents,
      usage: () => usage,
    };
  }

  it("F3: concurrent members' events land on their OWN card, by member id", () => {
    const h = subAgentHarness();
    h.send({ type: "subagent_started", id: "a", task: "member A" });
    h.send({ type: "subagent_started", id: "b", task: "member B" });
    // Interleave: B reports progress first, then A — correlation by "the one
    // running" gave both of these to A (the first running card).
    h.send({ type: "subagent_progress", id: "b", tool: "grep", detail: "in b" });
    h.send({ type: "subagent_progress", id: "a", tool: "read_file", detail: "in a" });
    h.send({
      type: "subagent_finished",
      id: "a",
      toolCalls: 3,
      inputTokens: 100,
      outputTokens: 20,
      report: "A report",
    });

    const [a, b] = h.cards();
    expect(a).toMatchObject({ id: "a", task: "member A", status: "done", toolCalls: 3, report: "A report" });
    expect(a.lastTool).toBeUndefined();
    // B is untouched by A's finish: still running, its own single progress.
    expect(b).toMatchObject({ id: "b", task: "member B", status: "running", toolCalls: 1, lastTool: "grep" });
  });

  it("F4: subagent usage no longer erases the reasoning/cached accumulators", () => {
    const h = subAgentHarness();
    h.send({ type: "usage", inputTokens: 10, outputTokens: 5, reasoningTokens: 4, cachedInputTokens: 3 });
    h.send({
      type: "subagent_finished",
      id: "delegate",
      toolCalls: 1,
      inputTokens: 7,
      outputTokens: 2,
      report: "r",
    });
    expect(h.usage()).toEqual({
      inputTokens: 17,
      outputTokens: 7,
      reasoningTokens: 4,
      cachedInputTokens: 3,
    });
  });

  it("applyEvent reduces plan_updated", () => {
    const update = vi.fn();
    const setUsage = vi.fn();
    let plan: string | null = null;
    const setPlan = (val: React.SetStateAction<string | null>) => {
      plan = typeof val === "function" ? (val as (p: string | null) => string | null)(plan) : val;
    };
    const setMessages = vi.fn();

    applyEvent(
      { type: "plan_updated", plan: "1. Step one\n2. Step two" },
      update,
      setUsage,
      setMessages,
      setPlan
    );

    expect(plan).toBe("1. Step one\n2. Step two");
    expect(setMessages).toHaveBeenCalled();
  });

  it("accumulates reasoning_delta into DisplayMessage.reasoning (Phase 38.6)", () => {
    let assistant: DisplayMessage = {
      id: "a1",
      role: "assistant",
      text: "",
      streaming: true,
      toolCalls: [],
      subAgents: [],
    };
    const update = (fn: (m: DisplayMessage) => DisplayMessage) => {
      assistant = fn(assistant);
    };
    const setUsage = vi.fn();
    const setMessages = vi.fn();
    const setPlan = vi.fn();

    applyEvent({ type: "reasoning_delta", text: "Let me think…" }, update, setUsage, setMessages, setPlan);
    applyEvent({ type: "reasoning_delta", text: " done." }, update, setUsage, setMessages, setPlan);

    expect(assistant.reasoning).toBe("Let me think… done.");
  });

  it("caps reasoning accumulation at REASONING_RETAIN_MAX", () => {
    let assistant: DisplayMessage = {
      id: "a1",
      role: "assistant",
      text: "",
      streaming: true,
      toolCalls: [],
      subAgents: [],
      reasoning: "",
    };
    const update = (fn: (m: DisplayMessage) => DisplayMessage) => {
      assistant = fn(assistant);
    };
    const setUsage = vi.fn();
    const setMessages = vi.fn();
    const setPlan = vi.fn();
    const big = "x".repeat(REASONING_RETAIN_MAX + 50);

    applyEvent({ type: "reasoning_delta", text: big }, update, setUsage, setMessages, setPlan);

    expect(assistant.reasoning?.length).toBeLessThanOrEqual(REASONING_RETAIN_MAX);
  });

  it("retention never begins on a low surrogate when the bound lands mid-pair", () => {
    // Mixed content is what breaks a blind slice(-max): 'ab' + 😀×3000 + 'c' is
    // 6,003 units, so the 6,000-bound fell ON a low surrogate and the retained
    // deliberation began with invalid UTF-16 — rendered as a replacement glyph.
    let assistant: DisplayMessage = {
      id: "a1",
      role: "assistant",
      text: "",
      streaming: true,
      toolCalls: [],
      subAgents: [],
      reasoning: "",
    };
    const update = (fn: (m: DisplayMessage) => DisplayMessage) => {
      assistant = fn(assistant);
    };
    const setUsage = vi.fn();
    const setMessages = vi.fn();
    const setPlan = vi.fn();

    applyEvent(
      { type: "reasoning_delta", text: "ab" + "😀".repeat(3000) + "c" },
      update,
      setUsage,
      setMessages,
      setPlan
    );
    applyEvent({ type: "reasoning_delta", text: "…and done." }, update, setUsage, setMessages, setPlan);

    const kept = assistant.reasoning ?? "";
    for (let i = 0; i < kept.length; i++) {
      const c = kept.charCodeAt(i);
      if (c >= 0xdc00 && c <= 0xdfff) {
        expect(kept.charCodeAt(i - 1)).toBeGreaterThanOrEqual(0xd800);
        expect(kept.charCodeAt(i - 1)).toBeLessThanOrEqual(0xdbff);
      }
    }
    expect(kept.endsWith("…and done.")).toBe(true);
  });
});
