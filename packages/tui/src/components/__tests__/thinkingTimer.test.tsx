import { describe, expect, it } from "vitest";
import React from "react";
import { ThinkingTimer } from "../ThinkingTimer.js";
import { MessageView } from "../MessageView.js";
import type { DisplayMessage } from "../../hooks/useAgentController.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

/**
 * The tick is real (no fake-timer precedent in this package, and Ink's state
 * updates ride real timers here), so wait for the property with a generous
 * ceiling rather than asserting at an exact millisecond — under gate load an
 * exact-window assertion is a coin flip.
 */
// 10s, not 3s: under the full gate (68 test files in parallel, machine
// saturated) this file alone has been observed to run 3.09s before the 1s tick
// even landed, so a 3s ceiling is a coin flip. The wait is a property wait, not
// a deadline — its only job is to bound a genuine hang.
async function waitUntil(predicate: () => boolean, ceilingMs = 10000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < ceilingMs) {
    if (predicate()) return true;
    await tick(50);
  }
  return false;
}

const streaming: DisplayMessage = {
  id: "a1",
  role: "assistant",
  text: "",
  streaming: true,
  toolCalls: [],
  subAgents: [],
};

describe("ThinkingTimer", () => {
  it("starts at thinking… and counts up once a second", async () => {
    const { lastFrame, unmount } = renderThemed(<ThinkingTimer />);
    expect(frameText(lastFrame)).toContain("thinking…");
    expect(frameText(lastFrame)).toContain("✻");

    const reached1s = await waitUntil(() => frameText(lastFrame).includes("thinking 1s"));
    expect(reached1s, "the timer never reached 1s").toBe(true);

    // Past the ellipsis: the label is now a live count, not the placeholder.
    expect(frameText(lastFrame)).not.toContain("thinking…");
    unmount();
  });
});

describe("MessageView thinking state", () => {
  it("shows the timer when streaming with no text and no tool calls", () => {
    const { lastFrame, unmount } = renderThemed(<MessageView message={streaming} />);
    const out = frameText(lastFrame);
    expect(out).toContain("✻");
    expect(out).toContain("thinking…");
    unmount();
  });

  it("drops the timer as soon as text arrives", () => {
    const { lastFrame, unmount } = renderThemed(
      <MessageView message={{ ...streaming, text: "here it comes" }} />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("here it comes");
    expect(out).not.toContain("thinking");
    unmount();
  });

  it("shows the pulse instead of the timer once tool calls exist", () => {
    const { lastFrame, unmount } = renderThemed(
      <MessageView
        message={{
          ...streaming,
          toolCalls: [
            { id: "t1", name: "read_file", input: { path: "a.txt" }, status: "running" },
          ],
        }}
      />
    );
    const out = frameText(lastFrame);
    expect(out).not.toContain("thinking");
    expect(out).not.toContain("✻");
    unmount();
  });
});
