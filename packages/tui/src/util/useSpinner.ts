import { useAnimation } from "ink";
import { SPINNER_BLINK_INTERVAL_MS } from "./displayLimits.js";

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

/**
 * `ANVIL_NO_ANIM=1` — reduced motion. Read at call time (not module load) so a
 * test can toggle it, and honored by EVERY animated affordance: the wordmark
 * already advertised this contract, but the spinners and cursor ignored it, so
 * a no-animation run still flickered at 12 fps.
 */
function noAnim(): boolean {
  return process.env.ANVIL_NO_ANIM === "1";
}

/** Cycles the style's frames while `active`; held on the first frame under ANVIL_NO_ANIM. */
export function useSpinnerFrame(active: boolean, style: SpinnerStyle = "dots"): string {
  const { frames, interval } = SPINNERS[style];
  const frozen = noAnim();
  const { frame } = useAnimation({ interval, isActive: active && !frozen });
  return frozen ? frames[0] : frames[frame % frames.length];
}

/**
 * DW-3.4 — blinking block cursor for streaming text. Visible on mount so
 * static test frames are deterministic; toggles on the interval while active,
 * or stays steadily visible under ANVIL_NO_ANIM (a flicker is motion too).
 */
export function useBlink(active: boolean, intervalMs = SPINNER_BLINK_INTERVAL_MS): boolean {
  const frozen = noAnim();
  const { frame } = useAnimation({ interval: intervalMs, isActive: active && !frozen });
  return frozen ? true : frame % 2 === 0;
}
