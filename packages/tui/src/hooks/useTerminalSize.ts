import { useStdout } from "ink";
import { DEFAULT_RESPONSIVE, type ThemeResponsive } from "../theme/themes.js";

/**
 * DW-1.3 — Responsive breakpoints.
 * Returns live terminal dimensions plus the layout breakpoint so DW-2
 * components can collapse gracefully on narrow terminals.
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

export interface TerminalSize {
  width: number;
  height: number;
  breakpoint: TerminalBreakpoint;
}

export function useTerminalSize(responsive: ThemeResponsive = DEFAULT_RESPONSIVE): TerminalSize {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const height = stdout?.rows ?? 24;
  return { width, height, breakpoint: breakpointForWidth(width, responsive) };
}
