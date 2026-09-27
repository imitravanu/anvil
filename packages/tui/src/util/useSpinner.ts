import { useAnimation } from "ink";

/**
 * DW-3.1 & Phase 29.7 — context-matched spinner system.
 * dots: tool execution / busy states (subtle, fast)
 * pulse: streaming wakefulness (breathing)
 * arrows: waiting on async work (directional)
 * blocks: goal milestone progress (filling up)
 *
 * Driven by Ink 7's native `useAnimation` hook, which consolidates all
 * animated spinners into a single coordinated event loop tick.
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
  const { frame } = useAnimation({ interval, isActive: active });
  return frames[frame % frames.length];
}

/**
 * DW-3.4 — blinking block cursor for streaming text. Visible on mount so
 * static test frames are deterministic; toggles on the interval while active.
 */
export function useBlink(active: boolean, intervalMs = 530): boolean {
  const { frame } = useAnimation({ interval: intervalMs, isActive: active });
  return frame % 2 === 0;
}
