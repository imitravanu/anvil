import { useEffect, useState } from "react";

/**
 * DW-3.1 — context-matched spinner system.
 * dots: tool execution / busy states (subtle, fast)
 * pulse: streaming wakefulness (breathing)
 * arrows: waiting on async work (directional)
 * blocks: goal milestone progress (filling up)
 */
export const SPINNERS = {
  dots: { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], interval: 80 },
  pulse: { frames: ["●", "◐", "◑", "●", "◒", "◓"], interval: 120 },
  arrows: { frames: ["→", "↗", "↑", "↖", "←", "↙", "↓", "↘"], interval: 100 },
  blocks: { frames: ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"], interval: 100 },
} as const;

export type SpinnerStyle = keyof typeof SPINNERS;

export const SPINNER_FRAMES: readonly string[] = SPINNERS.dots.frames;

/** Cycles the style's frames while `active`; freezes otherwise. */
export function useSpinnerFrame(active: boolean, style: SpinnerStyle = "dots"): string {
  const { frames, interval } = SPINNERS[style];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), interval);
    return () => clearInterval(id);
  }, [active, frames, interval]);
  return frames[frame];
}

/**
 * DW-3.4 — blinking block cursor for streaming text. Visible on mount so
 * static test frames are deterministic; toggles on the interval while active.
 */
export function useBlink(active: boolean, intervalMs = 530): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setOn((v) => !v), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return on;
}
