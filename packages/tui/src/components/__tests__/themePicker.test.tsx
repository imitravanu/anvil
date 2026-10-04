import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ThemePicker } from "../ThemePicker.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

/**
 * Phase 41 — the picker rendered `names.map(...)` straight into a fixed-height
 * frame, so a generous ~/.anvil/themes.json (6 built-ins + N custom) could grow
 * past the frame and stack rows over the status bar. It also showed nothing
 * but names — you could not tell two dark themes apart without arrowing through
 * them one live preview at a time.
 */

const DOWN = "\u001B[B";
const ENTER = "\r";
const ESC = "\u001B";

const LEGACY_COLORS = {
  primary: "#00d4ff",
  userText: "#ffffff",
  assistantText: "#00ff90",
  toolName: "#ffd166",
  toolRunning: "#c678dd",
  toolDone: "#98c379",
  toolError: "#ff5555",
  dim: "#80848e",
  border: "#3a3f4b",
  accent: "#ff79c6",
  surface: "#21252b",
};

let savedHome: string | undefined;

/** Point ANVIL_HOME at a temp dir holding `count` custom themes. */
function withCustomThemes(count: number): void {
  savedHome = process.env.ANVIL_HOME;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-themes-"));
  const themes: Record<string, { colors: typeof LEGACY_COLORS }> = {};
  for (let i = 0; i < count; i++) themes[`t${i}`] = { colors: LEGACY_COLORS };
  fs.writeFileSync(path.join(dir, "themes.json"), JSON.stringify(themes));
  process.env.ANVIL_HOME = dir;
}

afterEach(() => {
  if (savedHome === undefined) delete process.env.ANVIL_HOME;
  else process.env.ANVIL_HOME = savedHome;
});

describe("ThemePicker", () => {
  it("windows a long theme list instead of overflowing the frame", async () => {
    withCustomThemes(12); // 6 built-ins + 12 custom = 18 rows
    const app = renderThemed(
      <ThemePicker onPreview={() => undefined} onApply={() => undefined} onCancel={() => undefined} />
    );
    await tick();
    const rest = frameText(app.lastFrame);
    expect(rest).toContain("▼"); // more rows exist than the window shows
    expect(rest).not.toContain("t11"); // last row is below the first window

    for (let i = 0; i < 17; i++) {
      app.stdin.write(DOWN);
      await tick(20);
    }
    expect(frameText(app.lastFrame)).toContain("t11");
    app.unmount();
  });

  it("shows each theme's brand swatch so themes are told apart at a glance", async () => {
    withCustomThemes(0);
    const app = renderThemed(
      <ThemePicker onPreview={() => undefined} onApply={() => undefined} onCancel={() => undefined} />
    );
    await tick();
    // 6 built-ins, one swatch each (and the highlight adds none).
    expect((frameText(app.lastFrame).match(/●/g) ?? []).length).toBe(6);
    app.unmount();
  });

  it("previews on mount, applies the highlighted theme, and Esc restores", async () => {
    withCustomThemes(0);
    const onPreview = vi.fn();
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const app = renderThemed(
      <ThemePicker onPreview={onPreview} onApply={onApply} onCancel={onCancel} />
    );
    await tick();
    expect(onPreview).toHaveBeenCalledWith("dark");
    app.stdin.write(ENTER);
    await tick();
    expect(onApply).toHaveBeenCalledWith("dark");
    app.stdin.write(ESC);
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
    app.unmount();
  });
});
