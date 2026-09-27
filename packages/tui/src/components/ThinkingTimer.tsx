import React from "react";
import { Text, useAnimation } from "ink";
import { THINKING_TIMER_TICK_MS } from "@anvil/core";
import { useTheme } from "../theme/theme.js";

/**
 * Streaming "thinking" indicator (Phase 28.4 & 29.7).
 *
 * A blank assistant turn gives the user no signal that anything is happening, so
 * the static `thinking…` is replaced by a ticking elapsed timer driven by Ink 7's
 * native `useAnimation` hook. The count starts at MOUNT — which is exactly why the
 * timer resets when text starts arriving: that unmounts this component, and the next
 * empty stretch mounts a fresh one. All animations share a single unified timer.
 *
 * The glyph is the demo's U+273B (Dingbats; widely supported), with a plain `*`
 * for ASCII terminals via `ANVIL_ASCII=1`.
 */
export function ThinkingTimer() {
  const theme = useTheme();
  const { frame: elapsed } = useAnimation({ interval: THINKING_TIMER_TICK_MS });

  const glyph = process.env.ANVIL_ASCII === "1" ? "*" : "✻";
  return (
    <>
      <Text color={theme.colors.accent}>{glyph}</Text>
      <Text color={theme.colors.textMuted}>
        {elapsed > 0 ? ` thinking ${elapsed}s` : " thinking…"}
      </Text>
    </>
  );
}
