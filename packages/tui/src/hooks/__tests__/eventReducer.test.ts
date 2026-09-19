import { describe, it, expect, vi } from "vitest";
import { applyEvent, retainOutput, OUTPUT_RETAIN_MAX, appendSystemMessage, systemMessage } from "../eventReducer.js";
import type { DisplayMessage, UsageTotals } from "../eventReducer.js";
import type { AgentEvent } from "@anvil/core";

describe("eventReducer", () => {
  it("systemMessage creates a system role message", () => {
    const msg = systemMessage("Notice");
    expect(msg.role).toBe("system");
    expect(msg.text).toBe("Notice");
    expect(msg.streaming).toBe(false);
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
      },
      update,
      setUsage,
      setMessages,
      setPlan
    );
    expect(assistant.toolCalls[0].status).toBe("done");
    expect(assistant.toolCalls[0].summary).toBe("Read foo.txt");
    expect(assistant.toolCalls[0].output).toEqual({ content: "hello" });
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
});
