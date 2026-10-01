import { DEFAULT_RESPONSIVE, type ThemeResponsive } from "../theme/themes.js";

/**
 * DW-1.3 — Responsive breakpoints.
 * The layout breakpoint so DW-2 components can collapse gracefully on narrow
 * terminals. (The `useTerminalSize` hook wrapper was removed in Phase 39 W8 —
 * it had no production caller, §2.8.)
 */
export type TerminalBreakpoint = "compact" | "normal" | "wide" | "ultraWide";

export function breakpointForWidth(
  width: number,
  responsive: ThemeResponsive = DEFAULT_RESPONSIVE
): TerminalBreakpoint {
  if (width < responsive.compactWidth) return "compact";
  if (width < responsive.normalWidth) return "normal";
  if (width < responsive.wideWidth) return "wide";
  return "ultraWide";
}
