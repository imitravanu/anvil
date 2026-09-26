import { describe, expect, it } from "vitest";
import React from "react";
import type { DisplayMessage } from "../../hooks/useAgentController.js";
import { MessageView } from "../MessageView.js";
import { frameText, renderThemed } from "../../test-utils/testRender.js";

/**
 * Phase 28.10 — per-turn token cost line.
 *
 * Visibility has three gates, each with a reason: `/expand` (compact view
 * stays quiet), settled (!streaming — never annotate a live turn whose
 * usage is still arriving), and real data (inputTokens defined — resumed
 * history replays no usage events and must render nothing, not a
 * fabricated "0 in · 0 out").
 */

const settled: DisplayMessage = {
  id: "a1",
  role: "assistant",
  text: "Done.",
  streaming: false,
  toolCalls: [],
  subAgents: [],
  inputTokens: 1_234,
  outputTokens: 567,
};

describe("MessageView per-turn cost line", () => {
  it("shows the token totals on settled turns under /expand", () => {
    const { lastFrame, unmount } = renderThemed(<MessageView message={settled} expandTools />);
    const out = frameText(lastFrame);
    expect(out).toContain("Done.");
    expect(out).toContain("1.2k in · 567 out");
    unmount();
  });

  it("stays hidden in the compact view even when the data exists", () => {
    const { lastFrame, unmount } = renderThemed(<MessageView message={settled} />);
    expect(frameText(lastFrame)).not.toContain("in · ");
    unmount();
  });

  it("renders nothing for resumed history, which carries no usage", () => {
    const resumed: DisplayMessage = { ...settled, inputTokens: undefined, outputTokens: undefined };
    const { lastFrame, unmount } = renderThemed(<MessageView message={resumed} expandTools />);
    const out = frameText(lastFrame);
    expect(out).toContain("Done.");
    expect(out).not.toContain("in · ");
    expect(out).not.toContain("0 in");
    unmount();
  });

  it("never annotates a streaming turn — its usage is still arriving", () => {
    const live: DisplayMessage = { ...settled, streaming: true, text: "" };
    const { lastFrame, unmount } = renderThemed(<MessageView message={live} expandTools />);
    expect(frameText(lastFrame)).not.toContain("in · ");
    unmount();
  });
});
