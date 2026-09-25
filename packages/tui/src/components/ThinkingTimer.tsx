import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { THINKING_TIMER_TICK_MS } from "@anvil/core";
import { useTheme } from "../theme/theme.js";

/**
 * Streaming "thinking" indicator (Phase 28.4).
 *
 * A blank assistant turn gives the user no signal that anything is happening, so
 * the static `thinking…` is replaced by a ticking elapsed timer. The count starts
 * at MOUNT — which is exactly why the timer resets when text starts arriving:
 * that unmounts this component, and the next empty stretch mounts a fresh one.
 *
 * The glyph is the demo's U+273B (Dingbats; widely supported), with a plain `*`
 * for ASCII terminals via `ANVIL_ASCII=1`.
 */
export function ThinkingTimer() {
  const theme = useTheme();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / THINKING_TIMER_TICK_MS)),
      THINKING_TIMER_TICK_MS
    );
    // Clearing on unmount is what stops a settled turn from ticking forever.
    return () => clearInterval(id);
  }, []);

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
