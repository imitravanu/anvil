import { describe, expect, it } from "vitest";
import React from "react";
import { THEMES } from "../../theme/theme.js";
import { heatAt, wordmarkMode, WordmarkAnimation, WORDMARK_ROWS } from "../Wordmark.js";
import { MessageList } from "../MessageList.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

async function waitUntil(predicate: () => boolean, ceilingMs = 4000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < ceilingMs) {
    if (predicate()) return true;
    await tick(50);
  }
  return false;
}

function rampOf(theme: (typeof THEMES)[keyof typeof THEMES]): string[] {
  return [
    theme.colors.textMuted,
    theme.colors.warning,
    theme.colors.accent,
    theme.colors.brand,
    theme.colors.textPrimary,
  ];
}

describe("wordmarkMode", () => {
  const ok = { cols: 100, rows: 30, isTTY: true, noColor: false, noAnim: false };

  it("animates on a normal terminal", () => {
    expect(wordmarkMode(ok)).toBe("animate");
  });

  it("settles immediately under ANVIL_NO_ANIM", () => {
    expect(wordmarkMode({ ...ok, noAnim: true })).toBe("static");
  });

  it.each([
    ["NO_COLOR", { ...ok, noColor: true }],
    ["a redirected stream (isTTY undefined, not false)", { ...ok, isTTY: undefined }],
    ["a terminal narrower than 34 cols", { ...ok, cols: 33 }],
    ["a terminal shorter than 16 rows", { ...ok, rows: 15 }],
  ])("falls back to plain text for %s", (_label, env) => {
    expect(wordmarkMode(env)).toBe("plain");
  });
});

describe("heatAt", () => {
  const ramp = ["#000000", "#404040", "#808080", "#c0c0c0", "#ffffff"];

  it("returns the ramp ends beyond the range", () => {
    expect(heatAt(0, ramp)).toBe("#000000");
    expect(heatAt(-1, ramp)).toBe("#000000");
    expect(heatAt(1, ramp)).toBe("#ffffff");
    expect(heatAt(9, ramp)).toBe("#ffffff");
  });

  it("blends between stops", () => {
    // Halfway between stop 0 and 1 is 0x20 per channel.
    expect(heatAt(0.125, ramp)).toBe("#202020");
  });

  it("falls back to the nearest stop when a colour cannot be blended", () => {
    // Custom themes may legitimately use a named colour; blending is impossible,
    // so the render degrades to a ramp step instead of a parse crash.
    expect(heatAt(0.125, ["green", "#ffffff", "#ffffff", "#ffffff", "#ffffff"])).toBe("green");
  });
});

describe("WordmarkAnimation", () => {
  it("renders a settled wordmark of half-block rows", () => {
    const { lastFrame, unmount } = renderThemed(<WordmarkAnimation skipAnimation onSettled={() => {}} />);
    const lines = frameText(lastFrame).split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(WORDMARK_ROWS);
    // Half-block glyphs are how the shape survives a colourless terminal.
    expect(frameText(lastFrame)).toMatch(/[▀▄█]/);
    unmount();
  });

  it("settles on its own and calls onSettled exactly once", async () => {
    let calls = 0;
    const { lastFrame, unmount } = renderThemed(
      <WordmarkAnimation onSettled={() => { calls += 1; }} />
    );
    const settled = await waitUntil(() => calls > 0);
    expect(settled, "the animation never settled").toBe(true);
    await tick(200); // any stray interval would fire again in this window
    expect(calls).toBe(1);
    expect(frameText(lastFrame)).toMatch(/[▀▄█]/);
    unmount();
  });

  it("derives its heat ramp from the active theme, not a hardcoded one", () => {
    const entries = Object.entries(THEMES);
    const midpoints = new Set<string>();
    for (const [, theme] of entries) {
      const ramp = rampOf(theme);
      // Ends are the theme's own tokens — the ramp cannot be a fixed palette.
      expect(heatAt(0, ramp)).toBe(theme.colors.textMuted);
      expect(heatAt(1, ramp)).toBe(theme.colors.textPrimary);
      midpoints.add(heatAt(0.5, ramp));
    }
    // Six themes, and not all of them land on the same mid colour.
    expect(entries.length).toBeGreaterThanOrEqual(6);
    expect(midpoints.size).toBeGreaterThan(1);
  });
});

describe("MessageList empty state", () => {
  it("shows the plain fallback and the onboarding hints off-TTY", () => {
    // Test stdout is not a TTY, which is precisely the plain-fallback branch.
    const { lastFrame, unmount } = renderThemed(
      <MessageList messages={[]} model="qwen2.5-coder:latest" />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("anvil");
    expect(out).toContain("/help");
    expect(out).toContain("/model");
    unmount();
  });

  it("never renders the boot wordmark once the session has messages", () => {
    const { lastFrame, unmount } = renderThemed(
      <MessageList
        messages={[
          {
            id: "u1",
            role: "user",
            text: "hello there",
            streaming: false,
            toolCalls: [],
            subAgents: [],
          },
        ]}
        model="qwen2.5-coder:latest"
      />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("hello there");
    expect(out).not.toContain("/connect — add or update");
    unmount();
  });
});
