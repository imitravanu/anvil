import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { MessageList } from "../MessageList.js";
import { renderThemed, tick } from "../../test-utils/testRender.js";
import type { DisplayMessage } from "../../hooks/useAgentController.js";

/**
 * Roadmap 23.4 claims `React.memo` on the transcript components "prevents entire
 * message history re-rendering on every streaming chunk".
 *
 * Nothing asserted that, and it is not self-evident: memo only holds while
 * `useAgentController` keeps the identity of untouched messages stable
 * (`prev.map((m) => (m.id === assistantId ? fn(m) : m))`) and the parent passes no
 * fresh objects or inline functions. If either changes, every message re-renders
 * per chunk — with no visible symptom except CPU, and chunk rate is exactly why
 * this matters while a turn streams.
 *
 * Renders are counted through the per-render sanitizer call: rendering message X
 * runs sanitizeTerminalText(X.text) again.
 *
 * The harness drives updates through React STATE, not ink-testing-library's
 * `rerender` (which replaces the root element). A state update is the re-render
 * the controller actually triggers, and it is the only path on which a memo
 * bail-out can be observed at all.
 */
const sanitize = vi.fn((text: string) => text);

vi.mock("../../util/sanitize.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../util/sanitize.js")>();
  return {
    ...actual,
    sanitizeTerminalText: (text: string) => sanitize(actual.sanitizeTerminalText(text)),
  };
});

const user = (id: string, text: string): DisplayMessage => ({
  id,
  role: "user",
  text,
  streaming: false,
  toolCalls: [],
  subAgents: [],
});

const assistant = (id: string, text: string, streaming = false): DisplayMessage => ({
  id,
  role: "assistant",
  text,
  streaming,
  toolCalls: [],
  subAgents: [],
});

/** Texts rendered since the last clear, in order. */
const renderedSince = (): string[] => sanitize.mock.calls.map(([text]) => text);

/** Exposes a setter so a test can push new props the way the controller does. */
let push: ((messages: DisplayMessage[]) => void) | null = null;

function TranscriptHarness({ initial }: { initial: DisplayMessage[] }) {
  const [messages, setMessages] = useState(initial);
  push = setMessages;
  return <MessageList messages={messages} model="m1" />;
}

describe("transcript render memoisation (roadmap 23.4)", () => {
  beforeEach(() => {
    sanitize.mockClear();
    push = null;
  });

  it("re-renders only the streaming message when a chunk arrives", async () => {
    const first = user("u1", "first question");
    const second = user("u2", "second question");
    const live = assistant("a1", "chunk-0", true);

    const view = renderThemed(<TranscriptHarness initial={[first, second, live]} />);
    await tick();
    sanitize.mockClear();

    // A chunk: only the assistant message is a new object; the settled messages
    // keep their identity, exactly as the controller produces them.
    push?.([first, second, { ...live, text: "chunk-0chunk-1" }]);
    await tick();

    const rendered = renderedSince();
    // The update really happened, so the assertions below cannot pass by inertia.
    expect(rendered).toContain("chunk-0chunk-1");
    // ...and the settled history was left alone.
    expect(rendered).not.toContain("first question");
    expect(rendered).not.toContain("second question");

    view.unmount();
  });

  it("does not re-render settled messages when a new one is appended", async () => {
    const first = user("u1", "first question");
    const second = user("u2", "second question");

    const view = renderThemed(<TranscriptHarness initial={[first, second]} />);
    await tick();
    sanitize.mockClear();

    push?.([first, second, assistant("a1", "a reply")]);
    await tick();

    const rendered = renderedSince();
    expect(rendered).toContain("a reply");
    expect(rendered).not.toContain("first question");
    expect(rendered).not.toContain("second question");

    view.unmount();
  });

  // Control: the counter would NOTICE the regression this suite exists to catch.
  // Rebuilding every message object is the failure mode (`messages.map((m) =>
  // ({...m}))`), so it must show up as re-renders of untouched messages — if this
  // control ever stops seeing them, the assertions above have gone blind.
  it("control: detects re-renders when message identity is not preserved", async () => {
    const first = user("u1", "first question");
    const second = user("u2", "second question");

    const view = renderThemed(<TranscriptHarness initial={[first, second]} />);
    await tick();
    sanitize.mockClear();

    push?.([{ ...first }, { ...second }]);
    await tick();

    expect(renderedSince()).toContain("first question");

    view.unmount();
  });
});
