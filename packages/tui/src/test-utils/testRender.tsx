import React from "react";
import { render as inkRender } from "ink-testing-library";
import { ThemeContext, THEMES } from "../theme/theme.js";

/**
 * Render a component under the dark theme (App always provides one —
 * bare useTheme() would silently fall back, hiding missing-provider bugs).
 */
export interface ThemedRender {
  lastFrame: () => string | undefined;
  unmount: () => void;
  stdin: { write: (data: string) => void };
}

export function renderThemed(ui: React.ReactElement): ThemedRender {
  const rendered = inkRender(<ThemeContext.Provider value={THEMES.dark}>{ui}</ThemeContext.Provider>);
  return {
    lastFrame: () => rendered.lastFrame(),
    unmount: () => rendered.unmount(),
    stdin: rendered.stdin,
  };
}

/** Let Ink flush a stdin write through React state before asserting. */
export function tick(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Plain-text frame. NOTE: test stdout is not a TTY, so chalk emits NO ANSI
 * codes here — assert structure/text, never colors. Style regressions are
 * still uncovered by design.
 */
export function frameText(lastFrame: () => string | undefined): string {
  return (lastFrame() ?? "").replace(/\u001b\[[0-9;]*m/g, "");
}
